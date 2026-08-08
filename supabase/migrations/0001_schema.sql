-- ============================================================================
-- Studio Deník — schéma databáze
-- ----------------------------------------------------------------------------
-- Model stojí na jedné myšlence: každý úkol má typ, typ určuje posloupnost
-- kroků, a krok, na kterém úkol stojí, určuje, u koho leží míč. Vlastník míče
-- se nikam neukládá — počítá se, takže nemůže přestat sedět se skutečností.
--
-- Skript jde spustit opakovaně. SQL Editor v Supabase ho posílá jako jednu
-- transakci, takže jediný selhaný příkaz zruší úplně všechno — proto je
-- všude `if not exists` a `drop ... if exists`.
-- ============================================================================

-- Záměrně nepoužíváme pgcrypto. Supabase ho instaluje do schématu
-- `extensions`, které naše `security definer` funkce nemají v search_pathu —
-- `gen_random_bytes` by v nich nebyla vidět. `gen_random_uuid()` je od
-- PostgreSQL 13 součástí jádra a funguje všude stejně.
create or replace function random_token(p_len integer default 24)
returns text
language sql volatile
as $$
  select left(
    replace(gen_random_uuid()::text, '-', '') ||
    replace(gen_random_uuid()::text, '-', ''),
    greatest(1, least(p_len, 64))
  )
$$;

-- ============================================================================
-- ČÍSELNÍKY
-- ============================================================================

do $$ begin
  -- Typ úkolu určuje, kolik kroků má jeho štafeta.
  create type task_kind as enum ('interni', 'klient', 'tisk');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Kdo je na tahu. Odvozuje se z kroku, neukládá se ručně.
  create type ball_holder as enum ('me', 'client', 'supplier', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_role as enum ('admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_period as enum ('week', 'month');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- ORGANIZACE A LIDÉ
-- ============================================================================

create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  -- hlavička reportů
  sender_name text,
  sender_mail text,
  created_at  timestamptz not null default now()
);

-- Profil navázaný na auth.users. Jeden člověk může být ve více organizacích.
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  initials   text,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists memberships_user_idx on memberships (user_id);

-- ============================================================================
-- KLIENTI A DODAVATELÉ
-- ============================================================================

create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  color       text not null default '#6B7B80',
  contact     text,
  email       text,
  note        text,
  -- token pro schvalovací odkaz; klient díky němu nepotřebuje účet
  share_token text not null default random_token(24),
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists clients_org_idx on clients (org_id) where archived = false;
create unique index if not exists clients_share_token_key on clients (share_token);

create table if not exists suppliers (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists suppliers_org_idx on suppliers (org_id);

-- ============================================================================
-- KATEGORIE PRÁCE
-- ============================================================================

create table if not exists categories (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references orgs(id) on delete cascade,
  name     text not null,
  color    text not null default '#6B7B80',
  position smallint not null default 0
);

create index if not exists categories_org_idx on categories (org_id);

-- ============================================================================
-- ÚKOLY
-- ============================================================================
-- `step` je index do posloupnosti kroků daného typu (0 = Zadáno).
-- Počty kroků: interni 3, klient 4, tisk 6. Hlídá to check níž.
-- ============================================================================

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  client_id    uuid references clients(id) on delete set null,
  category_id  uuid references categories(id) on delete set null,
  supplier_id  uuid references suppliers(id) on delete set null,
  assignee_id  uuid references profiles(id) on delete set null,

  title        text not null,
  note         text,
  kind         task_kind not null default 'klient',
  step         smallint not null default 0,

  -- velikost místo vykazování hodin: 1 malý, 2 střední, 3 velký
  size         smallint not null default 2 check (size between 1 and 3),

  due_at       timestamptz,
  -- co je s klientem domluveno a na kdy
  agreed_at    timestamptz,
  agreed_note  text,

  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz,

  constraint step_within_kind check (
    step >= 0 and step < case kind
      when 'interni' then 3
      when 'klient'  then 4
      when 'tisk'    then 6
    end
  )
);

create index if not exists tasks_org_step_idx     on tasks (org_id, step);
create index if not exists tasks_org_due_idx      on tasks (org_id, due_at);
create index if not exists tasks_client_idx       on tasks (client_id);
create index if not exists tasks_assignee_idx     on tasks (assignee_id);

-- ---------------------------------------------------------------------------
-- Míč: jediné místo, kde je vlastnictví definované. Používá to appka,
-- reporty i pohledy níž, takže se nemůže rozejít.
-- ---------------------------------------------------------------------------
create or replace function ball_of(p_kind task_kind, p_step smallint)
returns ball_holder
language sql immutable
as $$
  select case p_kind
    when 'interni' then (array['me','me','done'])[p_step + 1]
    when 'klient'  then (array['me','me','client','done'])[p_step + 1]
    when 'tisk'    then (array['me','me','client','supplier','me','done'])[p_step + 1]
  end::ball_holder
$$;

create or replace function step_label(p_kind task_kind, p_step smallint)
returns text
language sql immutable
as $$
  select case p_kind
    when 'interni' then (array['Zadáno','Dělám','Hotovo'])[p_step + 1]
    when 'klient'  then (array['Zadáno','Dělám','U klienta','Hotovo'])[p_step + 1]
    when 'tisk'    then (array['Zadáno','Dělám','Ke schválení','V tisku','Dodáno','Předáno'])[p_step + 1]
  end
$$;

-- ============================================================================
-- TISKOVÉ ZAKÁZKY
-- ============================================================================

create table if not exists print_jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  task_id       uuid not null references tasks(id) on delete cascade,
  supplier_id   uuid references suppliers(id) on delete set null,

  code          text,
  spec          text,
  quantity      integer,

  approved_at   timestamptz,   -- klient odsouhlasil nátisk
  sent_at       timestamptz,   -- odesláno do tisku
  promised_at   timestamptz,   -- co dodavatel slíbil
  delivered_at  timestamptz,   -- co dodavatel skutečně dodal
  handed_at     timestamptz,   -- předáno klientovi
  last_nudge_at timestamptz,   -- kdy naposledy urgováno

  created_at    timestamptz not null default now()
);

create index if not exists print_jobs_org_idx on print_jobs (org_id);
create unique index if not exists print_jobs_task_key on print_jobs (task_id);

-- ============================================================================
-- HISTORIE
-- ============================================================================
-- Z tohohle se staví report. Bez historie by se dalo říct jen "je hotovo",
-- ne "co se ten týden stalo".
-- ============================================================================

create table if not exists task_events (
  id         bigserial primary key,
  org_id     uuid not null references orgs(id) on delete cascade,
  task_id    uuid not null references tasks(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  -- 'created' | 'step' | 'nudge' | 'note' | 'client_approved' | 'delivered'
  kind       text not null,
  from_step  smallint,
  to_step    smallint,
  detail     text,
  at         timestamptz not null default now()
);

create index if not exists task_events_org_at_idx  on task_events (org_id, at desc);
create index if not exists task_events_task_at_idx on task_events (task_id, at desc);

-- ============================================================================
-- REPORTY
-- ============================================================================

create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  period       report_period not null default 'week',
  starts_on    date not null,
  ends_on      date not null,
  label        text,                       -- "2026-W32"

  -- text od AI a text po ruční úpravě; originál se nepřepisuje,
  -- aby šlo přegenerovat bez ztráty vlastních zásahů
  ai_summary     text,
  ai_outlook     text,
  edited_summary text,
  edited_outlook text,

  recipient    text,
  status       report_status not null default 'draft',
  share_token  text not null default random_token(32),
  share_until  timestamptz not null default (now() + interval '90 days'),
  model        text,                       -- 'claude' | 'gemini'

  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists reports_share_token_key on reports (share_token);
create unique index if not exists reports_period_key on reports (org_id, period, starts_on);

-- ============================================================================
-- POHLEDY
-- ============================================================================

create or replace view tasks_view as
select
  t.*,
  ball_of(t.kind, t.step)      as ball,
  step_label(t.kind, t.step)   as step_name,
  case t.kind when 'interni' then 3 when 'klient' then 4 when 'tisk' then 6 end as step_count,
  (t.due_at is not null
     and t.due_at < now()
     and ball_of(t.kind, t.step) <> 'done')                                     as is_late,
  c.name  as client_name,
  c.color as client_color,
  s.name  as supplier_name,
  p.initials as assignee_initials
from tasks t
left join clients   c on c.id = t.client_id
left join suppliers s on s.id = t.supplier_id
left join profiles  p on p.id = t.assignee_id;

-- ============================================================================
-- SPOUŠTĚČE
-- ============================================================================

create or replace function touch_task()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- uzavření se razítkuje samo, ať se na to nedá zapomenout
  if ball_of(new.kind, new.step) = 'done' and new.closed_at is null then
    new.closed_at := now();
  elsif ball_of(new.kind, new.step) <> 'done' then
    new.closed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch
  before update on tasks
  for each row execute function touch_task();

create or replace function log_step_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into task_events (org_id, task_id, actor_id, kind, to_step, detail)
    values (new.org_id, new.id, auth.uid(), 'created', new.step, new.title);
  elsif new.step is distinct from old.step then
    insert into task_events (org_id, task_id, actor_id, kind, from_step, to_step, detail)
    values (new.org_id, new.id, auth.uid(), 'step', old.step, new.step,
            step_label(new.kind, new.step));
  end if;
  return new;
end $$;

drop trigger if exists tasks_log on tasks;
create trigger tasks_log
  after insert or update on tasks
  for each row execute function log_step_change();

-- ============================================================================
-- PRÁVA (RLS)
-- ============================================================================
-- Vše se točí kolem členství v organizaci. Kdo v ní není, nevidí nic.
-- ============================================================================

create or replace function is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
  )
$$;

create or replace function is_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'admin'
  )
$$;

-- Příjemce reportu (viewer) nesmí do provozních dat.
create or replace function can_edit(p_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = p_org and m.user_id = auth.uid()
      and m.role in ('admin', 'member')
  )
$$;

alter table orgs        enable row level security;
alter table profiles    enable row level security;
alter table memberships enable row level security;
alter table clients     enable row level security;
alter table suppliers   enable row level security;
alter table categories  enable row level security;
alter table tasks       enable row level security;
alter table print_jobs  enable row level security;
alter table task_events enable row level security;
alter table reports     enable row level security;

drop policy if exists "vlastni profil" on profiles;
create policy "vlastni profil" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profily kolegu" on profiles;
create policy "profily kolegu" on profiles
  for select using (exists (
    select 1 from memberships a
    join memberships b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  ));

drop policy if exists "vlastni organizace" on orgs;
create policy "vlastni organizace" on orgs
  for select using (is_member(id));

drop policy if exists "spravce meni organizaci" on orgs;
create policy "spravce meni organizaci" on orgs
  for update using (is_admin(id)) with check (is_admin(id));

drop policy if exists "vlastni clenstvi" on memberships;
create policy "vlastni clenstvi" on memberships
  for select using (is_member(org_id));

drop policy if exists "spravce spravuje cleny" on memberships;
create policy "spravce spravuje cleny" on memberships
  for all using (is_admin(org_id)) with check (is_admin(org_id));

-- Číselníky: čte každý člen, mění jen kdo smí editovat.
drop policy if exists "cteni klientu" on clients;
create policy "cteni klientu" on clients for select using (is_member(org_id));

drop policy if exists "zapis klientu" on clients;
create policy "zapis klientu" on clients for all
  using (can_edit(org_id)) with check (can_edit(org_id));

drop policy if exists "cteni dodavatelu" on suppliers;
create policy "cteni dodavatelu" on suppliers for select using (is_member(org_id));

drop policy if exists "zapis dodavatelu" on suppliers;
create policy "zapis dodavatelu" on suppliers for all
  using (can_edit(org_id)) with check (can_edit(org_id));

drop policy if exists "cteni kategorii" on categories;
create policy "cteni kategorii" on categories for select using (is_member(org_id));

drop policy if exists "zapis kategorii" on categories;
create policy "zapis kategorii" on categories for all
  using (can_edit(org_id)) with check (can_edit(org_id));

drop policy if exists "cteni ukolu" on tasks;
create policy "cteni ukolu" on tasks for select using (is_member(org_id));

drop policy if exists "zapis ukolu" on tasks;
create policy "zapis ukolu" on tasks for all
  using (can_edit(org_id)) with check (can_edit(org_id));

drop policy if exists "cteni zakazek" on print_jobs;
create policy "cteni zakazek" on print_jobs for select using (is_member(org_id));

drop policy if exists "zapis zakazek" on print_jobs;
create policy "zapis zakazek" on print_jobs for all
  using (can_edit(org_id)) with check (can_edit(org_id));

-- Historie se jen čte a přidává; přepisovat ji nesmí nikdo.
drop policy if exists "cteni historie" on task_events;
create policy "cteni historie" on task_events for select using (is_member(org_id));

drop policy if exists "zapis historie" on task_events;
create policy "zapis historie" on task_events for insert with check (can_edit(org_id));

drop policy if exists "cteni reportu" on reports;
create policy "cteni reportu" on reports for select using (is_member(org_id));

drop policy if exists "zapis reportu" on reports;
create policy "zapis reportu" on reports for all
  using (can_edit(org_id)) with check (can_edit(org_id));

-- ============================================================================
-- VEŘEJNÝ REPORT PŘES ODKAZ
-- ============================================================================
-- Sdílený report čte i nepřihlášený člověk, ale jen když má token a ten
-- ještě platí. Proto security definer funkce místo otevřené RLS politiky.
-- ============================================================================

create or replace function public_report(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'label',      r.label,
    'period',     r.period,
    'starts_on',  r.starts_on,
    'ends_on',    r.ends_on,
    'summary',    coalesce(r.edited_summary, r.ai_summary),
    'outlook',    coalesce(r.edited_outlook, r.ai_outlook),
    'recipient',  r.recipient,
    'org_name',   o.name,
    'sender',     o.sender_name,
    'sender_mail',o.sender_mail,
    'published_at', r.published_at
  )
  from reports r
  join orgs o on o.id = r.org_id
  where r.share_token = p_token
    and r.status = 'published'
    and r.share_until > now()
$$;

revoke all on function public_report(text) from public;
grant execute on function public_report(text) to anon, authenticated;

-- ============================================================================
-- ZALOŽENÍ PRACOVNÍHO PROSTORU
-- ============================================================================
-- Práva schválně nikomu nedovolují vložit řádek do `orgs` — jinak by si
-- organizaci mohl založit kdokoliv. Tahle funkce je jediná řízená cesta:
-- běží s právy vlastníka, ale vždycky jen pro právě přihlášeného člověka.
--
-- Je bezpečné ji volat při každém načtení. Když prostor už existuje,
-- jen vrátí jeho id.
-- ============================================================================

create or replace function ensure_workspace(p_name text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_email text;
  v_name  text;
  v_org   uuid;
begin
  if v_user is null then
    raise exception 'Nepřihlášený uživatel';
  end if;

  select email into v_email from auth.users where id = v_user;
  v_name := split_part(coalesce(v_email, 'uzivatel'), '@', 1);

  -- Profil zakládáme tady, protože spouštěč nad auth.users nemusí projít.
  insert into profiles (id, email, full_name, initials)
  values (v_user, v_email, v_name, upper(left(v_name, 2)))
  on conflict (id) do nothing;

  select m.org_id into v_org
  from memberships m
  where m.user_id = v_user
  order by m.created_at
  limit 1;

  if v_org is not null then
    return v_org;
  end if;

  insert into orgs (name, slug, sender_name, sender_mail)
  values (
    coalesce(nullif(trim(p_name), ''), 'Moje studio'),
    'org-' || random_token(12),
    v_name,
    v_email
  )
  returning id into v_org;

  insert into memberships (org_id, user_id, role)
  values (v_org, v_user, 'admin');

  -- Základní kategorie, ať se dá hned zapisovat.
  insert into categories (org_id, name, color, position) values
    (v_org, 'Grafika',        '#0A6E80', 1),
    (v_org, 'Tisk',           '#7D3A63', 2),
    (v_org, 'Administrativa', '#8A6A1F', 3),
    (v_org, 'Web a sítě',     '#3F6B52', 4),
    (v_org, 'Komunikace',     '#6B7B80', 5);

  return v_org;
end $$;

revoke all on function ensure_workspace(text) from public;
grant execute on function ensure_workspace(text) to authenticated;

-- ============================================================================
-- NOVÝ UŽIVATEL
-- ============================================================================
-- Spouštěč nad auth.users je pohodlný, ale na některých projektech k té
-- tabulce nejsou práva. Kdyby se to nepovedlo, nesmí to shodit celou migraci
-- — aplikace si profil umí založit i sama při prvním přihlášení.
-- ============================================================================

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into profiles (id, email, full_name, initials)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data->>'full_name', new.email), 2))
  )
  on conflict (id) do nothing;
  return new;
end $$;

do $$ begin
  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();
exception when insufficient_privilege or undefined_table then
  raise notice 'Spoustec nad auth.users nelze zalozit (chybi prava). Nevadi — profil zalozi aplikace pri prvnim prihlaseni.';
end $$;
