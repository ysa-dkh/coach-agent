require('dotenv').config();
const express = require('express');
const path = require('path');

const redis = require('./src/redis');
const db = require('./src/db');
const { startLoop } = require('./src/worker');
const { registerTeacherRoutes } = require('./src/teacher/routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Sante ----
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/redis-status', (req, res) => res.json({
  configured: redis.isConfigured(),
  ready: redis.isReady(),
}));

// ---- Cockpit prof (dashboard + API + rapports) ----
registerTeacherRoutes(app);

// ---- Liste des exos (pour le menu deroulant du front) ----
app.get('/api/exos', async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(503).json({ error: 'Postgres non configure.' });
    const exos = await db.query('select id, enonce, skill_id, difficulte from exos order by id');
    res.json({ exos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Soumission de code -> insert + enqueue ----
app.post('/api/submit', async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(503).json({ error: 'Postgres non configure.' });
    const { eleve_id = 'demo', exo_id, code } = req.body || {};
    if (!exo_id || !code) return res.status(400).json({ error: 'exo_id et code requis.' });

    const row = await db.one(
      'insert into soumissions (eleve_id, exo_id, code) values ($1, $2, $3) returning id',
      [eleve_id, exo_id, code]
    );
    const soumission_id = row.id;
    await redis.enqueue({ soumission_id });
    await redis.setResult(soumission_id, { soumission_id, status: 'pending' });

    console.log(`[submit] soumission ${soumission_id} (exo=${exo_id}) inseree + mise en file Redis`);
    res.json({ soumission_id, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Polling du resultat ----
app.get('/api/result/:id', async (req, res) => {
  try {
    const result = await redis.getResult(req.params.id);
    if (!result) return res.json({ status: 'unknown' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] coach-agent ecoute sur le port ${PORT}`);
  // En local, on fait tourner le worker dans le meme process (un seul `npm start`).
  if (process.env.INLINE_WORKER === '1') {
    console.log('[server] INLINE_WORKER=1 -> worker lance dans le process web');
    startLoop().catch((e) => console.error('[server] worker inline arrete:', e.message));
  }
});
