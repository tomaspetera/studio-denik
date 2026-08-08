-- ============================================================================
-- Diagnostika + obnovení vyrovnávací paměti
-- ----------------------------------------------------------------------------
-- Spusť celé v Supabase → SQL Editor. Řekne to, co v databázi opravdu je,
-- a přinutí REST vrstvu, aby si schéma načetla znovu.
-- ============================================================================

-- 1) Přinutí PostgREST načíst schéma znovu.
notify pgrst, 'reload schema';

-- 2) Co v databázi skutečně existuje.
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE')      as tabulek,
  (select count(*) from information_schema.views
     where table_schema = 'public')                                    as pohledu,
  (select count(*) from information_schema.routines
     where routine_schema = 'public')                                  as funkci,
  (select count(*) from pg_policies where schemaname = 'public')       as prav;

-- 3) Jmenovitě tabulky.
select table_name
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;

-- 4) Jmenovitě funkce.
select routine_name
from information_schema.routines
where routine_schema = 'public'
order by routine_name;

-- 5) Zkouška pravidla „u koho leží míč“ přímo v databázi.
--    Musí vrátit: me, me, client, supplier, me, done
select
  s.step,
  step_label('tisk', s.step::smallint) as nazev_kroku,
  ball_of('tisk', s.step::smallint)    as mic_u
from generate_series(0, 5) as s(step);
