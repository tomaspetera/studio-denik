-- ============================================================================
-- Šablony úkolů a opakované úkoly
-- ----------------------------------------------------------------------------
-- Šablona je předvyplněný úkol (název, typ, velikost, klient, kategorie,
-- termín "za N dní"). Kroky do ní nepatří — ty už nese typ úkolu (interní 3,
-- s klientem 4, tiskový 6), takže "zakázka o osmi krocích" tu nemá co dělat.
--
-- Opakovaný úkol je pravidlo: týdně v daný den v týdnu, nebo měsíčně v daný
-- den v měsíci. Úkoly z něj zakládá `create_due_recurring_tasks`, kterou
-- volá ranní cron (a appka hned po uložení pravidla).
--
-- Dny 29.–31. se u měsíčních pravidel záměrně nenabízejí — v kratším měsíci
-- by se úkol tiše přeskočil.
--
-- Záznam o vytvořeném výskytu (`recurring_task_runs`) je pojistka proti
-- dvojímu založení: dvojice (pravidlo, den) je jedinečná, takže ani dvojí
-- spuštění cronu, ani ruční spuštění navíc úkol nezduplikuje. Záznam přežije
-- smazání vzniklého úkolu — úkol, který jsi smazal, se v ten den nevrátí.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

do $$ begin
  create type recurrence_frequency as enum ('weekly', 'monthly');
exception when duplicate_object then null; end $$;

create table if not exists task_templates (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  title           text not null check (length(btrim(title)) > 0),
  kind            task_kind not null default 'klient',
  size            smallint not null default 2 check (size between 1 and 3),
  client_id       uuid references clients(id) on delete set null,
  category_id     uuid references categories(id) on delete set null,
  -- termín = den založení + tolik dní; null = bez termínu
  due_offset_days int check (due_offset_days between 0 and 365),
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists task_templates_org_idx on task_templates (org_id);

create table if not exists recurring_tasks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  title           text not null check (length(btrim(title)) > 0),
  kind            task_kind not null default 'interni',
  size            smallint not null default 2 check (size between 1 and 3),
  client_id       uuid references clients(id) on delete set null,
  category_id     uuid references categories(id) on delete set null,
  due_offset_days int check (due_offset_days between 0 and 365),
  frequency       recurrence_frequency not null,
  -- ISO: 1 = pondělí … 7 = neděle
  weekday         smallint check (weekday between 1 and 7),
  month_day       smallint check (month_day between 1 and 28),
  active          boolean not null default true,
  -- Komu úkol patří: tomu, kdo pravidlo založil.
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint recurring_schedule_shape check (
    (frequency = 'weekly'  and weekday is not null and month_day is null) or
    (frequency = 'monthly' and month_day is not null and weekday is null)
  )
);

create index if not exists recurring_tasks_org_idx on recurring_tasks (org_id);

create table if not exists recurring_task_runs (
  recurring_id uuid not null references recurring_tasks(id) on delete cascade,
  run_on       date not null,
  org_id       uuid not null references orgs(id) on delete cascade,
  task_id      uuid references tasks(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (recurring_id, run_on)
);

-- ---------------------------------------------------------------------------
-- Práva: čtení pro členy, zápis pro ty, kdo smí editovat — stejně jako
-- u ostatních tabulek.
-- ---------------------------------------------------------------------------
alter table task_templates     enable row level security;
alter table recurring_tasks    enable row level security;
alter table recurring_task_runs enable row level security;

drop policy if exists "cteni sablon" on task_templates;
create policy "cteni sablon" on task_templates for select using (is_member(org_id));
drop policy if exists "zapis sablon" on task_templates;
create policy "zapis sablon" on task_templates for all
  using (can_edit(org_id)) with check (can_edit(org_id));

drop policy if exists "cteni opakovani" on recurring_tasks;
create policy "cteni opakovani" on recurring_tasks for select using (is_member(org_id));
drop policy if exists "zapis opakovani" on recurring_tasks;
create policy "zapis opakovani" on recurring_tasks for all
  using (can_edit(org_id)) with check (can_edit(org_id));

drop policy if exists "cteni behu opakovani" on recurring_task_runs;
create policy "cteni behu opakovani" on recurring_task_runs for select using (is_member(org_id));
drop policy if exists "zapis behu opakovani" on recurring_task_runs;
create policy "zapis behu opakovani" on recurring_task_runs for all
  using (can_edit(org_id)) with check (can_edit(org_id));

-- ---------------------------------------------------------------------------
-- Založení úkolů, které mají dnes (nebo v posledních `p_days_back` dnech)
-- vzniknout. Vrací počet nově založených.
--
-- Záměrně bez `security definer`: běží pod právy volajícího. Cron jede
-- servisním klíčem (obchází RLS), přihlášený člověk smí založit jen úkoly
-- ve své organizaci — cizí pravidla nevidí, takže pro cizí `p_org` nevznikne
-- nic. Díky tomu funkce nepotřebuje vlastní kontrolu práv.
--
-- Doháněné dny (`p_days_back`) kryjí výpadek cronu: když ranní běh jednou
-- nevyjde, pátek se nevytratí. Pravidlo ale nikdy nezakládá výskyty ze dne,
-- který předcházel jeho vzniku — pravidlo založené v sobotu na pátek nesmí
-- hned vyrobit páteční úkol.
-- ---------------------------------------------------------------------------
create or replace function create_due_recurring_tasks(
  p_org       uuid,
  p_today     date,
  p_days_back int default 2
) returns int
language plpgsql
as $$
declare
  r         recurring_tasks%rowtype;
  d         date;
  v_claimed int;
  v_task    uuid;
  v_created int := 0;
begin
  for d in
    select g::date
    from generate_series(p_today - greatest(p_days_back, 0), p_today, interval '1 day') as g
  loop
    for r in
      select *
      from recurring_tasks
      where org_id = p_org
        and active
        and d >= (created_at at time zone 'Europe/Prague')::date
        and (
          (frequency = 'weekly'  and weekday   = extract(isodow from d)::int) or
          (frequency = 'monthly' and month_day = extract(day   from d)::int)
        )
    loop
      insert into recurring_task_runs (recurring_id, run_on, org_id)
      values (r.id, d, p_org)
      on conflict do nothing;
      get diagnostics v_claimed = row_count;

      if v_claimed = 1 then
        insert into tasks (
          org_id, title, kind, step, size, client_id, category_id,
          assignee_id, created_by, due_at
        ) values (
          p_org, r.title, r.kind, 0, r.size, r.client_id, r.category_id,
          r.created_by, r.created_by,
          case when r.due_offset_days is null then null
               else ((d + r.due_offset_days)::timestamp at time zone 'UTC') end
        )
        returning id into v_task;

        update recurring_task_runs
           set task_id = v_task
         where recurring_id = r.id and run_on = d;

        v_created := v_created + 1;
      end if;
    end loop;
  end loop;

  return v_created;
end $$;

notify pgrst, 'reload schema';
