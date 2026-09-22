-- ============================================================================
-- Nepřítomnost týmu
-- ----------------------------------------------------------------------------
-- Appka nikdy netrackovala hodiny (schválně, od úplného začátku — viz
-- `size` u úkolu místo vykazování času). Kapacita týmu se proto nepočítá
-- z odpracovaného času, ale z počtu a velikosti otevřených úkolů na osobu
-- (lib/capacity.ts) — k tomu žádná nová tabulka netřeba, jen dotaz nad
-- `tasks_view`.
--
-- Co appka dosud neuměla vůbec, je nepřítomnost — kdo je pryč a od kdy do
-- kdy. To je jediná nová tabulka v týhle migraci.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

create table if not exists absences (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  from_date  date not null,
  to_date    date not null,
  note       text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint absence_range check (to_date >= from_date)
);

create index if not exists absences_org_idx on absences (org_id, from_date);

alter table absences enable row level security;

drop policy if exists "cteni nepritomnosti" on absences;
create policy "cteni nepritomnosti" on absences for select using (is_member(org_id));

-- Kdokoli s právem editovat smí zapsat/smazat jakoukoli nepřítomnost, ne
-- jen svou vlastní — stejně široké právo jako u všeho ostatního v appce
-- (kdokoli s právem editovat může změnit i cizí úkol). Malé studio, jedna
-- úroveň práv, žádné jemnější dělení podle "je to můj záznam".
drop policy if exists "zapis nepritomnosti" on absences;
create policy "zapis nepritomnosti" on absences for all
  using (can_edit(org_id)) with check (can_edit(org_id));

notify pgrst, 'reload schema';
