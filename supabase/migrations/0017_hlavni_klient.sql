-- ============================================================================
-- Hlavní klient
-- ----------------------------------------------------------------------------
-- Jeden klient může být pro studio důležitější než ostatní — třeba ten, u
-- koho se pracuje pravidelně několik dní v týdnu. Příznak jen řídí pořadí:
-- na Dnes se úkoly hlavního klienta řadí první v rámci stejného termínu
-- a v seznamu Klientů stojí nahoře. Žádné další chování na něm nevisí.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table clients add column if not exists is_priority boolean not null default false;

notify pgrst, 'reload schema';
