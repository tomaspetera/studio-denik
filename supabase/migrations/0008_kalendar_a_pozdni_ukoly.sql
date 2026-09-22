-- ============================================================================
-- Kalendář + oprava "po termínu"
-- ----------------------------------------------------------------------------
-- CHYBA: úkol s termínem na dnešek se od časných ranních hodin ukazoval jako
-- "po termínu" — celý den, kdy ho člověk ještě v klidu stíhá. Příčina:
-- `is_late` porovnávalo okamžik (`due_at < now()`), ne kalendářní den.
-- `due_at` se ukládá jako půlnoc UTC dne, který si uživatel vybral (viz
-- Composer — `new Date("2026-09-22").toISOString()`). V Praze je ale UTC
-- půlnoc už 1–2 hodiny po místní půlnoci, takže "dnešní" termín byl v
-- databázi technicky v minulosti od chvíle, kdy uplynuly ty 1–2 hodiny.
--
-- OPRAVA: porovnávat kalendářní dny v pražském čase, ne okamžiky. Termín je
-- po splatnosti až o den, který po něm následuje — ne v hodinách toho dne.
--
-- Zároveň přibývá kalendář: token pro odběr termínů v telefonu (Google/Apple
-- Kalendář) — stejný princip jako u sdíleného reportu a schvalovacího odkazu,
-- jen na úrovni celého studia.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Jediné místo, kde se rozhoduje "je to pozdě". Bere volitelný `p_now`, aby
-- šlo chování ověřit testem bez čekání na skutečný čas.
-- ---------------------------------------------------------------------------
create or replace function is_task_late(
  p_due  timestamptz,
  p_kind task_kind,
  p_step smallint,
  p_now  timestamptz default now()
)
returns boolean
language sql stable
as $$
  select p_due is not null
     and ball_of(p_kind, p_step) <> 'done'
     and (p_due  at time zone 'Europe/Prague')::date
       < (p_now at time zone 'Europe/Prague')::date
$$;

-- Pohled bere `t.*`, `create or replace` proto nejde použít, kdyby se měnil
-- seznam sloupců — tady se mění jen výpočet `is_late`, sloupce zůstávají,
-- takže je bezpečné pohled nahradit na místě.
create or replace view tasks_view with (security_invoker = true) as
select
  t.*,
  ball_of(t.kind, t.step)      as ball,
  step_label(t.kind, t.step)   as step_name,
  case t.kind when 'interni' then 3 when 'klient' then 4 when 'tisk' then 6 end as step_count,
  is_task_late(t.due_at, t.kind, t.step)                                       as is_late,
  c.name  as client_name,
  c.color as client_color,
  s.name  as supplier_name,
  p.initials as assignee_initials
from tasks t
left join clients   c on c.id = t.client_id
left join suppliers s on s.id = t.supplier_id
left join profiles  p on p.id = t.assignee_id;

-- public_client_board používala stejný okamžikový výpočet — stejná chyba,
-- stejná oprava.
create or replace function public_client_board(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'client_name',  c.name,
    'client_color', c.color,
    'org_name',     o.name,
    'sender',       o.sender_name,
    'sender_mail',  o.sender_mail,
    'tasks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',          t.id,
          'title',       t.title,
          'step_name',   step_label(t.kind, t.step),
          'ball',        ball_of(t.kind, t.step)::text,
          'due_at',      t.due_at,
          'agreed_at',   t.agreed_at,
          'agreed_note', t.agreed_note,
          'reply',       t.client_reply,
          'reply_at',    t.client_reply_at,
          'is_late',     is_task_late(t.due_at, t.kind, t.step)
        )
        order by
          case ball_of(t.kind, t.step)
            when 'client' then 0 when 'done' then 2 else 1 end,
          t.due_at nulls last,
          t.title
      )
      from tasks t
      where t.client_id = c.id
        and (ball_of(t.kind, t.step) <> 'done'
             or coalesce(t.closed_at, t.updated_at) > now() - interval '90 days')
    ), '[]'::jsonb)
  )
  from clients c
  join orgs o on o.id = c.org_id
  where c.share_token = p_token
    and c.archived = false
$$;

-- ---------------------------------------------------------------------------
-- Odběr kalendáře do telefonu.
--
-- Token na úrovni celého studia — jeden odkaz, jedno přidání do telefonu,
-- vidět všechny termíny týmu. Google i Apple Kalendář si takový odkaz
-- pravidelně sami stahují; nepřihlašují se, takže totéž pravidlo jako
-- u schvalovacího odkazu platí i tady: kdo má token, ten vidí obsah, jinou
-- ochranu externí kalendář nabídnout neumí.
-- ---------------------------------------------------------------------------
alter table orgs add column if not exists calendar_token text unique default random_token(32);

comment on column orgs.calendar_token is
  'Token pro odběr termínů z telefonu (ICS odkaz). Kdo ho má, vidí termíny studia bez přihlášení — jako u schvalovacího odkazu.';

-- Existující organizace při přidání sloupce dostanou token automaticky
-- (DEFAULT se při ALTER TABLE ADD COLUMN doplní i do starých řádků).

create or replace function public_calendar_feed(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'org_name', o.name,
    -- Tři dílčí seznamy spojené do jednoho pole. `||` mezi jsonb poli
    -- spojuje prvky — proto tři samostatná `coalesce(...)` a ne tři
    -- klíče se stejným jménem, které by se navzájem přepsaly.
    'events',
      coalesce((
        -- Termíny úkolů. Jen otevřené — hotový úkol už žádnou připomínku
        -- nepotřebuje, jen by zanášel kalendář.
        select jsonb_agg(jsonb_build_object(
          'uid',    'due-' || t.id,
          'date',   t.due_at,
          'title',  t.title,
          'client', c.name,
          'kind',   'due'
        ))
        from tasks t
        left join clients c on c.id = t.client_id
        where t.org_id = o.id
          and t.due_at is not null
          and ball_of(t.kind, t.step) <> 'done'
          and t.due_at > now() - interval '30 days'
          and t.due_at < now() + interval '180 days'
      ), '[]'::jsonb)
      ||
      coalesce((
        -- Co je s klientem domluveno a na kdy.
        select jsonb_agg(jsonb_build_object(
          'uid',    'agreed-' || t.id,
          'date',   t.agreed_at,
          'title',  coalesce(t.agreed_note, t.title),
          'client', c.name,
          'kind',   'agreed'
        ))
        from tasks t
        left join clients c on c.id = t.client_id
        where t.org_id = o.id
          and t.agreed_at is not null
          and ball_of(t.kind, t.step) <> 'done'
          and t.agreed_at > now() - interval '30 days'
          and t.agreed_at < now() + interval '180 days'
      ), '[]'::jsonb)
      ||
      coalesce((
        -- Co slíbila tiskárna.
        select jsonb_agg(jsonb_build_object(
          'uid',    'print-' || j.id,
          'date',   j.promised_at,
          'title',  t.title,
          'client', c.name,
          'kind',   'print'
        ))
        from print_jobs j
        join tasks t on t.id = j.task_id
        left join clients c on c.id = t.client_id
        where j.org_id = o.id
          and j.promised_at is not null
          and j.delivered_at is null
          and j.promised_at > now() - interval '30 days'
          and j.promised_at < now() + interval '180 days'
      ), '[]'::jsonb)
  )
  from orgs o
  where o.calendar_token = p_token
$$;

revoke all on function public_calendar_feed(text) from public;
grant execute on function public_calendar_feed(text) to anon, authenticated;

notify pgrst, 'reload schema';
