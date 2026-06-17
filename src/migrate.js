// Execute db/schema.sql contre la base, puis verifie le contenu.
// Usage : npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  console.log('[migrate] execution de db/schema.sql ...');
  await db.query(sql);

  console.log('[migrate] verification :');
  for (const t of ['skills', 'cours', 'exos', 'eleves', 'soumissions', 'interventions']) {
    const r = await db.one(`select count(*)::int as n from ${t}`);
    console.log(`  - ${t.padEnd(14)} : ${r.n} lignes`);
  }
  console.log('[migrate] OK.');
  process.exit(0);
}

main().catch((e) => { console.error('[migrate] ECHEC:', e.message); process.exit(1); });
