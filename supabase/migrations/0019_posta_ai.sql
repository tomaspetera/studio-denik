-- ============================================================================
-- Pošta: úkol z e-mailu pomocí AI — jen se souhlasem majitele schránky
-- ----------------------------------------------------------------------------
-- Dosud appka z Gmailu četla jen hlavičky a do AI nešlo nic. Nově umí na
-- kliknutí „Udělat úkol“ načíst text té jedné zprávy a nechat z něj AI
-- navrhnout úkol. Děje se to jen tehdy, když to majitel schránky výslovně
-- povolil — souhlas je tenhle sloupec. Bez něj se všechno chová jako dřív.
--
-- Text zprávy se ani teď nikam neukládá: načte se, pošle ke zpracování
-- a zahodí. V databázi zůstane až úkol, který člověk potvrdí.
--
-- K migraci 0018: její úvod říká, že data z pošty do AI nikdy nejdou. To
-- platilo do téhle změny. Pravidla Googlu pro data z Workspace API předání
-- dovolují, když slouží funkci viditelné v appce, uživatel s ním souhlasil
-- a příjemce data nepoužívá k vylepšování modelů (placená úroveň Gemini API).
-- Zásady soukromí appky (/soukromi) to popisují stejně.
--
-- Práva se nemění: řádek `mail_accounts` vidí a mění jen jeho majitel, takže
-- souhlas za někoho jiného dát nejde.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table mail_accounts add column if not exists ai_consent_at timestamptz;

comment on column mail_accounts.ai_consent_at is
  'Kdy majitel schránky povolil, aby AI četla text zprávy při návrhu úkolu. NULL = nepovoleno.';

notify pgrst, 'reload schema';
