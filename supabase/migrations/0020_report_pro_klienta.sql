-- ============================================================================
-- Report pro jednoho klienta
-- ----------------------------------------------------------------------------
-- Dosud existoval za týden jediný report — za celé studio, se všemi klienty
-- pohromadě. To je v pořádku pro vlastní přehled, ale ne pro dokument, který
-- se posílá jednomu klientovi nebo zaměstnavateli: ten nemá vidět práci pro
-- ostatní.
--
-- Nově může vedle reportu za studio existovat report zúžený na jednoho
-- klienta: vlastní shrnutí, vlastní stav, vlastní sdílený odkaz. Report za
-- celé studio zůstává beze změny (`client_id` je u něj NULL).
--
-- Jedinečnost hlídají dva částečné indexy místo jednoho:
--   - jeden report za studio a týden,
--   - nejvýš jeden report na klienta a týden.
-- (Jeden společný index by buď zakázal reporty pro klienty úplně, nebo by
-- kvůli NULL dovolil víc reportů za studio.)
--
-- Smazaný klient bere své reporty s sebou — i publikované, jejich odkaz pak
-- přestane fungovat. Archivace klienta se reportů nedotkne.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table reports add column if not exists client_id uuid references clients(id) on delete cascade;

comment on column reports.client_id is
  'Klient, na kterého je report zúžený. NULL = report za celé studio.';

drop index if exists reports_period_key;

create unique index if not exists reports_period_org_key
  on reports (org_id, period, starts_on) where client_id is null;

create unique index if not exists reports_period_client_key
  on reports (org_id, period, starts_on, client_id) where client_id is not null;

notify pgrst, 'reload schema';
