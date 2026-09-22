-- ============================================================================
-- Push notifikace — poslední kus "mobilní appky"
-- ----------------------------------------------------------------------------
-- Kalendářní odběr (migrace 0008) umí termíny dostat do telefonu, ale
-- spolehlivé upozornění přesně v čas neumí — Google u odebíraných kalendářů
-- vestavěné budíky schválně ignoruje a stahuje nové termíny jen párkrát
-- denně. Tohle je ta chybějící část: prohlížeč/telefon si jednou uloží
-- "odběrné místo" (subscription) a server na něj pak sám pošle notifikaci,
-- bez ohledu na to, jestli appku má někdo zrovna otevřenou.
--
-- Jedno odběrné místo na zařízení, ne na uživatele — člověk přihlášený na
-- mobilu i na počítači dostane upozornění na obou, dokud si to sám nevypne
-- na tom kterém zařízení.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Stejné zařízení nemá smysl mít přihlášené dvakrát — prohlížeč jinak při
-- druhém "Zapnout upozornění" jen znovu pošle stejný endpoint.
create unique index if not exists push_subscriptions_endpoint_key on push_subscriptions (endpoint);
create index if not exists push_subscriptions_org_idx on push_subscriptions (org_id);

alter table push_subscriptions enable row level security;

-- Vlastní odběry vidí a ruší jen ten, komu patří — na rozdíl od zbytku
-- appky (kde kdokoli s právem editovat smí sáhnout na cizí záznam), tohle
-- je osobní nastavení konkrétního zařízení, ne provozní data studia.
drop policy if exists "cteni vlastnich odberu" on push_subscriptions;
create policy "cteni vlastnich odberu" on push_subscriptions for select
  using (user_id = auth.uid());

drop policy if exists "zapis vlastnich odberu" on push_subscriptions;
create policy "zapis vlastnich odberu" on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(org_id));

notify pgrst, 'reload schema';
