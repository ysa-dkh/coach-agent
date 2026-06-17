// Routes du cockpit prof (HTML + API JSON). Tout en try/catch : le dashboard ne casse jamais.
const db = require('../db');
const analytics = require('./analytics');
const agents = require('./profAgents');
const views = require('./views');
const { seedTeacherDemoData } = require('./demoData');

function htmlError(res, err) {
  console.error('[teacher]', err.message);
  res.status(500).send(views.layout('Erreur', '<h1>Donnees du cockpit indisponibles</h1><p>Reessaie dans un instant.</p>'));
}
function jsonError(res, err) {
  console.error('[teacher-api]', err.message);
  res.status(500).json({ error: err.message });
}

async function studentCodes(studentId) {
  const rows = await db.query(
    'select code from soumissions where eleve_id = $1 order by date asc limit 6', [studentId]
  );
  return rows.map((r) => r.code).filter(Boolean);
}
async function latestStudentReport(studentId) {
  return db.one(
    `select * from reports where eleve_id = $1 and scope = 'student' order by date desc limit 1`, [studentId]
  );
}

function registerTeacherRoutes(app) {
  // ---------- HTML ----------
  app.get('/teacher', async (req, res) => {
    try { res.send(views.dashboardView(await analytics.getClassOverview())); }
    catch (e) { htmlError(res, e); }
  });

  app.get('/teacher/students', async (req, res) => {
    try { res.send(views.studentsListView(await analytics.getStudentsOverview())); }
    catch (e) { htmlError(res, e); }
  });

  app.get('/teacher/students/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const detail = await analytics.getStudentDetail(id);
      const courseTitles = (await db.query('select titre from cours')).map((c) => c.titre);
      const [codingStyle, tracer, latestReport] = await Promise.all([
        agents.analyzeCodingStyle({ displayName: detail.student.nom, codes: await studentCodes(id) }),
        agents.knowledgeTracer({ displayName: detail.student.nom, knowledge: detail.knowledge, recurring: detail.recurringMisconceptions, courseTitles }),
        latestStudentReport(id),
      ]);
      res.send(views.studentView(detail, codingStyle, tracer, latestReport));
    } catch (e) { htmlError(res, e); }
  });

  app.get('/teacher/reports', async (req, res) => {
    try {
      const reports = await db.query('select * from reports order by date desc limit 20');
      res.send(views.reportsView(reports));
    } catch (e) { htmlError(res, e); }
  });

  app.post('/teacher/reports/generate', async (req, res) => {
    try {
      const [overview, mis] = await Promise.all([analytics.getClassOverview(), analytics.getMisconceptionStats()]);
      await agents.generateClassReport(overview, mis);
      res.redirect('/teacher/reports');
    } catch (e) { htmlError(res, e); }
  });

  app.post('/teacher/students/:id/report', async (req, res) => {
    try {
      const id = req.params.id;
      const detail = await analytics.getStudentDetail(id);
      const courseTitles = (await db.query('select titre from cours')).map((c) => c.titre);
      const [codingStyle, tracer] = await Promise.all([
        agents.analyzeCodingStyle({ displayName: detail.student.nom, codes: await studentCodes(id) }),
        agents.knowledgeTracer({ displayName: detail.student.nom, knowledge: detail.knowledge, recurring: detail.recurringMisconceptions, courseTitles }),
      ]);
      await agents.generateStudentReport(detail, codingStyle, tracer);
      res.redirect('/teacher/students/' + encodeURIComponent(id));
    } catch (e) { htmlError(res, e); }
  });

  app.post('/teacher/demo/seed', async (req, res) => {
    if (process.env.ENABLE_DEMO_SEED !== 'true') return res.status(403).json({ error: 'Demo seed desactive (ENABLE_DEMO_SEED!=true).' });
    try { res.json(await seedTeacherDemoData()); }
    catch (e) { jsonError(res, e); }
  });

  // ---------- API JSON ----------
  app.get('/api/teacher/overview', async (req, res) => {
    try { res.json(await analytics.getClassOverview()); } catch (e) { jsonError(res, e); }
  });
  app.get('/api/teacher/students', async (req, res) => {
    try { res.json(await analytics.getStudentsOverview()); } catch (e) { jsonError(res, e); }
  });
  app.get('/api/teacher/students/:id', async (req, res) => {
    try { res.json(await analytics.getStudentDetail(req.params.id)); } catch (e) { jsonError(res, e); }
  });
  app.get('/api/teacher/misconceptions', async (req, res) => {
    try { res.json(await analytics.getMisconceptionStats()); } catch (e) { jsonError(res, e); }
  });
  app.get('/api/teacher/interventions/recent', async (req, res) => {
    try { res.json(await analytics.getRecentInterventions(Number(req.query.limit) || 20)); } catch (e) { jsonError(res, e); }
  });
  app.get('/api/teacher/reports/latest', async (req, res) => {
    try { res.json(await db.query('select * from reports order by date desc limit 10')); } catch (e) { jsonError(res, e); }
  });
  app.post('/api/teacher/reports/generate', async (req, res) => {
    try {
      const [overview, mis] = await Promise.all([analytics.getClassOverview(), analytics.getMisconceptionStats()]);
      res.json(await agents.generateClassReport(overview, mis));
    } catch (e) { jsonError(res, e); }
  });
}

module.exports = { registerTeacherRoutes };
