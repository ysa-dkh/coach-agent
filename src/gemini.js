// Les deux agents (Diagnostic + Coach), pilotes par prompt sur Gemini.
// Sortie JSON forcee par responseSchema -> ancrage anti-hallucination.
require('dotenv').config();
const { GoogleGenAI, Type } = require('@google/genai');
const { MISCONCEPTIONS, LABELS } = require('./taxonomy');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let ai = null;
if (API_KEY) ai = new GoogleGenAI({ apiKey: API_KEY });

function requireAi() {
  if (!ai) throw new Error('GEMINI_API_KEY manquant.');
  return ai;
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
  const client = requireAi();
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

  const response = await client.models.generateContent({
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
  const client = requireAi();
  const sections = candidates
    .map((c) => `### ${c.id} - ${c.titre}\n${c.contenu}`)
    .join('\n\n');
  const ids = candidates.map((c) => c.id);

  const prompt = `Tu es un agent COACH. Tu aides un eleve SANS jamais donner la reponse / le code solution.
L'eleve a la misconception : "${misconception}" (${LABELS[misconception] || misconception}).
Son niveau estime est ${niveau} (0 = debutant, 1 = avance) -> adapte le ton.

ENONCE travaille par l'eleve :
${enonce}

SECTIONS DE COURS CANDIDATES (choisis la PLUS pertinente, par son id) :
${sections}

Produis :
- "section_id" : l'id de la meilleure section parmi : ${ids.join(', ')}.
- "hint" : 2-3 phrases qui orientent vers la bonne piste SANS donner la solution ni le code corrige. Pose une question ou rappelle le principe.
- "mini_exo_enonce" : un mini-exercice court et cible SUR CETTE misconception precise (different de l'enonce d'origine, plus simple).
- "mini_exo_exemple" : un exemple d'entree/sortie attendu pour ce mini-exo (sans donner le code).
Reponds en JSON.`;

  const response = await client.models.generateContent({
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
          mini_exo_enonce: { type: Type.STRING },
          mini_exo_exemple: { type: Type.STRING },
        },
        required: ['section_id', 'hint', 'mini_exo_enonce', 'mini_exo_exemple'],
      },
    },
  });

  return JSON.parse(response.text);
}

module.exports = { diagnose, coach, formatTests };
