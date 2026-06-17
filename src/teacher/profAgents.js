// Agents cote prof : analyse du style de code, knowledge tracer, et rapport pedagogique.
// Regle absolue : on parle APPRENTISSAGE, jamais triche/accusation. Ancre sur les vraies donnees.
// Si l'IA echoue -> repli deterministe (le dashboard ne casse jamais).
const db = require('../db');
const gemini = require('../gemini');
const { Type } = gemini;
const { teachingAction } = require('../data/skills');

const ANTI_ACCUSATION = `Regles strictes :
- Tu aides un PROF a comprendre l'apprentissage, tu n'es PAS un detecteur de triche.
- N'accuse jamais. Ne parle jamais de triche, de plagiat, de "code genere par IA", de note.
- Si une trajectoire est etrange, parle de "courbe d'apprentissage incoherente" ou "besoin de soutien", jamais de suspicion.
- N'invente aucune donnee. Si les preuves manquent, dis-le explicitement.
- Concis et actionnable.`;

// --- Agent 1 : analyse du style de code de l'eleve ---
async function analyzeCodingStyle({ displayName, codes }) {
  const fallback = {
    observations: ['Pas assez de soumissions pour une analyse fine du style.'],
    forces: [],
    pistes: ['Encourager l\'eleve a continuer pour collecter plus d\'exemples.'],
  };
  if (!codes || !codes.length || !gemini.hasGemini()) return fallback;
  try {
    const prompt = `${ANTI_ACCUSATION}

Tu analyses le STYLE DE CODE Python de l'eleve "${displayName}" (lisibilite, nommage, structure, idiomes), dans un but PEDAGOGIQUE.
Ne juge pas la correction (c'est le role des tests), juge la forme et les habitudes.

CODES SOUMIS (du plus ancien au plus recent) :
${codes.map((c, i) => `--- soumission ${i + 1} ---\n${c}`).join('\n\n')}

Renvoie un JSON { "observations": string[], "forces": string[], "pistes": string[] }.
- observations : ce que tu remarques sur le style (factuel).
- forces : bonnes habitudes a renforcer.
- pistes : suggestions concretes d'amelioration de style (pas la solution).`;
    const out = await gemini.genJSON(prompt, {
      type: Type.OBJECT,
      properties: {
        observations: { type: Type.ARRAY, items: { type: Type.STRING } },
        forces: { type: Type.ARRAY, items: { type: Type.STRING } },
        pistes: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['observations', 'forces', 'pistes'],
    });
    return out;
  } catch (e) {
    return fallback;
  }
}

// --- Agent 2 : knowledge tracer (etat de maitrise par notion, ancre sur le cours) ---
async function knowledgeTracer({ displayName, knowledge, recurring, courseTitles }) {
  const fallbackSkills = (knowledge || []).map((k) => ({
    skillId: k.skillId,
    label: k.label,
    etat: k.estimate >= 0.7 ? 'maitrise' : k.estimate >= 0.45 ? 'en cours' : 'fragile',
    commentaire: `Maitrise estimee ${Math.round(k.estimate * 100)}% sur ${k.attempts} tentative(s), tendance ${k.trend}.`,
  }));
  const fallback = {
    skills: fallbackSkills,
    instable: fallbackSkills.filter((s) => s.etat === 'fragile').map((s) => s.label),
    synthese: knowledge && knowledge.length
      ? `Suivi base sur ${knowledge.reduce((a, k) => a + k.attempts, 0)} tentative(s).`
      : 'Pas encore assez de donnees pour tracer la maitrise.',
  };
  if (!knowledge || !knowledge.length || !gemini.hasGemini()) return fallback;
  try {
    const prompt = `${ANTI_ACCUSATION}

Tu es un KNOWLEDGE TRACER. A partir de la maitrise estimee par notion et des erreurs recurrentes de l'eleve "${displayName}", tu donnes l'etat de ses connaissances PAR RAPPORT AU COURS.

NOTIONS DU COURS : ${courseTitles.join(', ')}.

MAITRISE ESTIMEE PAR NOTION (knowledge tracing) :
${JSON.stringify(knowledge.map((k) => ({ notion: k.label, estimation: k.estimate, tentatives: k.attempts, tendance: k.trend })), null, 2)}

ERREURS RECURRENTES : ${JSON.stringify(recurring.map((r) => ({ type: r.misconceptionId, occurrences: r.occurrences })))}

Renvoie un JSON { "skills": [{"skillId": string, "label": string, "etat": "maitrise"|"en cours"|"fragile", "commentaire": string}], "instable": string[], "synthese": string }.
- "instable" : notions dont la courbe est fragile ou incoherente (a consolider).
- "synthese" : 2 phrases max, orientees apprentissage.`;
    const out = await gemini.genJSON(prompt, {
      type: Type.OBJECT,
      properties: {
        skills: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              skillId: { type: Type.STRING },
              label: { type: Type.STRING },
              etat: { type: Type.STRING, enum: ['maitrise', 'en cours', 'fragile'] },
              commentaire: { type: Type.STRING },
            },
            required: ['skillId', 'label', 'etat', 'commentaire'],
          },
        },
        instable: { type: Type.ARRAY, items: { type: Type.STRING } },
        synthese: { type: Type.STRING },
      },
      required: ['skills', 'instable', 'synthese'],
    });
    return out;
  } catch (e) {
    return fallback;
  }
}

// --- Rapport classe (ancre, repli deterministe) ---
async function generateClassReport(overview, misconceptionStats) {
  let report;
  const evidence = [
    `${overview.totalStudents} eleves, ${overview.activeStudents} actifs.`,
    `${overview.blockedStudents} eleve(s) en difficulte (bloque/incoherent).`,
    `Progression moyenne ${Math.round(overview.averageProgress * 100)}%.`,
    ...misconceptionStats.slice(0, 3).map((m) => `${m.misconceptionId}: ${m.occurrences} occurrences sur ${m.affectedStudents} eleve(s).`),
  ];
  const fallback = {
    title: 'Etat d\'apprentissage de la classe',
    summary: `Sur ${overview.totalStudents} eleves, ${overview.studentsNeedingAttention.length} a soutenir en priorite. ` +
      (misconceptionStats[0] ? `Difficulte principale : ${misconceptionStats[0].skillLabel || misconceptionStats[0].misconceptionId}.` : 'Pas de difficulte dominante.'),
    highlights: [`${overview.activeStudents}/${overview.totalStudents} eleves actifs.`],
    concerns: overview.studentsNeedingAttention.map((s) => `${s.displayName} : ${s.statusLabel}.`),
    recommendedActions: misconceptionStats.slice(0, 2).map((m) => m.suggestedTeachingAction),
    evidence,
  };

  if (gemini.hasGemini()) {
    try {
      const prompt = `${ANTI_ACCUSATION}

Tu rediges un rapport COURT pour un prof de programmation, sur l'etat d'apprentissage de SA CLASSE.

DONNEES :
${JSON.stringify({ overview, misconceptions: misconceptionStats.slice(0, 6) }, null, 2)}

Renvoie un JSON { "title": string, "summary": string, "highlights": string[], "concerns": string[], "recommendedActions": string[], "evidence": string[] }.
Concentre-toi sur : qui progresse, quelles notions sont fragiles, ou le prof doit passer son temps. Pas de note, pas de triche.`;
      report = await gemini.genJSON(prompt, {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
          concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'summary', 'highlights', 'concerns', 'recommendedActions', 'evidence'],
      });
    } catch (e) {
      report = fallback;
    }
  } else {
    report = fallback;
  }

  const saved = await db.one(
    `insert into reports (scope, eleve_id, titre, resume, payload)
     values ('class', null, $1, $2, $3) returning id, date`,
    [report.title, report.summary, JSON.stringify(report)]
  );
  return { ...report, id: saved.id, generatedAt: saved.date };
}

// --- Rapport eleve (ancre, repli deterministe) ---
async function generateStudentReport(detail, codingStyle, tracer) {
  const evidence = [
    `${detail.timeline.length} soumission(s).`,
    `Tendance : ${detail.progressTrend}.`,
    ...detail.recurringMisconceptions.slice(0, 3).map((m) => `${m.misconceptionId}: ${m.occurrences}x.`),
  ];
  const fallback = {
    title: `Suivi de ${detail.student.nom}`,
    summary: `Tendance ${detail.progressTrend}. ${detail.statusLabel}. ` + detail.teacherRecommendation,
    strengths: (codingStyle.forces || []).slice(0, 3),
    difficulties: detail.recurringMisconceptions.slice(0, 3).map((m) => m.misconceptionId),
    recommendedTeacherAction: detail.teacherRecommendation,
    evidence,
  };
  let report = fallback;
  if (gemini.hasGemini()) {
    try {
      const prompt = `${ANTI_ACCUSATION}

Tu rediges un rapport COURT sur l'apprentissage de l'eleve "${detail.student.nom}" pour son prof.

DONNEES :
${JSON.stringify({
  tendance: detail.progressTrend,
  priorisation: detail.statusLabel,
  erreurs_recurrentes: detail.recurringMisconceptions,
  knowledge_tracer: tracer,
  style_de_code: codingStyle,
}, null, 2)}

Renvoie un JSON { "title": string, "summary": string, "strengths": string[], "difficulties": string[], "recommendedTeacherAction": string, "evidence": string[] }.`;
      report = await gemini.genJSON(prompt, {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          difficulties: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendedTeacherAction: { type: Type.STRING },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'summary', 'strengths', 'difficulties', 'recommendedTeacherAction', 'evidence'],
      });
    } catch (e) {
      report = fallback;
    }
  }
  const saved = await db.one(
    `insert into reports (scope, eleve_id, titre, resume, payload)
     values ('student', $1, $2, $3, $4) returning id, date`,
    [detail.student.id, report.title, report.summary, JSON.stringify(report)]
  );
  return { ...report, id: saved.id, generatedAt: saved.date };
}

module.exports = { analyzeCodingStyle, knowledgeTracer, generateClassReport, generateStudentReport };
