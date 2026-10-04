-- ============================================================================
-- Pošta: ranní načtení bez kliknutí — jen se souhlasem majitele schránky
-- ----------------------------------------------------------------------------
-- Dosud se pošta z Gmailu načítala jen ve chvíli, kdy majitel schránky klikl
-- na „Obnovit“. Tohle je krok dál: v úterý, ve středu a ve čtvrtek ráno ji
-- může appka načíst sama (ranní cron), aby na stránce Dnes a v ranním
-- upozornění bylo vidět, kolik zpráv čeká na odpověď.
--
-- Appka tím čte Gmail, i když ji člověk nemá otevřenou — proto má ranní
-- načtení vlastní souhlas (`auto_sync_at`) a ve výchozím stavu je vypnuté.
--
-- Čte se totéž co při „Obnovit“: hlavičky zpráv. Nové zprávy se přitom
-- roztřídí jen tehdy, když má majitel zapnuté i automatické třídění
-- (`ai_auto_at`, migrace 0021). Text zprávy se neukládá ani teď.
--
-- Práva se nemění: řádek schránky vidí a mění jen její majitel. Ranní běh
-- používá servisní klíč a načítá jen schránky, které mají `auto_sync_at`.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table mail_accounts add column if not exists auto_sync_at timestamptz;

comment on column mail_accounts.auto_sync_at is
  'Kdy majitel schránky povolil ranní načítání pošty bez kliknutí (úterý, středa, čtvrtek). NULL = vypnuto.';

notify pgrst, 'reload schema';
