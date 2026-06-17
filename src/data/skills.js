// Grille pedagogique : relie chaque misconception (taxo fermee) a une NOTION,
// et a une action concrete que le prof peut faire. Sert a agreger l'apprentissage
// de la classe et a guider le prof. Aucune notion de triche : que de l'apprentissage.

// Notions = nos skills existants (table skills).
const SKILLS = [
  { id: 'boucles',   label: 'Boucles et bornes',            misconceptions: ['off_by_one', 'mauvaise_borne_de_boucle', 'comparaison_inversee'] },
  { id: 'recursion', label: 'Recursion',                     misconceptions: ['cas_de_base_manquant'] },
  { id: 'types',     label: 'Types et conversions',          misconceptions: ['confusion_de_type'] },
  { id: 'fonctions', label: 'Fonctions : return vs print',   misconceptions: ['retourne_none', 'argument_par_defaut_mutable'] },
  { id: 'indices',   label: 'Indices de liste',              misconceptions: ['index_hors_limites'] },
];

function skillForMisconception(mid) {
  return SKILLS.find((s) => s.misconceptions.includes(mid)) || null;
}

// Action prof concrete par difficulte (deterministe, dispo meme sans LLM).
const TEACHING_ACTIONS = {
  off_by_one: 'Reprendre une boucle au tableau en deroulant la premiere et la derniere iteration a la main.',
  mauvaise_borne_de_boucle: 'Rappeler que range(a, b) exclut b ; faire predire le nombre d\'iterations avant d\'executer.',
  comparaison_inversee: 'Faire verbaliser la condition d\'arret a voix haute avant de coder.',
  cas_de_base_manquant: 'Demander a l\'eleve d\'enoncer le cas de base AVANT d\'ecrire l\'appel recursif.',
  argument_par_defaut_mutable: 'Faire predire le resultat de deux appels successifs avec la meme liste par defaut.',
  confusion_de_type: 'Travailler la conversion int()/str() sur un mini-exemple d\'addition.',
  retourne_none: 'Faire la difference afficher (print) vs renvoyer (return) sur un cas concret reutilise ailleurs.',
  index_hors_limites: 'Revoir les indices 0..n-1 avec une liste courte au tableau.',
  aucune_misconception: 'Laisser progresser : le coach fournit deja le bon niveau d\'etayage.',
};

function teachingAction(mid) {
  return TEACHING_ACTIONS[mid] || 'Faire un point court avec l\'eleve sur la notion concernee.';
}

// Etiquettes orientees apprentissage (jamais punitives).
function attentionLabel(score) {
  if (score >= 75) return 'Soutien prioritaire';
  if (score >= 50) return 'A soutenir';
  if (score >= 25) return 'A surveiller';
  return 'En progression';
}

module.exports = { SKILLS, skillForMisconception, TEACHING_ACTIONS, teachingAction, attentionLabel };
