-- ─────────────────────────────────────────────────────────────────────
-- 063 — the heatmap shows the real app, so `ux_layouts` shrinks back.
--
-- For a day, a snapshot measured how every piece of a screen was DRAWN —
-- colours, radii, type sizes, words, image URLs — so the dashboard could
-- rebuild a picture of it under the heat. The picture was never as good
-- as the thing: text wrapped differently in a font the dashboard has, and
-- a venue could not quite recognise its own app.
--
-- So Heatmap and Session replay now embed the actual customer app at
-- `/<slug>/?uxpreview=<screen>` — the same read-only boot Design & copy's
-- iframe uses, with no account, no writes and nothing tracked — and draw
-- the heat over it. Nothing about a screen's appearance is stored any
-- more, which is less data held about every visit and less work on the
-- customer's phone.
--
-- What is still measured, and all that is: where the CONTROLS were, as
-- fractions of the page. The Controls view needs it to say which button
-- is which and which ones nobody uses.
-- ─────────────────────────────────────────────────────────────────────

alter table public.ux_layouts drop column if exists page;

-- Rows captured while the richer shape was live carry keys nothing reads.
update public.ux_layouts
   set elements = (
         select coalesce(jsonb_agg(jsonb_build_object(
                  'k', e->'k', 'l', e->'l',
                  'x', e->'x', 'y', e->'y', 'w', e->'w', 'h', e->'h')), '[]'::jsonb)
           from jsonb_array_elements(elements) e
          where coalesce(e->>'t', 'btn') = 'btn'
       )
 where elements @> '[{"t": "text"}]'::jsonb
    or elements @> '[{"t": "img"}]'::jsonb
    or elements @> '[{"t": "box"}]'::jsonb;
