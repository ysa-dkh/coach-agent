// Connexion Postgres (Supabase) via le pooler IPv4, driver `pg`.
// Prefere les params discrets (.env) ; sinon DATABASE_URL (prod Scalingo).
require('dotenv').config();
const { Pool } = require('pg');

let pool = null;

function buildPool() {
  const { SUPABASE_DB_HOST, SUPABASE_DB_USER, SUPABASE_DB_PASSWORD, SUPABASE_DB_NAME, SUPABASE_DB_PORT } = process.env;

  if (SUPABASE_DB_HOST && SUPABASE_DB_USER && SUPABASE_DB_PASSWORD) {
    return new Pool({
      host: SUPABASE_DB_HOST,
      port: parseInt(SUPABASE_DB_PORT || '5432', 10),
      user: SUPABASE_DB_USER,
      password: SUPABASE_DB_PASSWORD,
      database: SUPABASE_DB_NAME || 'postgres',
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
  }
  return null;
}

pool = buildPool();
if (!pool) console.warn('[db] Pas de config Postgres (SUPABASE_DB_* ou DATABASE_URL). DB desactivee.');

function isConfigured() { return Boolean(pool); }

function requirePool() {
  if (!pool) throw new Error('Postgres non configure (SUPABASE_DB_* ou DATABASE_URL manquants).');
  return pool;
}

// Helper requete : query(text, params) -> rows[]
async function query(text, params = []) {
  const res = await requirePool().query(text, params);
  return res.rows;
}

// Helper : renvoie la 1ere ligne ou null
async function one(text, params = []) {
  const rows = await query(text, params);
  return rows.length ? rows[0] : null;
}

module.exports = { query, one, isConfigured, requirePool };
