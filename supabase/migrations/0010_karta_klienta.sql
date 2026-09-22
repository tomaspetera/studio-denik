-- ============================================================================
-- Bohatší karta klienta — typ spolupráce a víc kontaktů
-- ----------------------------------------------------------------------------
-- Dosud šlo ke klientovi zapsat jen jednu kontaktní osobu a jeden e-mail.
-- Reálný klient má ale často víc lidí, se kterými se komunikuje (jednatel,
-- grafik na jejich straně, marketing) — proto vedle stávajících polí
-- (zůstávají beze změny, fungují jako rychlý/hlavní kontakt) přibývá
-- samostatný seznam dalších kontaktů.
--
-- `relationship` je záměrně obyčejný text, ne enum: je to jen popisek pro
-- člověka ("stálý klient", "jednorázová zakázka"), ne pravidlo, na kterém
-- by něco v appce záviselo — na rozdíl třeba od `task_kind`, kde enum dává
-- smysl, protože určuje počet kroků štafety. Rozhraní nabídne pár typických
-- hodnot, ale dá se přepsat na cokoliv. "Bývalý klient" mezi nimi schválně
-- není — přesně tohle už znamená `clients.archived`, dvě pole se stejným
-- významem by se dřív nebo později rozešla.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table clients add column if not exists relationship text;

comment on column clients.relationship is
  'Typ spolupráce — volný text (stálý klient, jednorázová zakázka…). Není enum, nic v appce na něm nezávisí.';

create table if not exists client_contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  name       text not null,
  role       text,
  phone      text,
  email      text,
  position   smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists client_contacts_client_idx on client_contacts (client_id);
create index if not exists client_contacts_org_idx    on client_contacts (org_id);

alter table client_contacts enable row level security;

drop policy if exists "cteni kontaktu klienta" on client_contacts;
create policy "cteni kontaktu klienta" on client_contacts for select using (is_member(org_id));

drop policy if exists "zapis kontaktu klienta" on client_contacts;
create policy "zapis kontaktu klienta" on client_contacts for all
  using (can_edit(org_id)) with check (can_edit(org_id));

notify pgrst, 'reload schema';
