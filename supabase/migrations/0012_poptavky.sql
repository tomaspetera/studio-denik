-- ============================================================================
-- Poptávky a nabídky (pipeline)
-- ----------------------------------------------------------------------------
-- Appka dosud začínala až u založeného klienta. Chybí krok před tím:
-- poptávka → poslaná nabídka → vyhráno/prohráno. `lead_status` je enum ze
-- stejného důvodu jako `task_kind` — je to malá pevná sada stavů, na které
-- kód přímo větví (vyhráno nabídne založení klienta), ne popisek pro
-- člověka jako `clients.relationship`.
--
-- Žádná historie přechodů jako u úkolů (`task_events`) — bylo by to nad
-- rámec toho, co bylo potřeba ("jednoduché stavy"). `decided_at` stačí na
-- to, aby šlo vidět, kdy se poptávka rozhodla.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

do $$ begin
  create type lead_status as enum ('poptavka', 'nabidka', 'vyhrano', 'prohrano');
exception when duplicate_object then null; end $$;

create table if not exists leads (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  name       text not null,
  company    text,
  contact    text,
  email      text,
  phone      text,
  amount     numeric,
  status     lead_status not null default 'poptavka',
  note       text,
  -- Vyplní se, když se z poptávky založí klient (viz "vyhráno" níž).
  -- Poptávka samotná zůstává, jen ukazuje, kam vedla.
  client_id  uuid references clients(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists leads_org_status_idx on leads (org_id, status);

alter table leads enable row level security;

drop policy if exists "cteni poptavek" on leads;
create policy "cteni poptavek" on leads for select using (is_member(org_id));

drop policy if exists "zapis poptavek" on leads;
create policy "zapis poptavek" on leads for all
  using (can_edit(org_id)) with check (can_edit(org_id));

notify pgrst, 'reload schema';
