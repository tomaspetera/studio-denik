-- ============================================================================
-- Údaje o klientovi z obchodního rejstříku
-- ----------------------------------------------------------------------------
-- Klient dosud měl jen jméno a kontakt. Pro fakturaci a pro hlavičku reportu
-- se hodí i identifikační údaje — a když se dají natáhnout z ARESu, není
-- důvod je přepisovat ručně.
--
-- Všechna pole jsou nepovinná. Fyzická osoba bez IČO se založí stejně jako
-- dřív — jen se vyplní jméno.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table clients add column if not exists ico     text;
alter table clients add column if not exists dic     text;
alter table clients add column if not exists address text;

comment on column clients.ico is 'Identifikační číslo, 8 číslic. Podle něj se dohledávají údaje v ARESu.';
comment on column clients.dic is 'Daňové identifikační číslo, když je plátce DPH.';
comment on column clients.address is 'Sídlo v textové podobě, tak jak ho vrací ARES.';

-- Stejné IČO nemá v jedné organizaci co dělat dvakrát — bylo by to
-- omylem založený duplikát. Archivovaných se to netýká.
create unique index if not exists clients_ico_key
  on clients (org_id, ico)
  where ico is not null and archived = false;

notify pgrst, 'reload schema';
