-- ============================================================================
-- Pozvánky do týmu
-- ----------------------------------------------------------------------------
-- Pozvaný člověk v Supabase ještě neexistuje — účet mu vznikne až prvním
-- přihlášením. Nelze mu tedy rovnou založit členství.
--
-- Pozvánku proto ukládáme na e-mail. Když se ten člověk poprvé přihlásí,
-- `ensure_workspace` ji najde, přijme a rovnou ho do týmu zařadí. Kolega
-- tak nepotřebuje žádný zvláštní odkaz — přihlásí se jako kdokoliv jiný.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

create table if not exists invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  -- vždy malými písmeny, jinak by pozvánka na Petr@ nesedla s petr@
  email       text not null,
  role        member_role not null default 'member',
  invited_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days'),
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null
);

create index if not exists invites_org_idx on invites (org_id);

-- Na jeden e-mail může být v organizaci nanejvýš jedna nevyřízená pozvánka.
create unique index if not exists invites_pending_key
  on invites (org_id, email) where accepted_at is null;

alter table invites enable row level security;

-- Pozvánky vidí a spravuje jen správce organizace. Pozvaný je nevidí —
-- nepotřebuje to, jeho pozvánku vyřídí přihlášení samo.
drop policy if exists "spravce vidi pozvanky" on invites;
create policy "spravce vidi pozvanky" on invites
  for select using (is_admin(org_id));

drop policy if exists "spravce spravuje pozvanky" on invites;
create policy "spravce spravuje pozvanky" on invites
  for all using (is_admin(org_id)) with check (is_admin(org_id));

-- ============================================================================
-- Přijetí pozvánky při přihlášení
-- ============================================================================
-- Rozšíření `ensure_workspace`: než založí nový prostor, podívá se, jestli
-- na e-mail přihlášeného nečeká pozvánka.
--
-- Přijatá pozvánka má přednost před vlastním prostorem. Kdyby se kolega
-- omylem přihlásil dřív, než jsi ho pozval, vznikl by mu prázdný prostor —
-- a po pozvání by v něm zůstal viset, kdyby přednost neplatila.
-- ============================================================================

create or replace function ensure_workspace(p_name text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_email  text;
  v_name   text;
  v_org    uuid;
  v_joined uuid;
begin
  if v_user is null then
    raise exception 'Nepřihlášený uživatel';
  end if;

  select email into v_email from auth.users where id = v_user;
  v_name := split_part(coalesce(v_email, 'uzivatel'), '@', 1);

  insert into profiles (id, email, full_name, initials)
  values (v_user, v_email, v_name, upper(left(v_name, 2)))
  on conflict (id) do nothing;

  -- 1) Vyřídit čekající pozvánky na tenhle e-mail.
  for v_joined in
    select i.org_id
    from invites i
    where lower(i.email) = lower(coalesce(v_email, ''))
      and i.accepted_at is null
      and i.expires_at > now()
  loop
    insert into memberships (org_id, user_id, role)
    select v_joined, v_user, i.role
    from invites i
    where i.org_id = v_joined
      and lower(i.email) = lower(v_email)
      and i.accepted_at is null
    on conflict (org_id, user_id) do nothing;

    update invites
    set accepted_at = now(), accepted_by = v_user
    where org_id = v_joined
      and lower(email) = lower(v_email)
      and accepted_at is null;

    -- Přijatá pozvánka vyhrává nad případným vlastním prostorem.
    v_org := v_joined;
  end loop;

  if v_org is not null then
    return v_org;
  end if;

  -- 2) Už někam patří?
  select m.org_id into v_org
  from memberships m
  where m.user_id = v_user
  order by m.created_at
  limit 1;

  if v_org is not null then
    return v_org;
  end if;

  -- 3) Jinak vlastní prostor.
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

  insert into categories (org_id, name, color, position) values
    (v_org, 'Grafika',        '#0A6E80', 1),
    (v_org, 'Tisk',           '#7D3A63', 2),
    (v_org, 'Administrativa', '#8A6A1F', 3),
    (v_org, 'Web a sítě',     '#3F6B52', 4),
    (v_org, 'Komunikace',     '#6B7B80', 5)
  on conflict do nothing;

  return v_org;
end $$;

revoke all on function ensure_workspace(text) from public;
grant execute on function ensure_workspace(text) to authenticated;

-- ============================================================================
-- Přehled týmu
-- ============================================================================
-- Členství drží jen id uživatele; jméno a e-mail jsou v profilech. Spojit to
-- dotazem z aplikace by šlo, ale práva na profily pouštějí jen kolegy ze
-- stejné organizace — což je správně, jen se s tím hůř pracuje. Pohled to
-- spojí na jednom místě.
-- ============================================================================

-- `security_invoker` je zásadní: bez něj by pohled běžel právy svého
-- vlastníka a práva na úrovni řádků by se přeskočila — kdokoliv přihlášený
-- by viděl členy všech organizací.
create or replace view team_view with (security_invoker = true) as
select
  m.org_id,
  m.user_id,
  m.role,
  m.created_at as joined_at,
  p.email,
  p.full_name,
  p.initials
from memberships m
join profiles p on p.id = m.user_id;

notify pgrst, 'reload schema';
