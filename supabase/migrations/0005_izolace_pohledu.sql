-- ============================================================================
-- OPRAVA BEZPEČNOSTI: pohledy musí ctít práva toho, kdo se ptá
-- ----------------------------------------------------------------------------
-- Pohled se v PostgreSQL ve výchozím stavu vykonává právy svého vlastníka,
-- ne právy toho, kdo se ptá. Práva na úrovni řádků z podkladové tabulky se
-- tím přeskočí.
--
-- `tasks_view` proto vydával úkoly VŠECH organizací komukoliv přihlášenému —
-- přestože tabulka `tasks` byla zamčená správně. Aplikace čte úkoly výhradně
-- přes tenhle pohled, takže šlo o únik dat napříč celou aplikací.
--
-- `security_invoker` to obrací: pohled běží právy dotazujícího a práva na
-- řádcích se uplatní. Ověřuje to `npm run test:izolace`.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter view tasks_view set (security_invoker = true);

do $$ begin
  alter view team_view set (security_invoker = true);
exception when undefined_table then
  -- team_view vzniká až migrací 0004; když ještě není, nevadí — vytvoří se
  -- rovnou správně.
  raise notice 'team_view zatim neexistuje, preskakuji';
end $$;

notify pgrst, 'reload schema';
