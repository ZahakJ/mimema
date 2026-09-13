# Curated template zones

One JSON file per template, named `<templateId>.json`. The pack importer only
knows a template's *box count*, so it hands every one of them the same
evenly-stacked full-width bands — wrong for almost every meme. These files are
the hand-placed truth, and `npm run templates:layouts` writes them into the DB.

```json
{
  "id": "drake-hotline-bling",
  "zones": [
    {
      "x": 0.53, "y": 0.04, "w": 0.44, "h": 0.4,
      "align": "center", "valign": "middle",
      "style": { "fontFrac": 0.075, "fill": "#000000", "stroke": "#ffffff" },
      "placeholder": "REJECTED THING"
    },
    { "…": "one object per caption box, in caption order" }
  ]
}
```

`id` must equal the filename. Zones are validated with `zonesSchema` from
`shared/schema.ts`: 1–24 of them, everything but `x`/`y`/`w`/`h` optional.
Worth setting by hand: `align` (left/center/right), `valign`
(top/middle/bottom), `angle` (degrees, clockwise, for a caption on a tilted
sign), and inside `style`: `fontFrac`, `fill`, `stroke`. Everything else takes
its default (Anton, white on black, ALL CAPS).

## Coordinates

Fractions of the picture, 0..1. `x`/`y` are the box's **top-left** corner,
`w`/`h` its size — the same system templates, editor layers and the zone editor
all share, so a number here means the same thing everywhere.

`0.5, 0, 0.5, 1` is the right half. `0.03, 0.72, 0.94, 0.25` is a classic
bottom band.

## Placeholders

**Every zone needs a placeholder that says what the box means**, and no two
zones in a template may share one. "TOP TEXT", "BOTTOM TEXT", "TEXT 2" and
empty are refused. The placeholder is the zone's meaning: it is what a human
sees in the forge before they type, and it is how the `/meme` skill
(`.claude/skills/meme/SKILL.md`) knows that Drake's first box wants the thing
being rejected. Write it as the caption it wants — "WHAT I EXPECTED", "WHAT I
GOT", "THE 1% EDGE CASE".

## Placing boxes

- Keep a 0.02–0.03 margin off every edge of the area the caption lives in.
- Never cover the face or the object being labelled — that is the joke.
- A box may be as small as the label it holds. Shrink-to-fit handles long text
  (down to a floor), so size the box to the space that is *free*, not to the
  longest caption you can imagine.
- On a white caption column (Drake, Expanding Brain) set
  `"fill": "#000000", "stroke": "#ffffff"`; the default white-on-black outline
  is for text over the picture.

## Workflow

A throwaway server so you never write to the live `data/`:

```bash
cp -r data /tmp/proof-data                      # or symlink templates/
DATA_DIR=/tmp/proof-data PORT=6901 node server/index.ts &
```

Then, per template: write the file, apply it, look at it.

```bash
DATA_DIR=/tmp/proof-data node scripts/apply-layouts.ts --only drake-hotline-bling
node tools/render-proof.mjs --origin http://127.0.0.1:6901 \
  --out /tmp/proof/drake.png drake-hotline-bling
```

With no captions the proof renders the template's own placeholders — which is
the point: it shows whether the boxes say what they mean and where they sit.
Pass captions to check a real one, including a long one:

```bash
node tools/render-proof.mjs --out /tmp/proof/drake.png drake-hotline-bling \
  "placing zones by hand" "a script"
```

Many at once, one browser, `<outdir>/<id>.png` each:

```bash
node tools/render-proof.mjs --batch ids.txt --outdir /tmp/proof
```

When it looks right, apply for real: `npm run templates:layouts` (add
`-- --dry-run` first to see what would move). Re-running is free — a template
already holding its layout is reported unchanged. `npm run templates` is
insert-only for zones, so a pack re-pull can never undo this.

A layout naming a template the data dir doesn't hold — `templates:dedupe`
pruned it as a duplicate, say — reports as `missing-in-db` and is skipped. If
that's the pruned half of a duplicate pair, rename the file to the survivor's
id (see `scripts/duplicates.ts`).
