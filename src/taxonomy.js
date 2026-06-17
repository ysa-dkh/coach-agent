// Taxonomie FERMEE de misconceptions Python.
// L'agent Diagnostic DOIT choisir une valeur dans cette liste (anti-hallucination).
const MISCONCEPTIONS = [
  'off_by_one',
  'mauvaise_borne_de_boucle',
  'cas_de_base_manquant',          // recursion
  'argument_par_defaut_mutable',
  'confusion_de_type',             // str vs int
  'retourne_none',                 // print au lieu de return
  'index_hors_limites',
  'comparaison_inversee',
  'aucune_misconception',
];

// Petites explications humaines (affichees / utilisees dans les prompts).
const LABELS = {
  off_by_one: 'Erreur off-by-one (un element en trop ou en moins).',
  mauvaise_borne_de_boucle: 'Mauvaise borne de boucle (range mal cadre).',
  cas_de_base_manquant: 'Cas de base manquant ou incorrect dans la recursion.',
  argument_par_defaut_mutable: 'Argument par defaut mutable (liste/dict en valeur par defaut).',
  confusion_de_type: 'Confusion de type (str vs int, conversion oubliee).',
  retourne_none: 'La fonction print au lieu de return (renvoie None).',
  index_hors_limites: 'Acces a un index hors limites.',
  comparaison_inversee: 'Comparaison inversee (< au lieu de >, etc.).',
  aucune_misconception: 'Aucune misconception detectee (code correct ou erreur hors taxonomie).',
};

module.exports = { MISCONCEPTIONS, LABELS };
