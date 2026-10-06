const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = 'yueguanjia:rental-data';
const BACKUP_PREFIX = 'yueguanjia:backup:';
const LOG_KEY = 'yueguanjia:rental-log';
const BACKUP_TTL = 60 * 60 * 24 * 30; // 自動備份保留 30 天
const LOG_MAX = 200;                  // 異動紀錄保留最近 200 筆

function pad(n) { return String(n).padStart(2, '0'); }

// 以台灣時間（UTC+8）每 6 小時為一個備份時段，例如 2026-08-31T06
function backupBucket() {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  const block = Math.floor(t.getUTCHours() / 6) * 6;
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(block)}`;
}

function deviceHint(req) {
  const ua = (req.headers && req.headers['user-agent']) || '';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return 'Android 手機';
  if (/Windows/i.test(ua)) return 'Windows 電腦';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac 電腦';
  return '未知裝置';
}

function arr(v) { return Array.isArray(v) ? v : []; }

// 比對前後兩份資料，只記錄「結構性」異動（新增/刪除物件、月報表、紀錄筆數減少）
function diffState(oldS, newS) {
  const oldP = arr(oldS && oldS.properties);
  const newP = arr(newS && newS.properties);
  const oldIds = new Set(oldP.map(p => p.id));
  const newIds = new Set(newP.map(p => p.id));
  const added = newP.filter(p => !oldIds.has(p.id)).map(p => p.name);
  const removed = oldP.filter(p => !newIds.has(p.id)).map(p => p.name);

  const count = p => arr(p.rentRecords).length + arr(p.repairRecords).length + arr(p.todos).length;
  const oldById = new Map(oldP.map(p => [p.id, p]));
  let oldCount = 0, newCount = 0;
  newP.forEach(p => {
    const o = oldById.get(p.id);
    if (o) { oldCount += count(o); newCount += count(p); }
  });
  const removedRecords = oldCount > newCount ? oldCount - newCount : 0;

  const oldM = new Set(arr(oldS && oldS.monthlyReports).map(r => r.month));
  const newM = new Set(arr(newS && newS.monthlyReports).map(r => r.month));
  const addedMonths = [...newM].filter(m => !oldM.has(m));
  const removedMonths = [...oldM].filter(m => !newM.has(m));

  return { added, removed, removedRecords, addedMonths, removedMonths };
}

async function pushLog(entry) {
  try {
    await redis.lpush(LOG_KEY, JSON.stringify(entry));
    await redis.ltrim(LOG_KEY, 0, LOG_MAX - 1);
  } catch (e) { /* 記錄失敗不影響主流程 */ }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({ error: '尚未設定 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 環境變數，請至 Vercel 專案設定新增。' });
    return;
  }

  try {
    const action = (req.query && req.query.action) || '';

    if (req.method === 'GET') {
      if (action === 'backups') {
        const keys = (await redis.keys(BACKUP_PREFIX + '*')) || [];
        keys.sort().reverse();
        res.status(200).json(keys.slice(0, 60).map(k => ({ key: k, label: k.slice(BACKUP_PREFIX.length) })));
        return;
      }
      if (action === 'backup') {
        const key = String((req.query && req.query.key) || '');
        if (!key.startsWith(BACKUP_PREFIX)) { res.status(400).json({ error: '備份名稱不正確' }); return; }
        const snap = await redis.get(key);
        if (!snap) { res.status(404).json({ error: '找不到這份備份（可能已過期）' }); return; }
        res.status(200).json(snap);
        return;
      }
      if (action === 'log') {
        const items = (await redis.lrange(LOG_KEY, 0, 49)) || [];
        res.status(200).json(items.map(x => {
          if (typeof x === 'string') { try { return JSON.parse(x); } catch (e) { return null; } }
          return x;
        }).filter(Boolean));
        return;
      }
      const data = await redis.get(KEY);
      res.status(200).json(data || null);
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { /* leave as-is */ }
      }
      if (!body || typeof body !== 'object' || !Array.isArray(body.properties)) {
        res.status(400).json({ error: '無效的資料格式' });
        return;
      }

      const cur = await redis.get(KEY);
      const curV = (cur && typeof cur._v === 'number') ? cur._v : 0;

      // 版本檢查：送來的版本必須等於雲端目前版本，否則代表這個畫面是舊的（或網頁版本過舊），拒絕覆蓋
      if (typeof body.baseVersion !== 'number' || body.baseVersion !== curV) {
        await pushLog({ t: Date.now(), type: 'conflict', device: deviceHint(req) });
        res.status(409).json({
          error: '資料已被其他人更新（或網頁版本過舊），請重新整理頁面載入最新資料',
          code: 'conflict',
          currentVersion: curV,
        });
        return;
      }

      // 覆蓋前，先把「舊資料」留一份備份（每 6 小時時段只留第一份，保留 30 天）
      if (cur) {
        try { await redis.set(BACKUP_PREFIX + backupBucket(), cur, { nx: true, ex: BACKUP_TTL }); } catch (e) { /* ignore */ }
      }

      const { baseVersion, ...rest } = body;
      const newV = curV + 1;
      const newState = { ...rest, _v: newV, _updatedAt: Date.now() };
      await redis.set(KEY, newState);

      try {
        const d = diffState(cur, newState);
        if (d.added.length || d.removed.length || d.removedRecords || d.addedMonths.length || d.removedMonths.length) {
          await pushLog({ t: Date.now(), type: 'change', device: deviceHint(req), ...d });
        }
      } catch (e) { /* ignore */ }

      res.status(200).json({ ok: true, version: newV });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || '伺服器發生錯誤' });
  }
};
