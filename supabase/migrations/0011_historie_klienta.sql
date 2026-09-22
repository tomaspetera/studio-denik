-- ============================================================================
-- Historie komunikace s klientem
-- ----------------------------------------------------------------------------
-- Karta klienta dosud ukazovala jen otevřené úkoly — co se řeší teď, ne co
-- se s klientem dělo. Přibývá vlastní časová osa: ruční záznamy ("volal
-- jsem, domluvili jsme se na X") doplněné o to, co appka už sama ví
-- (uzavřené úkoly, schválení a připomínky klienta přes jeho odkaz).
--
-- Skládání osy dohromady (poznámky + uzavřené úkoly + task_events) probíhá
-- v TypeScriptu (lib/client-timeline.ts), ne v SQL view — je to čtení jen
-- pro přihlášeného člověka (žádný veřejný odkaz jako u kalendáře), a tenhle
-- druh kombinování tří zdrojů se snáz udržuje a mění v JS, stejně jako
-- kalendář kombinuje tasks_view + print_jobs + reminders.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

create table if not exists client_notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  body       text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists client_notes_client_idx on client_notes (client_id, created_at desc);
create index if not exists client_notes_org_idx    on client_notes (org_id);

alter table client_notes enable row level security;

drop policy if exists "cteni poznamek klienta" on client_notes;
create policy "cteni poznamek klienta" on client_notes for select using (is_member(org_id));

drop policy if exists "zapis poznamek klienta" on client_notes;
create policy "zapis poznamek klienta" on client_notes for all
  using (can_edit(org_id)) with check (can_edit(org_id));

-- `security_invoker = true` ze stejného důvodu jako u tasks_view/reminders_view.
create or replace view client_notes_view with (security_invoker = true) as
select
  n.*,
  p.initials as created_by_initials
from client_notes n
left join profiles p on p.id = n.created_by;

notify pgrst, 'reload schema';
