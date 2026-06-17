const express = require('express');
const path = require('path');
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.SCALINGO_REDIS_URL;

let redisClient = null;
let redisReady = false;

async function initRedis() {
  if (!REDIS_URL) {
    console.warn('[redis] SCALINGO_REDIS_URL is not set; skipping Redis connection.');
    return;
  }

  redisClient = createClient({ url: REDIS_URL });

  redisClient.on('error', (err) => {
    redisReady = false;
    console.error('[redis] client error:', err.message);
  });

  redisClient.on('ready', () => {
    redisReady = true;
    console.log('[redis] connected and ready');
  });

  redisClient.on('end', () => {
    redisReady = false;
    console.log('[redis] connection closed');
  });

  try {
    await redisClient.connect();
    await redisClient.set('coach-agent:boot', new Date().toISOString());
    const value = await redisClient.get('coach-agent:boot');
    console.log('[redis] boot timestamp stored:', value);
  } catch (err) {
    console.error('[redis] failed to connect:', err.message);
  }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/redis-status', (req, res) => {
  res.json({
    configured: Boolean(REDIS_URL),
    ready: redisReady,
  });
});

app.listen(PORT, () => {
  console.log(`[server] coach-agent listening on port ${PORT}`);
  initRedis();
});
