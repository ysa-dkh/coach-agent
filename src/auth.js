// Auth legere (demo) : portail de connexion. Prof = mot de passe (compte unique).
// Eleve = simple login par nom. Cookies HttpOnly, pas de store externe.
const db = require('./db');

const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'prof2026';
const TEACHER_USER = process.env.TEACHER_USER || 'prof';

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);
}
function clearCookie(res, name) {
  res.append('Set-Cookie', `${name}=; HttpOnly; Path=/; Max-Age=0`);
}

function currentUser(req) {
  const c = parseCookies(req);
  return { role: c.coach_role || null, eleveId: c.coach_eleve || null, nom: c.coach_nom || null };
}

// Middleware : protege le cockpit prof.
function requireTeacher(req, res, next) {
  const u = currentUser(req);
  if (u.role === 'teacher') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Connexion prof requise.' });
  return res.redirect('/login');
}

function loginPage(error) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Coach Agent — Connexion</title>
<style>
  body{margin:0;background:#0b0d12;color:#e6e8ef;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    display:flex;min-height:100vh;align-items:center;justify-content:center}
  .box{width:340px;background:#12151c;border:1px solid #1f2430;border-radius:16px;padding:28px}
  h1{font-size:22px;margin:0 0 4px}p.s{color:#8a91a3;margin:0 0 20px;font-size:14px}
  .tabs{display:flex;gap:8px;margin-bottom:16px}
  .tab{flex:1;text-align:center;padding:8px;border-radius:8px;background:#0b0d12;border:1px solid #1f2430;cursor:pointer;font-size:13px}
  .tab.active{background:#7c5cff;border-color:#7c5cff;color:#fff;font-weight:600}
  label{display:block;font-size:12px;color:#8a91a3;margin:10px 0 4px}
  input{width:100%;padding:10px 12px;border-radius:9px;border:1px solid #1f2430;background:#0b0d12;color:#e6e8ef;font-size:14px}
  button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:9px;background:#7c5cff;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
  .err{background:#3a1620;color:#f87171;padding:8px 10px;border-radius:8px;font-size:13px;margin-bottom:12px}
  form{display:none}form.active{display:block}
</style></head><body><div class="box">
  <h1>Coach Agent</h1><p class="s">Connecte-toi pour continuer.</p>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div class="tabs">
    <div class="tab active" id="t-eleve" onclick="sw('eleve')">Élève</div>
    <div class="tab" id="t-prof" onclick="sw('prof')">Prof</div>
  </div>
  <form id="f-eleve" class="active" method="POST" action="/login/student">
    <label>Ton nom</label><input name="nom" placeholder="Ex: Marie Dupont" required autofocus>
    <button>Entrer comme élève</button>
  </form>
  <form id="f-prof" method="POST" action="/login/teacher">
    <label>Identifiant</label><input name="user" value="prof">
    <label>Mot de passe</label><input name="password" type="password" required>
    <button>Accéder au cockpit prof</button>
  </form>
  <script>
    function sw(w){
      for(const x of ['eleve','prof']){
        document.getElementById('t-'+x).classList.toggle('active', x===w);
        document.getElementById('f-'+x).classList.toggle('active', x===w);
      }
    }
  </script>
</div></body></html>`;
}

function slugId(nom) {
  return 'el-' + nom.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function registerAuthRoutes(app) {
  app.get('/login', (req, res) => res.send(loginPage(null)));

  app.post('/login/teacher', (req, res) => {
    const { user, password } = req.body || {};
    if (user === TEACHER_USER && password === TEACHER_PASSWORD) {
      setCookie(res, 'coach_role', 'teacher');
      return res.redirect('/teacher');
    }
    res.status(401).send(loginPage('Identifiant ou mot de passe incorrect.'));
  });

  app.post('/login/student', async (req, res) => {
    try {
      const nom = (req.body && req.body.nom || '').trim();
      if (!nom) return res.status(400).send(loginPage('Entre ton nom.'));
      const id = slugId(nom);
      await db.query(
        `insert into eleves (id, nom) values ($1, $2) on conflict (id) do update set nom = $2`,
        [id, nom]
      );
      setCookie(res, 'coach_eleve', id);
      setCookie(res, 'coach_nom', nom);
      res.redirect('/');
    } catch (e) {
      console.error('[auth]', e.message);
      res.status(500).send(loginPage('Erreur, reessaie.'));
    }
  });

  app.get('/logout', (req, res) => {
    clearCookie(res, 'coach_role'); clearCookie(res, 'coach_eleve'); clearCookie(res, 'coach_nom');
    res.redirect('/login');
  });

  app.get('/api/me', (req, res) => res.json(currentUser(req)));
}

module.exports = { registerAuthRoutes, requireTeacher, currentUser };
