-- ─────────────────────────────────────────────────────────────────────
-- 062 — the screen's own background colour, for a backdrop built from
-- measurements.
--
-- Superseded within the day by 063: Heatmap and Session replay embed the
-- real customer app instead of rebuilding a picture of it, so nothing
-- about how a screen looked needs storing. Kept as a numbered file
-- because it was applied; 063 drops the column again.
-- ─────────────────────────────────────────────────────────────────────

alter table public.ux_layouts add column if not exists page text;
