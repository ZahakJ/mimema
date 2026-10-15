# Curated template zones

One JSON file per template, named `<templateId>.json`. The pack importer only
knows a template's box count and stacks full-width bands; these files place the
boxes by hand. `npm run templates:layouts` writes them into the DB.

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

Fractions of the picture, 0..1. `x`/`y` are the box's top-left corner,
`w`/`h` its size, as everywhere else in the app.

`0.5, 0, 0.5, 1` is the right half. `0.03, 0.72, 0.94, 0.25` is a classic
bottom band.

## Placeholders

Every zone needs a placeholder that says what the box means, unique within
the template. "TOP TEXT", "BOTTOM TEXT", "TEXT 2" and empty are refused. The
forge shows it before you type, and the `/meme` skill
(`.claude/skills/meme/SKILL.md`) picks captions by it. Write it as the caption
it wants: "WHAT I EXPECTED", "WHAT I GOT", "THE 1% EDGE CASE".

## Placing boxes

- Keep a 0.02–0.03 margin off every edge of the area the caption lives in.
- Never cover the face or the object being labelled.
- A box may be as small as the label it holds. Shrink-to-fit handles long text
  (down to a floor), so size the box to the space that is *free*, not to the
  longest caption you can imagine.
- On a white caption column (Drake, Expanding Brain) set
  `"fill": "#000000", "stroke": "#ffffff"`; the default white-on-black outline
  is for text over the picture.

## Workflow

Work against a copy of `data/`:

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

With no captions the proof renders the placeholders. Pass captions to check
real ones, including a long one:

```bash
node tools/render-proof.mjs --out /tmp/proof/drake.png drake-hotline-bling \
  "placing zones by hand" "a script"
```

Many at once, one browser, `<outdir>/<id>.png` each:

```bash
node tools/render-proof.mjs --batch ids.txt --outdir /tmp/proof
```

Then `npm run templates:layouts` (`-- --dry-run` first to see what would
move). Re-running is idempotent. `npm run templates` only inserts zones, so a
re-fetch keeps these.

A layout for a template the data dir lacks is reported as `missing-in-db`
and skipped. If `templates:dedupe` pruned it, rename the file to the
surviving id (see `scripts/duplicates.ts`).
