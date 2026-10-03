-- ============================================================================
-- Pošta: třídění podle priority pomocí AI — jen se zvláštním souhlasem
-- ----------------------------------------------------------------------------
-- Dosud AI četla e-mail jen na výslovné kliknutí u jedné zprávy (migrace
-- 0019). Tohle je krok dál: při načtení pošty může u nových zpráv, které
-- čekají na odpověď, sama určit, jak moc spěchají, a jednou větou shrnout,
-- o co jde. Text zprávy tím jde do AI automaticky — proto má vlastní souhlas
-- (`ai_auto_at`), který se zapíná zvlášť a nejde zapnout bez toho prvního.
--
-- Ukládá se zařazení a krátké shrnutí. Text zprávy se neukládá ani teď.
-- Vypnutím souhlasu appka zařazení i shrnutí smaže.
--
-- `ai_checked_at` říká, že zpráva už tříděním prošla — bez něj by se při
-- každém načtení posílala do AI znovu.
--
-- Práva se nemění: řádky vidí a mění jen majitel schránky.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

do $$ begin
  -- urgent = po mně se něco chce a spěchá to
  -- reply  = chce se odpověď nebo práce, ale nespěchá
  -- info   = nic se po mně nechce (poděkování, oznámení, newsletter)
  create type mail_priority as enum ('urgent', 'reply', 'info');
exception when duplicate_object then null; end $$;

alter table mail_accounts add column if not exists ai_auto_at timestamptz;

comment on column mail_accounts.ai_auto_at is
  'Kdy majitel schránky povolil automatické třídění pošty pomocí AI. NULL = vypnuto.';

-- Automatické třídění je širší souhlas než pomoc na kliknutí — bez ní nedává smysl.
do $$ begin
  alter table mail_accounts
    add constraint mail_accounts_auto_needs_consent
    check (ai_auto_at is null or ai_consent_at is not null);
exception when duplicate_object then null; end $$;

alter table mail_messages add column if not exists priority      mail_priority;
alter table mail_messages add column if not exists summary       text;
alter table mail_messages add column if not exists ai_checked_at timestamptz;

comment on column mail_messages.summary is
  'Jedna věta od AI, o co ve zprávě jde. Text zprávy se neukládá.';

do $$ begin
  alter table mail_messages
    add constraint mail_messages_summary_len
    check (summary is null or length(summary) <= 300);
exception when duplicate_object then null; end $$;

-- Zprávy, které tříděním ještě neprošly — hledají se při každém načtení pošty.
create index if not exists mail_messages_unsorted_idx
  on mail_messages (user_id)
  where ai_checked_at is null and handled_at is null;

notify pgrst, 'reload schema';
