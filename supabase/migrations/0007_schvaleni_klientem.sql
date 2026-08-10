-- ============================================================================
-- Schvalovací odkaz pro klienta
-- ----------------------------------------------------------------------------
-- Úkol se dosud posouval jen zevnitř studia. Kroky „U klienta“ a „Ke schválení“
-- ale patří druhé straně — a ta účet nemá a mít nebude. Klient dostane odkaz
-- s tokenem a na něm rozhodne sám.
--
-- POZOR NA PRÁVA. Návštěvník téhle stránky je `anon` a nemá jediný řádek,
-- o který by se šlo opřít — řádková práva ho tu nechrání, protože chránit
-- nemají co. Celá ochrana je uvnitř těchhle dvou funkcí, takže musí platit
-- bez výjimky:
--
--   * token se porovnává na rovnost a má jednoznačný index,
--   * úkol musí patřit právě tomu klientovi, kterému token patří,
--   * rozhodovat lze jen o kroku, který na klienta skutečně čeká,
--   * krok se hýbe vždy o jedna a číslo kroku nikdy nepřichází zvenčí,
--   * archivovaný klient odkaz nemá — spolupráce skončila, přístup s ní.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Odpověď klienta. Bez ní by připomínka skončila v historii, kam se v aplikaci
-- nikdo nedívá — a klient by psal do prázdna.
-- ---------------------------------------------------------------------------
alter table tasks add column if not exists client_reply    text;
alter table tasks add column if not exists client_reply_at timestamptz;

comment on column tasks.client_reply is
  'Poslední zpráva od klienta ze schvalovacího odkazu. Zobrazuje se u úkolu.';

-- Pohled bere `t.*`, takže nové sloupce se do něj dostanou až po přestavění.
-- `create or replace` by tu selhalo — nové sloupce by přibyly doprostřed
-- seznamu a to Postgres u nahrazení pohledu nedovolí.
drop view if exists tasks_view;

create view tasks_view with (security_invoker = true) as
select
  t.*,
  ball_of(t.kind, t.step)      as ball,
  step_label(t.kind, t.step)   as step_name,
  case t.kind when 'interni' then 3 when 'klient' then 4 when 'tisk' then 6 end as step_count,
  (t.due_at is not null
     and t.due_at < now()
     and ball_of(t.kind, t.step) <> 'done')                                     as is_late,
  c.name  as client_name,
  c.color as client_color,
  s.name  as supplier_name,
  p.initials as assignee_initials
from tasks t
left join clients   c on c.id = t.client_id
left join suppliers s on s.id = t.supplier_id
left join profiles  p on p.id = t.assignee_id;

-- ---------------------------------------------------------------------------
-- Co klient na svém odkazu uvidí.
--
-- Vlastní poznámka studia (`tasks.note`) se ven nedává — ta je interní.
-- Ven jde jen to, co je s klientem domluvené, a stav úkolu.
-- ---------------------------------------------------------------------------
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
          'is_late',     (t.due_at is not null
                            and t.due_at < now()
                            and ball_of(t.kind, t.step) <> 'done')
        )
        -- Nahoru to, co čeká na klienta. Kvůli tomu sem chodí.
        order by
          case ball_of(t.kind, t.step)
            when 'client' then 0 when 'done' then 2 else 1 end,
          t.due_at nulls last,
          t.title
      )
      from tasks t
      where t.client_id = c.id
        -- Uzavřené drží kontext, ale nemusí být do nekonečna.
        --
        -- `closed_at` razítkuje spouštěč, který se pouští jen při úpravě —
        -- úkol založený rovnou jako hotový ho nemá. Bez záložního sloupce
        -- by takový úkol klientovi ze stránky tiše zmizel, aniž by se kde
        -- co ozvalo.
        and (ball_of(t.kind, t.step) <> 'done'
             or coalesce(t.closed_at, t.updated_at) > now() - interval '90 days')
    ), '[]'::jsonb)
  )
  from clients c
  join orgs o on o.id = c.org_id
  where c.share_token = p_token
    and c.archived = false
$$;

revoke all on function public_client_board(text) from public;
grant execute on function public_client_board(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rozhodnutí klienta.
--
-- Jediná zapisovací cesta, kterou má aplikace otevřenou bez přihlášení —
-- proto je tak úzká. Nepřebírá číslo kroku, jen směr, a i ten uplatní pouze
-- na úkolu, který na klienta v tu chvíli skutečně čeká.
-- ---------------------------------------------------------------------------
create or replace function client_decide(
  p_token   text,
  p_task    uuid,
  p_approve boolean,
  p_note    text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_client clients%rowtype;
  v_task   tasks%rowtype;
  v_note   text;
  v_to     smallint;
begin
  select * into v_client
    from clients
   where share_token = p_token
     and archived = false;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  select * into v_task
    from tasks
   where id = p_task
     and client_id = v_client.id
     and org_id = v_client.org_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'task');
  end if;

  -- Rozhodovat smí jen o tom, co na něj čeká. Bez téhle podmínky by klient
  -- posouval i kroky, které jsou na studiu nebo u tiskárny.
  if ball_of(v_task.kind, v_task.step) <> 'client' then
    return jsonb_build_object('ok', false, 'reason', 'step');
  end if;

  v_note := nullif(btrim(left(coalesce(p_note, ''), 2000)), '');

  -- Připomínka bez textu není připomínka — studio by nevědělo, co má opravit.
  if not p_approve and v_note is null then
    return jsonb_build_object('ok', false, 'reason', 'note');
  end if;

  -- Vždy o jeden krok. Schválení posune dál, připomínka vrátí na „Dělám“.
  v_to := case when p_approve then v_task.step + 1 else v_task.step - 1 end;

  update tasks
     set step            = v_to,
         client_reply    = v_note,
         client_reply_at = case when v_note is null then client_reply_at else now() end
   where id = v_task.id;

  -- Posun kroku zapíše spouštěč sám, ale bez autora — nepřihlášený návštěvník
  -- žádného nemá. Tenhle záznam doplňuje, kdo za tím stojí a proč.
  insert into task_events (org_id, task_id, actor_id, kind, from_step, to_step, detail)
  values (
    v_client.org_id, v_task.id, null,
    case when p_approve then 'client_approved' else 'client_changes' end,
    v_task.step, v_to,
    coalesce(v_note, 'Schváleno klientem ' || v_client.name)
  );

  return jsonb_build_object(
    'ok',        true,
    'step_name', step_label(v_task.kind, v_to),
    'ball',      ball_of(v_task.kind, v_to)::text
  );
end $$;

revoke all on function client_decide(text, uuid, boolean, text) from public;
grant execute on function client_decide(text, uuid, boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';
