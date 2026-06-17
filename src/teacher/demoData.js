// Donnees de demo cote prof : 4 eleves aux trajectoires d'apprentissage lisibles.
// Idempotent : on purge les soumissions/interventions de ces eleves avant de reinserer.
// Protege par ENABLE_DEMO_SEED (cf route).
const db = require('../db');

const STUDENTS = [
  { id: 'demo-progression', nom: 'Alex Progression', niveau: 0.72, etat: 'ok' },
  { id: 'demo-bloque',      nom: 'Sam Bloque',       niveau: 0.30, etat: 'bloque' },
  { id: 'demo-trivial',     nom: 'Lina Trivial',     niveau: 0.66, etat: 'ok' },
  { id: 'demo-review',      nom: 'Noah Review',      niveau: 0.55, etat: 'a_surveiller' },
];

// suite d'evenements : { exo, passed, total, misconception, type } du plus ancien au recent
const STORIES = {
  'demo-progression': [
    { exo: 'e_somme', passed: 0, total: 4, misc: 'off_by_one', type: 'nudge' },
    { exo: 'e_somme', passed: 2, total: 4, misc: 'off_by_one', type: 'redirect' },
    { exo: 'e_somme', passed: 4, total: 4, misc: 'aucune_misconception', type: 'nudge' },
  ],
  'demo-bloque': [
    { exo: 'e_factorielle', passed: 0, total: 4, misc: 'cas_de_base_manquant', type: 'nudge' },
    { exo: 'e_factorielle', passed: 0, total: 4, misc: 'cas_de_base_manquant', type: 'redirect' },
    { exo: 'e_factorielle', passed: 1, total: 4, misc: 'cas_de_base_manquant', type: 'mini_exo' },
    { exo: 'e_factorielle', passed: 0, total: 4, misc: 'cas_de_base_manquant', type: 'mini_exo' },
  ],
  'demo-trivial': [
    { exo: 'e_double', passed: 1, total: 3, misc: 'confusion_de_type', type: 'nudge' },
    { exo: 'e_double', passed: 3, total: 3, misc: 'aucune_misconception', type: 'nudge' },
  ],
  'demo-review': [
    { exo: 'e_maximum', passed: 3, total: 4, misc: 'comparaison_inversee', type: 'redirect' },
    { exo: 'e_maximum', passed: 3, total: 4, misc: 'comparaison_inversee', type: 'mini_exo' },
  ],
};

function results(passed, total) {
  return {
    available: true, function: 'demo', passed, total, load_error: null,
    results: Array.from({ length: total }, (_, i) => ({ args: [i], expected: i, got: i < passed ? i : null, passed: i < passed, error: null })),
  };
}

async function seedTeacherDemoData() {
  const ids = STUDENTS.map((s) => s.id);

  // upsert eleves
  for (const s of STUDENTS) {
    await db.query(
      `insert into eleves (id, nom, niveau_estime, etat) values ($1,$2,$3,$4)
       on conflict (id) do update set nom=$2, niveau_estime=$3, etat=$4`,
      [s.id, s.nom, s.niveau, s.etat]
    );
  }
  // purge ancienne activite demo (idempotence)
  await db.query('delete from interventions where eleve_id = any($1)', [ids]);
  await db.query('delete from soumissions where eleve_id = any($1)', [ids]);

  let inserted = 0;
  const now = Date.now();
  for (const sid of ids) {
    const story = STORIES[sid] || [];
    for (let k = 0; k < story.length; k++) {
      const ev = story[k];
      // date etalee dans le temps (du plus ancien au recent)
      const date = new Date(now - (story.length - k) * 6 * 3600 * 1000).toISOString();
      const sub = await db.one(
        `insert into soumissions (eleve_id, exo_id, code, resultats_tests, date)
         values ($1,$2,$3,$4,$5) returning id`,
        [sid, ev.exo, `# soumission demo ${k + 1} de ${sid}\n`, JSON.stringify(results(ev.passed, ev.total)), date]
      );
      const conf = ev.misc === 'aucune_misconception' ? 0.95 : 0.85;
      await db.query(
        `insert into interventions (eleve_id, soumission_id, type, misconception, confiance, message, payload, date)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sid, sub.id, ev.type, ev.misc, conf, `[demo] ${ev.type}`, JSON.stringify({ demo: true }), date]
      );
      inserted++;
    }
  }
  return { students: STUDENTS.length, events: inserted };
}

module.exports = { seedTeacherDemoData };
