-- ============================================================================
-- Veřejný report — zmrazení při publikaci
-- ----------------------------------------------------------------------------
-- Report se dosud dopočítával z aktuálních úkolů. To je správně, dokud je
-- konceptem — ale ve chvíli, kdy ho někomu pošleš, se dokument nesmí měnit
-- pod rukama. Smazaný úkol nebo posunutý krok by přepsal i report, který
-- příjemce dostal minulý týden.
--
-- Při publikaci proto uložíme snímek čísel a rozpadů. Veřejná stránka pak
-- čte snímek, ne živá data.
--
-- Skript jde spustit opakovaně.
-- ============================================================================

alter table reports add column if not exists snapshot jsonb;

comment on column reports.snapshot is
  'Zmrazená čísla a rozpady z okamžiku publikace. Veřejná stránka čte tohle, ne živé úkoly.';

-- ---------------------------------------------------------------------------
-- Veřejné čtení. Beze změny podmínek: token musí sedět, report musí být
-- publikovaný a odkaz nesmí být po platnosti.
-- ---------------------------------------------------------------------------
create or replace function public_report(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'label',        r.label,
    'period',       r.period,
    'starts_on',    r.starts_on,
    'ends_on',      r.ends_on,
    'summary',      coalesce(r.edited_summary, r.ai_summary),
    'outlook',      coalesce(r.edited_outlook, r.ai_outlook),
    'recipient',    r.recipient,
    'org_name',     o.name,
    'sender',       o.sender_name,
    'sender_mail',  o.sender_mail,
    'published_at', r.published_at,
    'snapshot',     r.snapshot
  )
  from reports r
  join orgs o on o.id = r.org_id
  where r.share_token = p_token
    and r.status = 'published'
    and r.share_until > now()
$$;

revoke all on function public_report(text) from public;
grant execute on function public_report(text) to anon, authenticated;

notify pgrst, 'reload schema';
