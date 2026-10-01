-- ============================================================================
-- Další krok a hlídání ticha
-- ----------------------------------------------------------------------------
-- Klient i poptávka dostanou "další krok" — co a kdy se má stát. Bez něj
-- poptávka tiše vyhnije: nikdo se neozve, nikdo to nehlídá.
--
-- Krok a datum jdou vždycky spolu (obojí, nebo nic). Krok bez data by se
-- nikdy nemohl dostat po termínu, takže by hlídání nemělo na co sáhnout —
-- proto je to pravidlo v databázi a ne jen ve formuláři.
--
-- "Poslední kontakt" se záměrně NEUKLÁDÁ. Dá se vždycky spočítat z toho, co
-- už appka zná (poznámky, uzavřené úkoly, rozhodnutí klienta), stejně jako
-- se u úkolu nikde neukládá, u koho leží míč.
--
-- `orgs.silence_days` je jediné nastavení: po kolika dnech bez aktivity se
-- klient bez otevřené práce ukáže mezi věcmi, které chtějí pozornost.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table clients add column if not exists next_step    text;
alter table clients add column if not exists next_step_at date;
alter table leads   add column if not exists next_step    text;
alter table leads   add column if not exists next_step_at date;

do $$ begin
  alter table clients add constraint clients_next_step_pair
    check ((next_step is null) = (next_step_at is null));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table leads add constraint leads_next_step_pair
    check ((next_step is null) = (next_step_at is null));
exception when duplicate_object then null; end $$;

alter table orgs add column if not exists silence_days int not null default 14;

do $$ begin
  alter table orgs add constraint orgs_silence_days_range
    check (silence_days between 1 and 365);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
