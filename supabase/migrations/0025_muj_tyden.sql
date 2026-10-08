-- ============================================================================
-- 0025 — Můj týden: den, na který si člověk úkol naplánoval
-- ============================================================================
-- Termín (`due_at`) říká, dokdy má být úkol hotový. Neříká, kdy se na něm bude
-- dělat — úkol s termínem v pátek se může dělat v úterý. `planned_for` je ten
-- druhý údaj: den, na který si úkol člověk sám zařadil na stránce „Můj týden“.
--
-- Je to jen den, bez hodiny. Prázdná hodnota znamená „nenaplánováno“. Pohled
-- `tasks_view` se nemění — plán si aplikace čte přímo z tabulky.
--
-- Skript jde pustit opakovaně.
-- ============================================================================

alter table tasks add column if not exists planned_for date;

comment on column tasks.planned_for is
  'Den, na který si úkol člověk naplánoval (stránka Můj týden). Nezávislé na termínu; null = nenaplánováno.';

-- Stránka čte jen naplánované úkoly jedné organizace.
create index if not exists tasks_org_planned_idx on tasks (org_id, planned_for) where planned_for is not null;

notify pgrst, 'reload schema';
