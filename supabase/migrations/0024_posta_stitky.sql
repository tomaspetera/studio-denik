-- ============================================================================
-- Pošta: načítání i z vybraných štítků Gmailu
-- ----------------------------------------------------------------------------
-- Appka čte doručenou poštu. Kdo si ale nechá Gmailem zprávy rovnou přesouvat
-- do štítků (filtr „přeskočit doručenou poštu“), v doručené je nemá a appka
-- je nevidí. Majitel schránky si proto může vybrat štítky, ze kterých se
-- pošta načítá taky.
--
-- Ukládá se jen výběr: identifikátor štítku v Gmailu a jeho jméno, aby šlo
-- v nastavení ukázat, odkud se pošta načítá. Bez výběru (prázdné pole) se
-- načítá jen doručená pošta, jako dosud.
--
-- Práva se nemění: řádek schránky vidí a mění jen její majitel.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table mail_accounts add column if not exists labels jsonb not null default '[]'::jsonb;

comment on column mail_accounts.labels is
  'Štítky Gmailu, ze kterých se pošta načítá navíc k doručené: pole objektů {id, name}. Prázdné = jen doručená pošta.';

-- Každý štítek je další dotaz na Gmail při každém načtení — víc než dvacet je omyl.
do $$ begin
  alter table mail_accounts
    add constraint mail_accounts_labels_array
    check (jsonb_typeof(labels) = 'array' and jsonb_array_length(labels) <= 20);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
