-- ============================================================================
-- Pošta (Gmail, jen čtení)
-- ----------------------------------------------------------------------------
-- Appka si od Gmailu bere jediné oprávnění `gmail.readonly` a čte jen
-- hlavičky. Těla zpráv ani úryvky se NEUKLÁDAJÍ — v tabulce leží odesílatel,
-- předmět, datum, stav a identifikátory, aby šlo zprávu otevřít v Gmailu.
--
-- Data z pošty se nikdy neposílají do žádné služby umělé inteligence: pravidla
-- (u koho leží odpověď, komu zpráva patří) počítá appka sama. Zakazuje to
-- politika Googlu pro data z Workspace API a zásady soukromí appky to slibují.
--
-- Práva jsou záměrně užší než u zbytku appky: schránka patří konkrétnímu
-- člověku, ne organizaci, takže i kolega s právem editovat do ní nevidí.
-- Stejná dohoda jako u `push_subscriptions` (migrace 0014).
--
-- Skript jde spustit opakovaně.
-- ============================================================================

do $$ begin
  -- waiting = poslední zpráva ve vlákně je od nich, čeká se na tvou odpověď
  -- info    = odpovězeno, nebo zpráva, která odpověď nečeká
  create type mail_status as enum ('waiting', 'info');
exception when duplicate_object then null; end $$;

create table if not exists mail_accounts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  email         text not null,
  -- Šifrovaný `refresh_token` od Googlu (AES-256-GCM, klíč MAIL_TOKEN_KEY).
  -- V čitelné podobě se nikam neukládá a do prohlížeče se nikdy neposílá.
  token_enc     text not null,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now(),
  -- Jeden člověk = jedna schránka. Druhé připojení přepíše to první.
  constraint mail_accounts_user_key unique (user_id)
);

create table if not exists mail_messages (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  gmail_id     text not null,
  thread_id    text not null,
  from_email   text not null,
  from_name    text,
  subject      text,
  received_at  timestamptz not null,
  status       mail_status not null default 'info',
  client_id    uuid references clients(id) on delete set null,
  -- Vyřízeno ručně („už to neřeš“). Zprávu to neskrývá z Gmailu, jen z appky.
  handled_at   timestamptz,
  -- Úkol, který z téhle zprávy vznikl (tlačítko „Udělat úkol“).
  task_id      uuid references tasks(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint mail_messages_user_gmail_key unique (user_id, gmail_id)
);

create index if not exists mail_messages_user_idx     on mail_messages (user_id, received_at desc);
create index if not exists mail_messages_client_idx   on mail_messages (client_id);
create index if not exists mail_messages_waiting_idx  on mail_messages (user_id, status) where handled_at is null;

-- Odesílatel, kterého už nechceš vídat. `pattern` je buď celá adresa
-- („noreply@firma.cz“), nebo doména („firma.cz“).
create table if not exists mail_ignored (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  pattern    text not null check (length(btrim(pattern)) > 0),
  created_at timestamptz not null default now(),
  constraint mail_ignored_user_pattern_key unique (user_id, pattern)
);

-- ---------------------------------------------------------------------------
-- Práva: vidí a mění jen ten, komu schránka patří.
-- ---------------------------------------------------------------------------
alter table mail_accounts enable row level security;
alter table mail_messages enable row level security;
alter table mail_ignored  enable row level security;

drop policy if exists "cteni vlastni schranky" on mail_accounts;
create policy "cteni vlastni schranky" on mail_accounts for select using (user_id = auth.uid());
drop policy if exists "zapis vlastni schranky" on mail_accounts;
create policy "zapis vlastni schranky" on mail_accounts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(org_id));

drop policy if exists "cteni vlastni posty" on mail_messages;
create policy "cteni vlastni posty" on mail_messages for select using (user_id = auth.uid());
drop policy if exists "zapis vlastni posty" on mail_messages;
create policy "zapis vlastni posty" on mail_messages for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(org_id));

drop policy if exists "cteni vlastnich ignorovanych" on mail_ignored;
create policy "cteni vlastnich ignorovanych" on mail_ignored for select using (user_id = auth.uid());
drop policy if exists "zapis vlastnich ignorovanych" on mail_ignored;
create policy "zapis vlastnich ignorovanych" on mail_ignored for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(org_id));

notify pgrst, 'reload schema';
