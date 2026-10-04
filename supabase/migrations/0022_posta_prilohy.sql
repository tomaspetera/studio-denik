-- ============================================================================
-- Pošta: čtení příloh pomocí AI — jen se zvláštním souhlasem
-- ----------------------------------------------------------------------------
-- Dosud AI četla z e-mailu jen text (migrace 0019). Tohle je krok dál: když
-- majitel schránky u zprávy klikne na „Udělat úkol“ nebo „Návrh odpovědi“,
-- může AI spolu s textem přečíst i její přílohy — PDF a obrázky.
--
-- V přílohách bývají faktury a smlouvy, tedy citlivější věci než v textu
-- zprávy. Proto má čtení příloh vlastní souhlas (`ai_files_at`), který se
-- zapíná zvlášť a nejde zapnout bez toho základního.
--
-- Platí jen pro zprávu, u které člověk klikne. Automatické třídění přílohy
-- nečte nikdy. Z příloh se nic neukládá — žádný nový sloupec na obsah tu není.
--
-- Práva se nemění: řádek schránky vidí a mění jen její majitel.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table mail_accounts add column if not exists ai_files_at timestamptz;

comment on column mail_accounts.ai_files_at is
  'Kdy majitel schránky povolil, aby AI na kliknutí četla i přílohy zprávy (PDF, obrázky). NULL = vypnuto.';

-- Čtení příloh je širší souhlas než čtení textu — bez něj nedává smysl.
do $$ begin
  alter table mail_accounts
    add constraint mail_accounts_files_needs_consent
    check (ai_files_at is null or ai_consent_at is not null);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
