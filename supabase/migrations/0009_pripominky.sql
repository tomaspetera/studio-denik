-- ============================================================================
-- Připomínky v kalendáři
-- ----------------------------------------------------------------------------
-- Kalendář dosud ukazoval jen to, co je odvozené z úkolu (termín, domluva,
-- slib tiskárny). Chybí ale místo pro věc, která žádný úkol nepotřebuje —
-- "zavolat klientovi", "výročí smlouvy", "připomenout si dodat podklady" —
-- ať to člověk nemusí nosit v hlavě. Připomínka je vlastní, jednoduchá
-- položka: název, volitelná poznámka, den, volitelně klient, a hotovo/nehotovo.
--
-- Na rozdíl od `tasks.due_at` (timestamptz, půlnoc UTC vybraného dne — viz
-- migrace 0008, proč je to nešikovné) používá `reminders.date` typ `date`.
-- Je to čistě kalendářní den bez času, takže typ `date` je tu správně a
-- žádnou konverzi přes časová pásma vůbec nepotřebuje.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

create table if not exists reminders (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  client_id  uuid references clients(id) on delete set null,
  title      text not null,
  note       text,
  date       date not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);

create index if not exists reminders_org_date_idx on reminders (org_id, date);

alter table reminders enable row level security;

drop policy if exists "cteni pripominek" on reminders;
create policy "cteni pripominek" on reminders for select using (is_member(org_id));

drop policy if exists "zapis pripominek" on reminders;
create policy "zapis pripominek" on reminders for all
  using (can_edit(org_id)) with check (can_edit(org_id));

-- `security_invoker = true` je tu ze stejného důvodu jako u tasks_view:
-- bez toho by se pohled vykonával právy vlastníka a přeskočil by řádková
-- práva tabulky `reminders` — viz migrace 0005, kde přesně tahle chyba
-- u tasks_view způsobila únik dat mezi organizacemi.
create or replace view reminders_view with (security_invoker = true) as
select
  r.*,
  c.name  as client_name,
  c.color as client_color,
  p.initials as created_by_initials
from reminders r
left join clients c on c.id = r.client_id
left join profiles p on p.id = r.created_by;

-- ---------------------------------------------------------------------------
-- Odběr do telefonu (migrace 0008) ať ukáže i připomínky — vždyť právě kvůli
-- nim se nemá nic nosit v hlavě. Jen nesplněné, splněná připomínka už
-- upozorňovat nemá co.
-- ---------------------------------------------------------------------------
create or replace function public_calendar_feed(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'org_name', o.name,
    'events',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid',    'due-' || t.id,
          'date',   t.due_at,
          'title',  t.title,
          'client', c.name,
          'kind',   'due'
        ))
        from tasks t
        left join clients c on c.id = t.client_id
        where t.org_id = o.id
          and t.due_at is not null
          and ball_of(t.kind, t.step) <> 'done'
          and t.due_at > now() - interval '30 days'
          and t.due_at < now() + interval '180 days'
      ), '[]'::jsonb)
      ||
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid',    'agreed-' || t.id,
          'date',   t.agreed_at,
          'title',  coalesce(t.agreed_note, t.title),
          'client', c.name,
          'kind',   'agreed'
        ))
        from tasks t
        left join clients c on c.id = t.client_id
        where t.org_id = o.id
          and t.agreed_at is not null
          and ball_of(t.kind, t.step) <> 'done'
          and t.agreed_at > now() - interval '30 days'
          and t.agreed_at < now() + interval '180 days'
      ), '[]'::jsonb)
      ||
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid',    'print-' || j.id,
          'date',   j.promised_at,
          'title',  t.title,
          'client', c.name,
          'kind',   'print'
        ))
        from print_jobs j
        join tasks t on t.id = j.task_id
        left join clients c on c.id = t.client_id
        where j.org_id = o.id
          and j.promised_at is not null
          and j.delivered_at is null
          and j.promised_at > now() - interval '30 days'
          and j.promised_at < now() + interval '180 days'
      ), '[]'::jsonb)
      ||
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'uid',    'reminder-' || r.id,
          'date',   r.date::timestamptz,
          'title',  r.title,
          'client', c.name,
          'kind',   'reminder'
        ))
        from reminders r
        left join clients c on c.id = r.client_id
        where r.org_id = o.id
          and r.done_at is null
          and r.date > current_date - interval '30 days'
          and r.date < current_date + interval '180 days'
      ), '[]'::jsonb)
  )
  from orgs o
  where o.calendar_token = p_token
$$;

notify pgrst, 'reload schema';
