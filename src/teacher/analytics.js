// Moteur d'analyse pedagogique cote prof.
// Transforme soumissions + interventions en signaux d'apprentissage :
// taux de reussite, courbe de maitrise par notion (knowledge tracing), tendance,
// priorisation "a soutenir". Aucune notion de triche.
const db = require('../db');
const { SKILLS, skillForMisconception, teachingAction, attentionLabel } = require('../data/skills');

// --- Lecture brute (1 requete, agregation en JS : dataset classe = petit) ---
async function getAllActivity() {
  return db.query(`
    select s.id as soumission_id, s.eleve_id, s.exo_id, s.date, s.resultats_tests,
           e.skill_id, e.enonce, e.difficulte,
           i.misconception, i.confiance, i.type as intervention_type, i.message, i.payload
    from soumissions s
    join exos e on e.id = s.exo_id
    left join interventions i on i.soumission_id = s.id
    order by s.date asc
  `);
}

async function getStudents() {
  return db.query('select id, nom, niveau_estime, etat from eleves order by nom');
}

// taux de reussite d'une soumission a partir des resultats de tests reels
function successRate(resultats) {
  if (!resultats || resultats.available === false) return null;
  const total = Number(resultats.total || 0);
  if (total === 0) return null;
  return Number(resultats.passed || 0) / total;
}

// --- Knowledge tracing leger (BKT-lite) : courbe de maitrise par notion ---
// Pour chaque notion, on part d'un a priori et on met a jour a chaque tentative
// vers le resultat observe. Produit une COURBE (pour l'affichage) + un etat courant.
function traceKnowledge(rows) {
  const PRIOR = 0.3;
  const ALPHA = 0.45;
  const bySkill = {};

  for (const r of rows) {
    const sk = r.skill_id || 'autre';
    const sr = successRate(r.resultats_tests);
    if (sr === null) continue;
    if (!bySkill[sk]) bySkill[sk] = { skillId: sk, curve: [], attempts: 0 };
    const s = bySkill[sk];
    const prev = s.curve.length ? s.curve[s.curve.length - 1].mastery : PRIOR;
    const mastery = Math.round((prev + ALPHA * (sr - prev)) * 100) / 100;
    s.attempts += 1;
    s.curve.push({ at: r.date, outcome: Math.round(sr * 100) / 100, mastery, exo: r.exo_id });
  }

  return Object.values(bySkill).map((s) => {
    const skillDef = SKILLS.find((x) => x.id === s.skillId);
    const current = s.curve.length ? s.curve[s.curve.length - 1].mastery : PRIOR;
    // detection de regression / incoherence (signal d'apprentissage, PAS de triche)
    let drops = 0, rises = 0;
    for (let i = 1; i < s.curve.length; i++) {
      const d = s.curve[i].mastery - s.curve[i - 1].mastery;
      if (d <= -0.15) drops += 1;
      if (d >= 0.1) rises += 1;
    }
    let trend = 'insufficient_data';
    if (s.curve.length >= 2) {
      if (drops >= 1 && rises >= 1) trend = 'incoherente';      // monte puis redescend
      else if (rises > drops && current > PRIOR) trend = 'improving';
      else if (current < 0.45 && drops === 0 && rises === 0) trend = 'blocked';
      else trend = 'stable';
    }
    // confiance = combien on a d'observations
    const confidence = Math.min(0.95, 0.3 + 0.15 * s.attempts);
    return {
      skillId: s.skillId,
      label: skillDef ? skillDef.label : s.skillId,
      estimate: current,
      confidence: Math.round(confidence * 100) / 100,
      attempts: s.attempts,
      trend,
      curve: s.curve,
    };
  });
}

// misconceptions recurrentes d'un eleve
function recurringMisconceptions(rows) {
  const map = {};
  for (const r of rows) {
    const m = r.misconception;
    if (!m || m === 'aucune_misconception') continue;
    if (!map[m]) map[m] = { misconceptionId: m, occurrences: 0, confSum: 0, lastSeenAt: null };
    map[m].occurrences += 1;
    map[m].confSum += Number(r.confiance || 0);
    map[m].lastSeenAt = r.date;
  }
  return Object.values(map)
    .map((x) => ({ ...x, averageConfidence: Math.round((x.confSum / x.occurrences) * 100) / 100 }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

// tendance globale de l'eleve
function computeProgressTrend(rows) {
  const rates = rows.map((r) => successRate(r.resultats_tests)).filter((x) => x !== null);
  if (rates.length < 2) return 'insufficient_data';
  const firstHalf = rates.slice(0, Math.ceil(rates.length / 2));
  const lastHalf = rates.slice(Math.ceil(rates.length / 2));
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const d = avg(lastHalf) - avg(firstHalf);
  // signal d'incoherence : remonte globalement mais a connu une rechute nette
  let hadDrop = false;
  for (let i = 1; i < rates.length; i++) if (rates[i] - rates[i - 1] <= -0.4) hadDrop = true;
  const avgLast = avg(lastHalf);
  if (d > 0.15 && hadDrop) return 'incoherente';   // remonte mais a rechute
  if (avgLast < 0.4) return 'blocked';             // toujours en echec -> bloque (prioritaire sur improving)
  if (d > 0.1) return 'improving';
  return 'stable';
}

// score de priorisation 0-100 (signal, PAS une note)
function computeNeedsAttentionScore(rows) {
  if (!rows.length) return 0;
  let score = 0;
  const recurring = recurringMisconceptions(rows);
  if (recurring.length && recurring[0].occurrences >= 3) score += 25;
  const last3 = rows.slice(-3);
  const failed = last3.filter((r) => { const sr = successRate(r.resultats_tests); return sr !== null && sr < 1; });
  if (failed.length === last3.length && last3.length >= 1) score += 20;
  const lastInterv = [...rows].reverse().find((r) => r.intervention_type);
  if (lastInterv && lastInterv.intervention_type === 'mini_exo') score += 20;
  const anySuccess = rows.some((r) => successRate(r.resultats_tests) === 1);
  if (!anySuccess) score += 15;
  if (recurring.length && recurring[0].averageConfidence >= 0.7 && recurring[0].occurrences >= 2) score += 10;
  const trend = computeProgressTrend(rows);
  if (trend === 'blocked' || trend === 'incoherente') score += 10;
  return Math.max(0, Math.min(100, score));
}

// --- Vues agregees ---

function groupByStudent(activity) {
  const g = {};
  for (const r of activity) {
    if (!g[r.eleve_id]) g[r.eleve_id] = [];
    g[r.eleve_id].push(r);
  }
  return g;
}

async function getStudentsOverview() {
  const [activity, students] = await Promise.all([getAllActivity(), getStudents()]);
  const byStud = groupByStudent(activity);
  return students.map((st) => {
    const rows = byStud[st.id] || [];
    const rates = rows.map((r) => successRate(r.resultats_tests)).filter((x) => x !== null);
    const successAvg = rates.length ? rates.reduce((s, x) => s + x, 0) / rates.length : null;
    const recurring = recurringMisconceptions(rows);
    const score = computeNeedsAttentionScore(rows);
    return {
      studentId: st.id,
      displayName: st.nom,
      totalSubmissions: rows.length,
      lastSubmissionAt: rows.length ? rows[rows.length - 1].date : null,
      successRate: successAvg === null ? null : Math.round(successAvg * 100) / 100,
      topMisconception: recurring[0] ? recurring[0].misconceptionId : null,
      needsAttentionScore: score,
      statusLabel: attentionLabel(score),
      progressTrend: computeProgressTrend(rows),
      levelEstimate: st.niveau_estime,
    };
  });
}

async function getClassOverview() {
  const overview = await getStudentsOverview();
  const activity = await getAllActivity();
  const totalStudents = overview.length;
  const activeStudents = overview.filter((s) => s.totalSubmissions > 0).length;
  const blockedStudents = overview.filter((s) => s.progressTrend === 'blocked' || s.progressTrend === 'incoherente').length;
  const progresses = overview.map((s) => s.successRate).filter((x) => x !== null);
  const averageProgress = progresses.length ? Math.round((progresses.reduce((a, b) => a + b, 0) / progresses.length) * 100) / 100 : 0;
  const topMisconceptions = (await getMisconceptionStats()).slice(0, 5);
  const recentInterventions = await getRecentInterventions(8);
  const studentsNeedingAttention = overview
    .filter((s) => s.needsAttentionScore >= 50)
    .sort((a, b) => b.needsAttentionScore - a.needsAttentionScore);
  return {
    totalStudents, activeStudents, blockedStudents, averageProgress,
    topMisconceptions, recentInterventions, studentsNeedingAttention,
    generatedAt: new Date().toISOString(),
  };
}

async function getStudentDetail(studentId) {
  const [activity, students] = await Promise.all([getAllActivity(), getStudents()]);
  const student = students.find((s) => s.id === studentId) || { id: studentId, nom: studentId, niveau_estime: null, etat: 'ok' };
  const rows = (groupByStudent(activity)[studentId] || []);
  const knowledge = traceKnowledge(rows);
  const recurring = recurringMisconceptions(rows);
  const trend = computeProgressTrend(rows);
  const score = computeNeedsAttentionScore(rows);
  const timeline = rows.map((r) => ({
    at: r.date,
    exo: r.exo_id,
    successRate: successRate(r.resultats_tests),
    misconception: r.misconception,
    interventionType: r.intervention_type,
    message: r.message,
  }));
  const topMis = recurring[0] ? recurring[0].misconceptionId : null;
  const recommendation = score >= 75
    ? `Point humain court a prioriser. ${topMis ? teachingAction(topMis) : ''}`.trim()
    : (topMis ? teachingAction(topMis) : 'Laisser progresser, l\'etayage du coach suffit pour l\'instant.');
  return {
    student, knowledge, recurringMisconceptions: recurring, progressTrend: trend,
    needsAttentionScore: score, statusLabel: attentionLabel(score),
    teacherRecommendation: recommendation, timeline,
  };
}

async function getMisconceptionStats() {
  const activity = await getAllActivity();
  const map = {};
  for (const r of activity) {
    const m = r.misconception;
    if (!m || m === 'aucune_misconception') continue;
    if (!map[m]) map[m] = { misconceptionId: m, occurrences: 0, students: new Set(), confSum: 0, lastSeenAt: null };
    map[m].occurrences += 1;
    map[m].students.add(r.eleve_id);
    map[m].confSum += Number(r.confiance || 0);
    map[m].lastSeenAt = r.date;
  }
  return Object.values(map).map((x) => {
    const sk = skillForMisconception(x.misconceptionId);
    return {
      misconceptionId: x.misconceptionId,
      skillId: sk ? sk.id : null,
      skillLabel: sk ? sk.label : null,
      affectedStudents: x.students.size,
      occurrences: x.occurrences,
      averageConfidence: Math.round((x.confSum / x.occurrences) * 100) / 100,
      lastSeenAt: x.lastSeenAt,
      suggestedTeachingAction: teachingAction(x.misconceptionId),
    };
  }).sort((a, b) => b.occurrences - a.occurrences);
}

async function getRecentInterventions(limit = 20) {
  return db.query(`
    select i.id, i.eleve_id, el.nom as eleve_nom, i.type, i.misconception, i.confiance, i.message, i.date
    from interventions i
    join eleves el on el.id = i.eleve_id
    order by i.date desc
    limit $1
  `, [limit]);
}

module.exports = {
  getAllActivity, getStudents, getStudentsOverview, getClassOverview,
  getStudentDetail, getMisconceptionStats, getRecentInterventions,
  computeNeedsAttentionScore, computeProgressTrend, traceKnowledge, successRate,
};
