-- ============================================================================
-- Oprava: náhodné tokeny bez závislosti na pgcrypto
-- ----------------------------------------------------------------------------
-- Původně jsme tokeny generovali přes `gen_random_bytes` z rozšíření pgcrypto.
-- Supabase ho instaluje do schématu `extensions`, jenže naše `security definer`
-- funkce mají kvůli bezpečnosti `search_path = public` — a v něm ta funkce
-- není vidět. Defaulty v tabulkách fungovaly (vyhodnocují se se search_pathem
-- volajícího), ale `ensure_workspace` padala při zakládání organizace.
--
-- Řešením není přidávat `extensions` do search_pathu — to by tu bezpečnostní
-- pojistku oslabilo. Místo toho přecházíme na `gen_random_uuid()`, která je
-- od PostgreSQL 13 součástí jádra a žádné rozšíření nepotřebuje.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Generátor tokenu. Jedno místo, odkud ho berou tabulky i funkce.
-- Dvě uuid dají 64 hexadecimálních znaků, takže i pro delší token je zásoba.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Přepnout defaulty u už existujících tabulek.
-- (V `create table` výš je to taky změněné, kvůli čistým instalacím.)
-- ---------------------------------------------------------------------------
alter table clients alter column share_token set default random_token(24);
alter table reports alter column share_token set default random_token(32);

-- ---------------------------------------------------------------------------
-- A hlavně: přepsat `ensure_workspace`, aby slug generovala stejnou cestou.
-- Tohle je ta funkce, která padala.
-- ---------------------------------------------------------------------------
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
    (v_org, 'Komunikace',     '#6B7B80', 5)
  on conflict do nothing;

  return v_org;
end $$;

revoke all on function ensure_workspace(text) from public;
grant execute on function ensure_workspace(text) to authenticated;

-- Ať o změnách ví i REST vrstva.
notify pgrst, 'reload schema';
