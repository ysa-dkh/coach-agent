// Client Redis partage + helpers de file d'attente.
require('dotenv').config();
const { createClient } = require('redis');

const REDIS_URL = process.env.SCALINGO_REDIS_URL || process.env.REDIS_URL;

const QUEUE_KEY = 'coach:queue';
const RESULT_PREFIX = 'coach:result:';   // coach:result:<soumissionId>
const STATE_PREFIX = 'coach:state:';     // coach:state:<eleveId>:<exoId>  -> derniere misconception
const RESULT_TTL = 3600;                 // 1h

let client = null;
let ready = false;

async function getClient() {
  if (client) return client;
  if (!REDIS_URL) throw new Error('SCALINGO_REDIS_URL non defini.');

  client = createClient({ url: REDIS_URL });
  client.on('error', (err) => { ready = false; console.error('[redis] error:', err.message); });
  client.on('ready', () => { ready = true; console.log('[redis] connecte'); });
  client.on('end', () => { ready = false; });
  await client.connect();
  return client;
}

function isConfigured() { return Boolean(REDIS_URL); }
function isReady() { return ready; }

// --- File d'attente ---
async function enqueue(job) {
  const c = await getClient();
  await c.lPush(QUEUE_KEY, JSON.stringify(job));
}

// Bloquant : attend un job (utilise par le worker).
async function dequeueBlocking(timeoutSec = 5) {
  const c = await getClient();
  const res = await c.brPop(QUEUE_KEY, timeoutSec);
  if (!res) return null;
  return JSON.parse(res.element);
}

// --- Resultat (pour le polling du front) ---
async function setResult(soumissionId, result) {
  const c = await getClient();
  await c.set(RESULT_PREFIX + soumissionId, JSON.stringify(result), { EX: RESULT_TTL });
}

async function getResult(soumissionId) {
  const c = await getClient();
  const raw = await c.get(RESULT_PREFIX + soumissionId);
  return raw ? JSON.parse(raw) : null;
}

// --- Etat eleve (detection de blocage : meme misconception qui se repete) ---
async function getLastMisconception(eleveId, exoId) {
  const c = await getClient();
  const raw = await c.get(STATE_PREFIX + eleveId + ':' + exoId);
  return raw ? JSON.parse(raw) : null; // { misconception, repeat }
}

async function setLastMisconception(eleveId, exoId, misconception, repeat) {
  const c = await getClient();
  await c.set(STATE_PREFIX + eleveId + ':' + exoId,
    JSON.stringify({ misconception, repeat }), { EX: RESULT_TTL * 24 });
}

module.exports = {
  getClient, isConfigured, isReady,
  enqueue, dequeueBlocking,
  setResult, getResult,
  getLastMisconception, setLastMisconception,
  QUEUE_KEY,
};
