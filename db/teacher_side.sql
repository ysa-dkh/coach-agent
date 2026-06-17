-- Cote prof : table des rapports pedagogiques generes. N'altere rien d'existant.
create table if not exists reports (
  id        uuid primary key default gen_random_uuid(),
  scope     text not null default 'class',   -- class | student
  eleve_id  text references eleves(id),
  titre     text not null,
  resume    text not null,
  payload   jsonb default '{}',
  date      timestamptz default now()
);

create index if not exists idx_reports_date on reports(date desc);
create index if not exists idx_reports_eleve on reports(eleve_id);
