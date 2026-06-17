// Worker : consomme la file Redis et execute la boucle de feedback complete.
// Peut tourner en process separe (npm run worker) OU dans le web (INLINE_WORKER=1).
require('dotenv').config();
const db = require('./db');
const redis = require('./redis');
const { runTests } = require('./runner');
const { diagnose, coach } = require('./gemini');

const CONFIANCE_MIN = parseFloat(process.env.CONFIANCE_MIN || '0.6');

// Traite une soumission de bout en bout. Renvoie l'objet resultat (aussi stocke en Redis).
async function processJob({ soumission_id }) {
  // 1) Charger soumission + exo + eleve
  const soumission = await db.one('select * from soumissions where id = $1', [soumission_id]);
  if (!soumission) throw new Error('Soumission introuvable: ' + soumission_id);

  const exo = await db.one('select * from exos where id = $1', [soumission.exo_id]);
  const eleve = await db.one('select * from eleves where id = $1', [soumission.eleve_id]);

  // 2) Executer les tests (verite terrain)
  const resultats = await runTests(soumission.code, exo.tests || { cases: [] });
  await db.query('update soumissions set resultats_tests = $1 where id = $2',
    [JSON.stringify(resultats), soumission_id]);

  // 3) Agent Diagnostic (ancre sur les tests reels)
  const diag = await diagnose({ enonce: exo.enonce, code: soumission.code, resultats });

  // 4) Detection de blocage : meme misconception qui se repete (PAS un compteur de push)
  let bloque = false;
  if (diag.misconception !== 'aucune_misconception') {
    const last = await redis.getLastMisconception(soumission.eleve_id, soumission.exo_id);
    let repeat = 0;
    if (last && last.misconception === diag.misconception) {
      repeat = (last.repeat || 0) + 1;
      if (repeat >= 1) bloque = true; // 2e occurrence de la MEME erreur => bloque
    }
    await redis.setLastMisconception(soumission.eleve_id, soumission.exo_id, diag.misconception, repeat);
  } else {
    await redis.setLastMisconception(soumission.eleve_id, soumission.exo_id, 'aucune_misconception', 0);
  }

  // 5) Decision finale : gating par confiance + escalade si blocage
  let decision = diag.decision;
  if (diag.misconception === 'aucune_misconception') {
    decision = 'nudge';
  } else if (diag.confiance < CONFIANCE_MIN) {
    // Pas assez sur pour affirmer -> on redirige vers le cours plutot que d'inventer.
    decision = 'redirect';
  } else if (bloque) {
    // Blocage avere -> remediation appuyee.
    decision = 'mini_exo';
  }

  // 6) Construire le message / la remediation
  let message;
  let payload = { diagnostic: diag, bloque };

  if (decision === 'nudge') {
    message = diag.misconception === 'aucune_misconception'
      ? (resultats.available && resultats.passed === resultats.total
          ? 'Tous les tests passent. Beau boulot — essaie maintenant l\'exo suivant.'
          : 'Tu y es presque. Relis ta sortie ligne par ligne, tu vas voir ou ca coince.')
      : 'Petit detail a corriger : relis le cas qui echoue, tu devrais le reperer seul.';
  } else {
    // redirect / mini_exo : appel a l'agent Coach
    const candidates = await db.query(
      'select id, titre, contenu from cours where skill_id = $1 or skill_id is null',
      [exo.skill_id]
    );

    const coachOut = await coach({
      misconception: diag.misconception,
      niveau: eleve ? eleve.niveau_estime : 0.5,
      enonce: exo.enonce,
      candidates: candidates && candidates.length ? candidates : [{ id: 'c_generic', titre: 'Cours', contenu: 'Revois la notion.' }],
    });

    const section = (candidates || []).find((c) => c.id === coachOut.section_id) || null;
    payload.section = section;
    payload.coach = coachOut;

    if (decision === 'redirect') {
      message = `${coachOut.hint}\n\nRegarde la section "${section ? section.titre : coachOut.section_id}" du cours.`;
    } else {
      message = `Tu butes sur le meme point. ${coachOut.hint}\n\nSection a revoir : "${section ? section.titre : coachOut.section_id}". Puis fais ce mini-exo cible avant de revenir a l'exo.`;
    }
  }

  // 7) Mettre a jour l'etat de l'eleve
  if (eleve) {
    let etat = 'ok';
    if (bloque) etat = 'bloque';
    else if (diag.misconception !== 'aucune_misconception') etat = 'a_surveiller';
    let niveau = eleve.niveau_estime;
    if (resultats.available && resultats.total > 0) {
      const ratio = resultats.passed / resultats.total;
      niveau = Math.round((0.7 * Number(niveau) + 0.3 * ratio) * 100) / 100; // lissage
    }
    await db.query('update eleves set etat = $1, niveau_estime = $2 where id = $3',
      [etat, niveau, eleve.id]);
  }

  // 8) Enregistrer l'intervention
  const intervention = await db.one(
    `insert into interventions (eleve_id, soumission_id, type, misconception, confiance, message, payload)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [soumission.eleve_id, soumission_id, decision, diag.misconception, diag.confiance, message, JSON.stringify(payload)]
  );

  // 9) Resultat consolide (pour le front)
  const result = {
    soumission_id,
    status: 'done',
    tests: resultats,
    diagnostic: diag,
    decision,
    bloque,
    message,
    section: payload.section || null,
    coach: payload.coach || null,
    intervention_id: intervention ? intervention.id : null,
  };
  await redis.setResult(soumission_id, result);
  return result;
}

// Boucle worker (process dedie). Robuste aux erreurs par job.
async function startLoop() {
  console.log('[worker] demarre, en attente de jobs...');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const job = await redis.dequeueBlocking(5);
      if (!job) continue;
      console.log('[worker] job recu:', job.soumission_id);
      try {
        await processJob(job);
        console.log('[worker] job termine:', job.soumission_id);
      } catch (err) {
        console.error('[worker] echec job:', err.message);
        await redis.setResult(job.soumission_id, {
          soumission_id: job.soumission_id, status: 'error', message: err.message,
        });
      }
    } catch (loopErr) {
      console.error('[worker] erreur boucle:', loopErr.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

module.exports = { processJob, startLoop };

// Lance la boucle si execute directement (npm run worker)
if (require.main === module) {
  startLoop();
}
