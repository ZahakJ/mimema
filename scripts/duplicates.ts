// The template packs overlap. imgflip and memegen.link both carry the classics,
// and the same picture arrives under two names often enough that name-matching
// alone can't see it: "Two Buttons" and "Daily Struggle" are the same drawing,
// "Bell Curve" and "Midwit" the same chart, "Expanding Brain" and "Galaxy
// Brain" the same four panels. normalizeName() in fetch-templates.ts catches
// spelling drift; nothing short of looking at the pixels catches these.
//
// So they are listed. Each group was confirmed by eye — scripts/propose-
// duplicates.ts proposes candidates and then a human looks, because the hash
// cheerfully calls every four-panel meme a duplicate of every other one, and
// would have merged the four Socially * Penguins, which really are four
// different memes.
//
// This list is the single source of truth for two consumers:
//   fetch-templates.ts  — never import a `drop` id in the first place
//   dedupe-templates.ts — prune the ones an earlier run already imported
//
// Adding a group: put the better image in `keep` — a curated layout in
// scripts/layouts/ decides first (that placement is hand work, and dropping
// its template throws it away), then resolution, since export re-renders at
// the template's native size, and a blank always beats one with a caption
// baked in. `rename` folds the loser's name into the keeper's so the picker's
// search box still finds the meme under both.

export type DuplicateGroup = {
  /** the template id that survives */
  keep: string
  /** ids that are the same picture and must not coexist with it */
  drop: string[]
  /** optional new display name for the keeper (the id never changes) */
  rename?: string
  /** why this pair is a duplicate, in one line */
  note: string
}

export const DUPLICATE_GROUPS: DuplicateGroup[] = [
  // ————— same picture, different pack —————
  {
    keep: "i-am-the-captain-now",
    drop: ["i-m-the-captain-now", "look-at-me"],
    rename: "I am the Captain Now (Look At Me)",
    note: "same frame; memegen's 819x600 beats imgflip's 478x350 and 300x300 square crop",
  },
  {
    keep: "is-this-a-pigeon",
    drop: ["is-this-butterfly"],
    note: "byte-identical files, imported twice under two imgflip names",
  },
  {
    keep: "y-all-got-any-more-of-them",
    drop: ["y-all-got-any-more-of-that"],
    note: "same frame; 765x600 beats 600x471, and 'them' is the original line",
  },
  {
    keep: "drake-hotline-bling",
    drop: ["drake-blank", "no-yes"],
    note: "same two panels at 1200x1200 rather than 717x717; no-yes is the same two frames shrunk into a bordered table, and the keeper has the curated right-column layout",
  },
  {
    keep: "expanding-brain",
    drop: ["galaxy-brain"],
    rename: "Expanding Brain (Galaxy Brain)",
    note: "same four panels; 857x1202 beats 600x848",
  },
  {
    keep: "xzibit-yo-dawg",
    drop: ["yo-dawg-heard-you"],
    rename: "Yo Dawg (Xzibit)",
    note: "same portrait; 900x600 beats 500x323",
  },
  {
    keep: "bell-curve",
    drop: ["midwit"],
    rename: "Bell Curve (Midwit)",
    note: "same chart; lossless PNG line art beats a slightly larger JPEG of it",
  },
  {
    keep: "daily-struggle",
    drop: ["two-buttons"],
    rename: "Daily Struggle (Two Buttons)",
    note: "same drawing; memegen's copy has no tumblr watermark across the bottom",
  },
  {
    keep: "anakin-padme-4-panel",
    drop: ["anakin-and-padme-change-the-world-for-the-better"],
    rename: "Anakin and Padme (4 Panel)",
    note: "same four panels at 768x768 rather than 600x600",
  },
  {
    keep: "grant-gustin-next-to-oliver-queen-s-grave",
    drop: ["grant-gustin-over-grave"],
    rename: "Grant Gustin Over Grave",
    note: "same photo; 669x600 beats 500x475",
  },
  {
    keep: "megamind-no-bitches",
    drop: ["megamind-peeking"],
    note: "same frame, marginally wider crop, 674x734 against 540x540",
  },
  {
    keep: "bernie-sanders-once-again-asking",
    drop: ["bernie-i-am-once-again-asking-for-your-support"],
    note: "the dropped one has 'I am once again asking' burned into the image",
  },
  {
    keep: "disappointed-black-guy",
    drop: ["expectation-vs-reality"],
    rename: "Disappointed Black Guy (Expectation vs. Reality)",
    note: "same two frames, memegen's just leaves less white beside the face; 1172x756 beats 700x600 and only the keeper has a curated layout",
  },

  // ————— same meme, reordered or renamed title —————
  // These never made it in: normalizeName keeps word order (the Penguins
  // depend on it), so a reshuffled title reads as a new meme. Listed here they
  // are refused at the door instead.
  {
    keep: "ancient-aliens",
    drop: ["ancient-aliens-guy"],
    note: "renamed upstream",
  },
  {
    keep: "one-does-not-simply",
    drop: ["one-does-not-simply-walk-into-mordor"],
    note: "longer title upstream",
  },
  {
    keep: "oprah-you-get-a",
    drop: ["oprah-you-get-a-car"],
    note: "longer title upstream",
  },
  {
    keep: "roll-safe-think-about-it",
    drop: ["roll-safe"],
    note: "shorter title upstream",
  },
  {
    keep: "scooby-doo-mask-reveal",
    drop: ["scooby-doo-reveal"],
    note: "shorter title upstream",
  },
  {
    keep: "say-the-line-bart-simpsons",
    drop: ["say-the-line-bart"],
    note: "shorter title upstream",
  },
  {
    keep: "third-world-skeptical-kid",
    drop: ["skeptical-third-world-kid"],
    note: "word order differs",
  },
  {
    keep: "bugs-bunny-communist",
    drop: ["communist-bugs-bunny"],
    note: "word order differs",
  },
]

/** Every id that must never be imported → the id it duplicates. */
export const DUPLICATE_ALIASES: ReadonlyMap<string, string> = new Map(
  DUPLICATE_GROUPS.flatMap((g) => g.drop.map((d) => [d, g.keep] as const)),
)
