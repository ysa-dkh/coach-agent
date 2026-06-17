-- ============================================================
-- Coach Agent - schema + donnees de demo
-- A coller dans Supabase > SQL Editor > Run
-- ============================================================

-- ---- Tables ------------------------------------------------

create table if not exists skills (
  id          text primary key,
  nom         text not null,
  description text
);

create table if not exists cours (
  id        text primary key,
  titre     text not null,
  contenu   text not null,
  skill_id  text references skills(id)
);

create table if not exists exos (
  id         text primary key,
  enonce     text not null,
  skill_id   text references skills(id),
  difficulte int default 1,
  tests      jsonb not null            -- { "function": "...", "cases": [ {"args":[...], "expected": ...}, ... ] }
);

create table if not exists eleves (
  id            text primary key,
  nom           text not null,
  niveau_estime numeric default 0.5,   -- 0..1
  etat          text default 'ok'      -- ok | a_surveiller | bloque
);

create table if not exists soumissions (
  id              uuid primary key default gen_random_uuid(),
  eleve_id        text references eleves(id),
  exo_id          text references exos(id),
  code            text not null,
  resultats_tests jsonb,
  date            timestamptz default now()
);

create table if not exists interventions (
  id            uuid primary key default gen_random_uuid(),
  eleve_id      text references eleves(id),
  soumission_id uuid references soumissions(id),
  type          text,            -- nudge | redirect | mini_exo
  misconception text,
  confiance     numeric,
  message       text,
  payload       jsonb,           -- { section: {...}, mini_exo: {...} }
  date          timestamptz default now()
);

-- ---- Seed : skills ----------------------------------------

insert into skills (id, nom, description) values
  ('boucles',   'Boucles et bornes',        'Maitriser for/while, range et les bornes inclusives/exclusives.'),
  ('recursion', 'Recursion',                'Cas de base + appel recursif qui converge.'),
  ('types',     'Types et conversions',     'str vs int, conversions, comparaisons entre types.'),
  ('fonctions', 'Fonctions : return vs print', 'Renvoyer une valeur avec return plutot que de l afficher.'),
  ('indices',   'Indices de liste',         'Acceder aux elements, eviter index hors limites.')
on conflict (id) do nothing;

-- ---- Seed : cours (sections pour le RAG-par-prompt) -------

insert into cours (id, titre, contenu, skill_id) values
  ('c_boucles',
   'range() et les bornes',
   'En Python, range(a, b) parcourt les entiers de a INCLUS jusqu''a b EXCLU. Pour aller de 1 a n inclus, il faut donc range(1, n+1). Oublier le +1 est la cause classique du resultat "off-by-one" : il manque ou il y a un element de trop. Verifie toujours la derniere iteration a la main.',
   'boucles'),
  ('c_recursion',
   'Le cas de base',
   'Une fonction recursive doit avoir un CAS DE BASE qui s''arrete sans rappeler la fonction, sinon elle boucle a l''infini (RecursionError). Pour factorielle : si n vaut 0 ou 1, on renvoie 1 ; sinon on renvoie n * factorielle(n-1). Le cas recursif doit toujours se rapprocher du cas de base.',
   'recursion'),
  ('c_types',
   'str, int et conversions',
   'Les donnees lues (input, fichiers) sont des chaines (str). "3" + "4" donne "34", pas 7. Pour calculer il faut convertir avec int(...) ou float(...). Comparer un str et un int ne leve pas toujours d''erreur mais donne des resultats faux. Convertis avant de comparer ou d''additionner.',
   'types'),
  ('c_fonctions',
   'return vs print',
   'print AFFICHE une valeur a l''ecran mais ne la RENVOIE pas : la fonction renvoie alors None. Pour qu''une fonction soit reutilisable (et testable), elle doit faire return de son resultat. Regle : si on doit reutiliser le resultat ailleurs, c''est return, pas print.',
   'fonctions'),
  ('c_indices',
   'Indices et longueur',
   'Les indices d''une liste de longueur n vont de 0 a n-1. Acceder a liste[n] leve IndexError. Le dernier element est liste[n-1] ou liste[-1]. Dans une boucle, range(len(liste)) donne exactement les indices valides.',
   'indices')
on conflict (id) do nothing;

-- ---- Seed : exos ------------------------------------------

insert into exos (id, enonce, skill_id, difficulte, tests) values
  ('e_somme',
   'Ecris une fonction somme_jusqua(n) qui renvoie la somme des entiers de 1 a n inclus. Ex: somme_jusqua(5) -> 15.',
   'boucles', 1,
   '{"function":"somme_jusqua","cases":[{"args":[5],"expected":15},{"args":[1],"expected":1},{"args":[3],"expected":6},{"args":[10],"expected":55}]}'),
  ('e_factorielle',
   'Ecris une fonction factorielle(n) qui renvoie n! (produit de 1 a n). factorielle(0) vaut 1. Ex: factorielle(4) -> 24.',
   'recursion', 2,
   '{"function":"factorielle","cases":[{"args":[0],"expected":1},{"args":[1],"expected":1},{"args":[4],"expected":24},{"args":[6],"expected":720}]}'),
  ('e_double',
   'Ecris une fonction double(x) qui renvoie le double de x. Ex: double(21) -> 42.',
   'fonctions', 1,
   '{"function":"double","cases":[{"args":[21],"expected":42},{"args":[0],"expected":0},{"args":[-5],"expected":-10}]}'),
  ('e_maximum',
   'Ecris une fonction maximum(liste) qui renvoie le plus grand element de la liste (sans utiliser max()). Ex: maximum([3,7,2]) -> 7.',
   'indices', 2,
   '{"function":"maximum","cases":[{"args":[[3,7,2]],"expected":7},{"args":[[1]],"expected":1},{"args":[[-3,-1,-9]],"expected":-1},{"args":[[5,5,5]],"expected":5}]}')
on conflict (id) do nothing;

-- ---- Seed : un eleve de demo ------------------------------

insert into eleves (id, nom, niveau_estime, etat) values
  ('demo', 'Eleve Demo', 0.5, 'ok')
on conflict (id) do nothing;
