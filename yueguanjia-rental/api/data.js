const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = 'yueguanjia:rental-data';

module.exports = async (req, res) => {
  // Basic CORS (safe even for same-origin use)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    res.status(500).json({
      error: '尚未設定 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 環境變數，請至 Vercel 專案設定新增。',
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const data = await redis.get(KEY);
      res.status(200).json(data || null);
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { /* leave as-is */ }
      }
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: '無效的資料格式' });
        return;
      }
      await redis.set(KEY, body);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || '伺服器發生錯誤' });
  }
};
