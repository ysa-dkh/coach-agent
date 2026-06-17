// Les deux agents (Diagnostic + Coach), pilotes par prompt sur Gemini.
// Sortie JSON forcee par responseSchema -> ancrage anti-hallucination.
require('dotenv').config();
const { GoogleGenAI, Type } = require('@google/genai');
const { MISCONCEPTIONS, LABELS } = require('./taxonomy');

// Pool de cles : GEMINI_API_KEYS (séparées par des virgules) OU GEMINI_API_KEY.
// Bascule auto sur 429/quota vers la cle suivante (cles de projets differents = quotas cumules).
const RAW_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map((k) => k.trim()).filter(Boolean);
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const clients = RAW_KEYS.map((key) => ({ key, ai: new GoogleGenAI({ apiKey: key }), cooldownUntil: 0 }));
let rr = 0; // curseur round-robin (repartit la charge entre les cles)

function hasGemini() { return clients.length > 0; }

function isQuotaError(e) {
  const m = ((e && e.message) || '').toLowerCase();
  return Boolean(e && (e.status === 429 || m.includes('429') || m.includes('resource_exhausted') || m.includes('quota') || m.includes('rate limit')));
}

// Appel Gemini resilient : round-robin + saut des cles en cooldown + bascule sur 429.
async function generate(params) {
  if (!clients.length) throw new Error('Aucune cle Gemini (GEMINI_API_KEYS / GEMINI_API_KEY).');
  const now = Date.now();
  const order = [];
  for (let i = 0; i < clients.length; i++) order.push(clients[(rr + i) % clients.length]);
  rr = (rr + 1) % clients.length;

  let lastErr = null;
  // 2 passes : la 1ere respecte les cooldowns, la 2e les force (apres une pause
  // qui laisse passer un 503/pic de surcharge transitoire).
  for (let pass = 0; pass < 2; pass++) {
    for (const c of order) {
      if (pass === 0 && c.cooldownUntil > Date.now()) continue;
      try {
        return await c.ai.models.generateContent(params);
      } catch (e) {
        lastErr = e;
        if (isQuotaError(e)) c.cooldownUntil = Date.now() + 60000; // quota : repos 1 min
        // on bascule quelle que soit l'erreur (cle morte, quota, 503...)
      }
    }
    if (pass === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  throw lastErr || new Error('Echec Gemini (toutes les cles epuisees).');
}

// Resume compact des resultats de tests pour ancrer le diagnostic.
function formatTests(resultats) {
  if (!resultats || resultats.available === false) {
    return 'AUCUNE suite de tests executee (analyse le code seul, reste prudent).';
  }
  if (resultats.load_error) {
    return `Le code n'a pas pu etre charge/execute : ${resultats.load_error}`;
  }
  const lines = [`Tests : ${resultats.passed}/${resultats.total} reussis.`];
  for (const r of (resultats.results || [])) {
    const status = r.passed ? 'OK' : 'ECHEC';
    const got = r.error ? `ERREUR(${r.error})` : JSON.stringify(r.got);
    lines.push(`  [${status}] args=${JSON.stringify(r.args)} attendu=${JSON.stringify(r.expected)} obtenu=${got}`);
  }
  return lines.join('\n');
}

// ---------------- Agent Diagnostic ----------------
async function diagnose({ enonce, code, resultats }) {
  const taxoList = MISCONCEPTIONS.map((m) => `- ${m} : ${LABELS[m]}`).join('\n');

  const prompt = `Tu es un agent de DIAGNOSTIC pedagogique pour du code Python d'eleve.
Ton diagnostic doit etre ANCRE sur les resultats de tests reels ci-dessous, jamais invente.
Tu dois choisir une misconception UNIQUEMENT dans la taxonomie fermee fournie.

ENONCE :
${enonce}

CODE DE L'ELEVE :
\`\`\`python
${code}
\`\`\`

RESULTATS DE TESTS (verite terrain) :
${formatTests(resultats)}

TAXONOMIE FERMEE (choisis-en exactement une) :
${taxoList}

Regles :
- Si tous les tests passent -> misconception = "aucune_misconception", decision = "nudge", confiance haute.
- Si l'erreur observee ne correspond a aucune entree de la taxo -> "aucune_misconception" avec confiance basse.
- "severite" est RELATIVE : "triviale" si l'erreur est petite/facile a voir, "bloquante" si elle empeche tout.
- "confiance" (0 a 1) = a quel point les tests soutiennent ton diagnostic. Si doute -> mets une confiance basse.
- "decision" : "nudge" (petit coup de pouce), "redirect" (renvoyer au cours), "mini_exo" (exercice cible).
- "explication" : 1 phrase interne, factuelle, qui cite ce que montrent les tests.
Reponds en JSON.`;

  const response = await generate({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          misconception: { type: Type.STRING, enum: MISCONCEPTIONS },
          severite: { type: Type.STRING, enum: ['triviale', 'moderee', 'bloquante'] },
          confiance: { type: Type.NUMBER },
          decision: { type: Type.STRING, enum: ['nudge', 'redirect', 'mini_exo'] },
          explication: { type: Type.STRING },
        },
        required: ['misconception', 'severite', 'confiance', 'decision', 'explication'],
      },
    },
  });

  return JSON.parse(response.text);
}

// ---------------- Agent Coach (remediation) ----------------
// candidates = [{ id, titre, contenu }]
async function coach({ misconception, niveau, enonce, candidates }) {
  const sections = candidates
    .map((c) => `### ${c.id} - ${c.titre}\n${c.contenu}`)
    .join('\n\n');
  const ids = candidates.map((c) => c.id);

  const prompt = `Tu es un agent COACH. REGLE ABSOLUE : tu ne donnes JAMAIS la solution ni le code corrige, et tu n'EXPLIQUES PAS comment resoudre l'exercice. Ton role = RENVOYER l'eleve a la bonne partie du cours et le faire travailler lui-meme (rappel actif).
L'eleve a la misconception : "${misconception}" (${LABELS[misconception] || misconception}).
Son niveau estime est ${niveau} (0 = debutant, 1 = avance) -> adapte le ton.

ENONCE travaille par l'eleve :
${enonce}

SECTIONS DE COURS CANDIDATES (choisis la PLUS pertinente, par son id) :
${sections}

Produis :
- "section_id" : l'id de la meilleure section parmi : ${ids.join(', ')}. C'est CA qu'on montre a l'eleve, en priorite.
- "hint" : 1 a 2 phrases MAX. PAS d'explication de la solution. Juste de quoi l'orienter + l'inviter a relire la section. Tu peux poser UNE question ouverte.
- "qcm" : un QCM de RAPPEL sur la NOTION du cours (pas sur la solution de l'enonce), pour que l'eleve verifie sa comprehension. Objet { "question": court, "options": 3 a 4 propositions, "correct_index": index 0-based de la bonne option, "pourquoi": 1 phrase expliquant la bonne reponse (montree seulement APRES que l'eleve a repondu) }. Le QCM ne doit pas reveler la solution du probleme initial.
- "mini_exo_enonce" : un mini-exercice court et cible SUR CETTE notion (different de l'enonce d'origine, plus simple).
- "mini_exo_exemple" : un exemple d'entree/sortie attendu pour ce mini-exo (sans donner le code).
Reponds en JSON.`;

  const response = await generate({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          section_id: { type: Type.STRING, enum: ids },
          hint: { type: Type.STRING },
          qcm: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correct_index: { type: Type.NUMBER },
              pourquoi: { type: Type.STRING },
            },
            required: ['question', 'options', 'correct_index', 'pourquoi'],
          },
          mini_exo_enonce: { type: Type.STRING },
          mini_exo_exemple: { type: Type.STRING },
        },
        required: ['section_id', 'hint', 'qcm', 'mini_exo_enonce', 'mini_exo_exemple'],
      },
    },
  });

  return JSON.parse(response.text);
}

// Helper generique : prompt -> JSON (pour les agents prof). Renvoie null si echec.
async function genJSON(prompt, responseSchema, temperature = 0.3) {
  const response = await generate({
    model: MODEL,
    contents: prompt,
    config: { temperature, responseMimeType: 'application/json', responseSchema },
  });
  return JSON.parse(response.text);
}

module.exports = { diagnose, coach, formatTests, genJSON, Type, hasGemini, keyCount: () => clients.length };
