// Rendu HTML du cockpit prof. Langage 100% apprentissage, zero accusation.
const { attentionLabel } = require('../data/skills');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function badgeClass(score) {
  if (score >= 75) return 'b-prio';
  if (score >= 50) return 'b-support';
  if (score >= 25) return 'b-watch';
  return 'b-ok';
}

function trendLabel(t) {
  return { improving: 'En progression', stable: 'Stable', blocked: 'Bloque',
    incoherente: 'Courbe incoherente', insufficient_data: 'Donnees insuffisantes' }[t] || t;
}
function trendClass(t) {
  return { improving: 'b-ok', stable: 'b-watch', blocked: 'b-support',
    incoherente: 'b-prio', insufficient_data: 'b-muted' }[t] || 'b-muted';
}

// petite courbe d'apprentissage en SVG (maitrise 0..1 au fil des tentatives)
function sparkline(curve) {
  if (!curve || curve.length < 1) return '<span class="muted">—</span>';
  const W = 140, H = 36, pad = 3;
  const pts = curve.map((p, i) => {
    const x = pad + (curve.length === 1 ? 0 : (i * (W - 2 * pad)) / (curve.length - 1));
    const y = H - pad - p.mastery * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = curve[curve.length - 1].mastery;
  const col = last >= 0.7 ? '#16a34a' : last >= 0.45 ? '#d97706' : '#dc2626';
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <polyline fill="none" stroke="${col}" stroke-width="2" points="${pts}"/>
    ${curve.map((p, i) => { const x = pad + (curve.length === 1 ? 0 : (i * (W - 2 * pad)) / (curve.length - 1)); const y = H - pad - p.mastery * (H - 2 * pad); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${col}"/>`; }).join('')}
  </svg>`;
}

function layout(title, body) {
  return `<!DOCTYPE html><html lang="fr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--bd:#e5e7eb;--tx:#111827;--mut:#6b7280;--ac:#4f46e5}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 20px}
  a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}
  h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 12px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
  .lead{color:var(--mut);margin:0 0 8px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:16px}
  .kpi{font-size:30px;font-weight:700}.kpi-l{color:var(--mut);font-size:13px}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--bd);font-size:14px}
  th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase}
  tr:last-child td{border-bottom:0}
  .badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:600}
  .b-ok{background:#dcfce7;color:#166534}.b-watch{background:#fef9c3;color:#854d0e}
  .b-support{background:#ffedd5;color:#9a3412}.b-prio{background:#fee2e2;color:#991b1b}
  .b-muted{background:#f3f4f6;color:#6b7280}
  .muted{color:var(--mut)}
  .btn{display:inline-block;background:var(--ac);color:#fff;border:0;border-radius:9px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer}
  .pill{background:#eef2ff;color:#3730a3;padding:2px 8px;border-radius:6px;font-size:12px}
  .li{padding:8px 0;border-bottom:1px solid var(--bd);font-size:14px}.li:last-child{border:0}
  .row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  .tl{border-left:2px solid var(--bd);padding-left:14px;margin-left:6px}
  .tl-item{position:relative;padding:8px 0}
  .tl-item::before{content:'';position:absolute;left:-21px;top:13px;width:8px;height:8px;border-radius:50%;background:var(--ac)}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function dashboardView(o) {
  const kpis = `<div class="grid">
    <div class="card"><div class="kpi">${o.totalStudents}</div><div class="kpi-l">Eleves</div></div>
    <div class="card"><div class="kpi">${o.activeStudents}</div><div class="kpi-l">Actifs</div></div>
    <div class="card"><div class="kpi">${o.blockedStudents}</div><div class="kpi-l">En difficulte</div></div>
    <div class="card"><div class="kpi">${Math.round(o.averageProgress * 100)}%</div><div class="kpi-l">Progression moy.</div></div>
  </div>`;

  const attention = o.studentsNeedingAttention.length
    ? `<table><tr><th>Eleve</th><th>Signal</th><th>Tendance</th><th></th></tr>` +
      o.studentsNeedingAttention.map((s) => `<tr>
        <td>${esc(s.displayName)}</td>
        <td><span class="badge ${badgeClass(s.needsAttentionScore)}">${esc(s.statusLabel)}</span></td>
        <td><span class="badge ${trendClass(s.progressTrend)}">${trendLabel(s.progressTrend)}</span></td>
        <td><a href="/teacher/students/${encodeURIComponent(s.studentId)}">Ouvrir →</a></td>
      </tr>`).join('') + `</table>`
    : `<div class="card muted">Personne ne requiert d'attention prioritaire pour l'instant. 👍</div>`;

  const mis = o.topMisconceptions.length
    ? `<table><tr><th>Notion / difficulte</th><th>Eleves</th><th>Occur.</th><th>Action prof suggeree</th></tr>` +
      o.topMisconceptions.map((m) => `<tr>
        <td><b>${esc(m.skillLabel || m.misconceptionId)}</b><br><span class="muted">${esc(m.misconceptionId)}</span></td>
        <td>${m.affectedStudents}</td><td>${m.occurrences}</td>
        <td>${esc(m.suggestedTeachingAction)}</td>
      </tr>`).join('') + `</table>`
    : `<div class="card muted">Aucune difficulte recurrente detectee.</div>`;

  const interv = o.recentInterventions.length
    ? o.recentInterventions.map((i) => `<div class="li row">
        <span>${esc(i.eleve_nom)} · <span class="pill">${esc(i.type)}</span> ${esc(i.misconception || '')}</span>
        <span class="muted">${new Date(i.date).toLocaleString('fr-FR')}</span></div>`).join('')
    : `<div class="muted">Aucune intervention recente.</div>`;

  return layout('Cockpit prof', `
    <div class="row"><h1>Coach Agent — Cockpit prof</h1>
      <form method="POST" action="/teacher/reports/generate"><button class="btn">Generer un rapport de classe</button></form></div>
    <p class="lead">Ou passer mes 30 prochaines minutes pour maximiser l'apprentissage ? Des signaux, pas de surveillance.</p>
    ${kpis}
    <h2>Eleves a soutenir en priorite</h2>${attention}
    <h2>Notions les plus difficiles (classe)</h2>${mis}
    <h2>Interventions recentes du coach</h2><div class="card">${interv}</div>
    <p style="margin-top:24px"><a href="/teacher/reports">Voir les rapports →</a> · <a href="/teacher/students">Tous les eleves →</a></p>
  `);
}

function studentsListView(students) {
  const rows = students.map((s) => `<tr>
    <td><a href="/teacher/students/${encodeURIComponent(s.studentId)}">${esc(s.displayName)}</a></td>
    <td>${s.totalSubmissions}</td>
    <td>${s.successRate === null ? '<span class="muted">—</span>' : Math.round(s.successRate * 100) + '%'}</td>
    <td>${esc(s.topMisconception || '—')}</td>
    <td><span class="badge ${trendClass(s.progressTrend)}">${trendLabel(s.progressTrend)}</span></td>
    <td><span class="badge ${badgeClass(s.needsAttentionScore)}">${esc(s.statusLabel)}</span></td>
  </tr>`).join('');
  return layout('Eleves', `<p><a href="/teacher">← Cockpit</a></p><h1>Tous les eleves</h1>
    <table><tr><th>Eleve</th><th>Soumissions</th><th>Reussite</th><th>Difficulte</th><th>Tendance</th><th>Signal</th></tr>${rows}</table>`);
}

function studentView(d, codingStyle, tracer, latestReport) {
  const skills = d.knowledge.length
    ? `<table><tr><th>Notion</th><th>Courbe d'apprentissage</th><th>Maitrise</th><th>Tendance</th></tr>` +
      d.knowledge.map((k) => `<tr>
        <td>${esc(k.label)}</td><td>${sparkline(k.curve)}</td>
        <td>${Math.round(k.estimate * 100)}% <span class="muted">(${k.attempts} tent.)</span></td>
        <td><span class="badge ${trendClass(k.trend)}">${trendLabel(k.trend)}</span></td>
      </tr>`).join('') + `</table>`
    : `<div class="card muted">Pas encore de donnees de maitrise.</div>`;

  const tl = d.timeline.length
    ? `<div class="tl">` + d.timeline.slice().reverse().map((t) => `<div class="tl-item">
        <b>${esc(t.exo)}</b> · ${t.successRate === null ? 'pas de tests' : Math.round(t.successRate * 100) + '% reussite'}
        ${t.misconception && t.misconception !== 'aucune_misconception' ? ` · <span class="pill">${esc(t.misconception)}</span>` : ''}
        ${t.interventionType ? ` · coach: ${esc(t.interventionType)}` : ''}
        <div class="muted">${new Date(t.at).toLocaleString('fr-FR')}</div></div>`).join('') + `</div>`
    : `<div class="muted">Aucune activite.</div>`;

  const style = `<div class="card">
    ${(codingStyle.forces || []).length ? `<b>Forces :</b><ul>${codingStyle.forces.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(codingStyle.observations || []).length ? `<b>Observations :</b><ul>${codingStyle.observations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(codingStyle.pistes || []).length ? `<b>Pistes :</b><ul>${codingStyle.pistes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>`;

  const trace = `<div class="card"><p>${esc(tracer.synthese)}</p>
    ${(tracer.instable || []).length ? `<p><b>A consolider :</b> ${tracer.instable.map((x) => `<span class="pill">${esc(x)}</span>`).join(' ')}</p>` : ''}</div>`;

  const rep = latestReport ? `<div class="card"><b>${esc(latestReport.titre)}</b><p>${esc(latestReport.resume)}</p>
    <span class="muted">${new Date(latestReport.date).toLocaleString('fr-FR')}</span></div>` : '';

  return layout(`Eleve ${d.student.nom}`, `
    <p><a href="/teacher">← Cockpit</a></p>
    <div class="row"><h1>${esc(d.student.nom)}</h1>
      <span class="badge ${badgeClass(d.needsAttentionScore)}">${esc(d.statusLabel)} (${d.needsAttentionScore}/100)</span></div>
    <p class="lead">Tendance : <span class="badge ${trendClass(d.progressTrend)}">${trendLabel(d.progressTrend)}</span></p>
    <div class="card" style="border-color:var(--ac)"><b>Recommandation pour le prof</b><p>${esc(d.teacherRecommendation)}</p></div>
    <h2>Maitrise par notion (knowledge tracing)</h2>${skills}
    <h2>Knowledge tracer (vs cours)</h2>${trace}
    <h2>Style de code</h2>${style}
    <h2>Trajectoire</h2>${tl}
    ${rep ? `<h2>Dernier rapport</h2>${rep}` : ''}
    <form method="POST" action="/teacher/students/${encodeURIComponent(d.student.id)}/report" style="margin-top:18px">
      <button class="btn">Generer un rapport eleve</button></form>
  `);
}

function reportsView(reports) {
  const items = reports.length ? reports.map((r) => `<div class="card">
    <div class="row"><b>${esc(r.titre)}</b><span class="pill">${esc(r.scope)}</span></div>
    <p>${esc(r.resume)}</p>
    ${r.payload && r.payload.recommendedActions ? `<b>Actions :</b><ul>${(r.payload.recommendedActions || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${r.payload && r.payload.evidence ? `<details><summary class="muted">Preuves</summary><ul>${(r.payload.evidence || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
    <span class="muted">${new Date(r.date).toLocaleString('fr-FR')}</span>
  </div>`).join('') : `<div class="card muted">Aucun rapport. Genere-en un depuis le cockpit.</div>`;
  return layout('Rapports', `<p><a href="/teacher">← Cockpit</a></p><h1>Rapports pedagogiques</h1>
    <form method="POST" action="/teacher/reports/generate" style="margin:10px 0"><button class="btn">Generer un rapport de classe</button></form>${items}`);
}

module.exports = { layout, dashboardView, studentsListView, studentView, reportsView };
