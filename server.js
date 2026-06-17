require('dotenv').config();
const express = require('express');
const path = require('path');

const redis = require('./src/redis');
const db = require('./src/db');
const { startLoop } = require('./src/worker');
const { registerTeacherRoutes } = require('./src/teacher/routes');
const { registerAuthRoutes, requireTeacher, currentUser } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false }));

// ---- Sante (toujours public, pour Scalingo) ----
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/redis-status', (req, res) => res.json({
  configured: redis.isConfigured(),
  ready: redis.isReady(),
}));

// ---- Auth (portail de connexion) ----
registerAuthRoutes(app);

// ---- Cockpit prof : protege par login prof ----
app.use('/teacher', requireTeacher);
app.use('/api/teacher', requireTeacher);
registerTeacherRoutes(app);

// ---- Page eleve : protegee par login eleve (ou prof) ----
app.get('/', (req, res) => {
  const u = currentUser(req);
  if (!u.eleveId && u.role !== 'teacher') return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ---- Liste des exos (menu deroulant) ----
app.get('/api/exos', async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(503).json({ error: 'Postgres non configure.' });
    const exos = await db.query('select id, enonce, skill_id, difficulte from exos order by id');
    res.json({ exos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Soumission de code -> insert + enqueue (eleve = utilisateur connecte) ----
app.post('/api/submit', async (req, res) => {
  try {
    if (!db.isConfigured()) return res.status(503).json({ error: 'Postgres non configure.' });
    const u = currentUser(req);
    const eleve_id = u.eleveId || (req.body && req.body.eleve_id) || 'demo';
    const { exo_id, code } = req.body || {};
    if (!exo_id || !code) return res.status(400).json({ error: 'exo_id et code requis.' });

    const row = await db.one(
      'insert into soumissions (eleve_id, exo_id, code) values ($1, $2, $3) returning id',
      [eleve_id, exo_id, code]
    );
    const soumission_id = row.id;
    await redis.enqueue({ soumission_id });
    await redis.setResult(soumission_id, { soumission_id, status: 'pending' });

    console.log(`[submit] soumission ${soumission_id} (eleve=${eleve_id}, exo=${exo_id}) inseree + mise en file Redis`);
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
  if (process.env.INLINE_WORKER === '1') {
    console.log('[server] INLINE_WORKER=1 -> worker lance dans le process web');
    startLoop().catch((e) => console.error('[server] worker inline arrete:', e.message));
  }
});
