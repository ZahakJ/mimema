# Templates

A template is a blank image plus its caption zones. Template images are not
in the repository: `npm run templates` downloads them into `DATA_DIR`. What
the repository does hold is the curation on top of them: where each caption
goes, which templates are the same picture, and what the well-known ones
mean.

```
npm run templates           fetch the packs (insert-only)
npm run templates:layouts   write scripts/layouts/*.json zones into the database
npm run templates:dedupe    delete duplicates an older fetch let in
```

All three read `DATA_DIR` from the environment or `.env` and are safe to
re-run.

## Import

`scripts/fetch-templates.ts` reads two free, unauthenticated indexes:

| Source | Index | Zones from |
| --- | --- | --- |
| imgflip | `https://api.imgflip.com/get_memes` (~100) | `box_count` |
| memegen.link | `https://api.memegen.link/templates/` (~200) | `lines` |

For each candidate, in that order:

1. The id is `slugifyName(name)`. An id listed as a duplicate in
   `scripts/duplicates.ts`, or a name whose normalised form (lowercase,
   alphanumerics, stop words such as *the*, *a*, *of*, *meme* dropped, word
   order kept) is already present, is skipped.
2. An id that already exists is skipped. If that row came from the same source
   and has no attribution yet, its `source_url` and `source_ref` are filled in;
   nothing else about an existing row is touched.
3. Otherwise the image is downloaded (three tries), typed by `sniff()`,
   measured by `imageSize()`, and inserted with `defaultZones(n)`: one bottom
   band, top and bottom bands, or *n* evenly stacked bands (at most six).

Requests are spaced 150 ms apart. A failed template is counted and logged; an
unreachable index skips that source. About 260 templates remain after
duplicates.

Because the import never rewrites zones, curated layouts survive every
re-fetch.

## Curated layouts

The default bands are wrong for most memes: Drake's captions belong in the
right-hand column, Distracted Boyfriend's on the three people. `scripts/layouts/`
holds one hand-placed file per template, `<id>.json`, with the zones in caption
order. `scripts/layouts.ts` is the only reader. It requires the `id` to match
the file name, validates the zones with `zonesSchema`, and rejects a
placeholder that is empty, generic (`TOP TEXT`, `BOTTOM TEXT`, `TEXT n`) or
repeated within the template: a placeholder states what the zone means
("REJECTED THING", "WHAT I GOT"), and both the forge and the relay's picker
rely on it.

`npm run templates:layouts` compares each file with the stored zones after
normalising both through the schema, and writes only the ones that differ.
`--dry-run` reports, `--only id1,id2` limits. A single invalid file aborts the
run before anything is written. A layout for a template not in the database is
reported and skipped.

To check a layout visually, render it through the real forge:

```sh
node tools/render-proof.mjs --origin http://127.0.0.1:6901 --out drake.png drake-hotline-bling
node tools/render-proof.mjs --batch ids.txt --outdir proofs/
```

With no captions it renders the placeholders. The authoring guide, with
coordinates and placement rules, is
[`scripts/layouts/README.md`](../scripts/layouts/README.md).

## Duplicates

The two packs ship some pictures under unrelated names ("Two Buttons" and
"Daily Struggle", "Bell Curve" and "Midwit"), which name matching cannot see.
`scripts/duplicates.ts` lists each confirmed group as `{keep, drop[], rename?,
note}`. The keeper is the one with a curated layout, then the higher
resolution, then a blank over one with text baked in; `rename` folds the
dropped names into the keeper's so search finds it under either.

The list has two readers. The importer never inserts a `drop` id.
`npm run templates:dedupe` (`--dry-run` to preview) removes dropped ids from an
existing database, first repointing their items to the keeper, because the
foreign key is `ON DELETE SET NULL` and a plain delete would cut those items'
link to their template.

`scripts/propose-duplicates.ts` suggests new pairs. It computes two 64-bit
difference hashes per image with ImageMagick (one of the whole frame, one with
blank gutters cropped, so the same meme cropped to different aspect ratios
still matches) and prints pairs within a Hamming distance (default 10). It
only proposes: multi-panel templates hash alike, so every pair is checked by
eye before it is added to the list.

## Meanings

`scripts/meanings.json` records, for about 85 widely recognised templates,
one line saying what the picture asserts and the joke shapes it can carry:

```json
"bell-curve": {
  "says": "the idiot and the genius land on the same simple answer; the midwit in the middle has an elaborate wrong one",
  "shapes": ["same-thing"]
}
```

The shapes are a fixed set of eight, defined in `scripts/meanings.ts`:
`irony`, `contrast`, `predictable`, `overreaction`, `same-thing`,
`escalation`, `denial`, `mockery`. The file is deliberately partial; an id not
present in the catalog is ignored. Only the relay uses it ([RELAY.md](RELAY.md)).

## Custom templates

`#/add-template` takes any image, lets you draw up to 24 zones on it with the
same move and resize handles as the forge, previews text at the default size,
and posts it to `POST /api/templates` with the key. Custom templates appear
under "yours" in the picker.

## Seed

`npm run seed` imports the files in `seed-assets/` as wall items. Identical
bytes are deduplicated, so it can be re-run.
