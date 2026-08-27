# On the Quiddity of the Meme

### A Rigorous Treatment of That Which Is Imitated, with Applications to the Forge

**mimema working paper № 1 — version 1.0.0**

---

## Abstract

We present a formal account of the meme. Despite fifty years of vigorous
posting, the field lacks a rigorous foundation: practitioners routinely deploy
memes *in production* with no formal semantics, no type system, and no test
coverage. This paper closes the gap. We define the meme as a triple, state its
axioms, prove its fundamental theorem (a meme explained is a meme destroyed),
resolve the essence/existence distinction for templates versus instances, and
ground the whole apparatus in a pragmatist criterion of truth under which a
meme is true precisely insofar as it is relatable. We conclude with threats to
validity, of which there are many, and an ethics statement, which is short.

**Keywords:** memetics, quiddity, deep-frying, image macros, pragmatism,
the Floating Meme, top text.

---

## 1. Introduction

In 1976, Richard Dawkins, needing a name for a unit of cultural transmission
and finding "mimeme" (from μίμημα, *that which is imitated*) too long, cut it
down to "meme" so it would sound a bit like "gene."¹ This act — truncating a
perfectly good Greek word for virality — was itself the first meme by its own
definition, which the reader will note is the kind of self-hosting bootstrap
normally only achieved by compilers.

Since then the meme has become the dominant medium of human sentiment, yet the
literature remains scandalously informal. Definitions are circulated as
screenshots of definitions. Peer review is conducted via the ratio. The
present work supplies what the field has always lacked and never once asked
for: **rigor**.

¹ Dawkins, R. (1976). *The Selfish Gene*. Oxford University Press. The
authors have read at least the relevant page.

---

## 2. Definitions

**Definition 2.1 (Meme).** A *meme* is a triple **M = (P, R, F)** where:

- **P** is the *payload* — an image, video, phrase, or unaccountable feeling;
- **R** is the *replication mechanism* — screenshot, forward, repost, or
  saying it out loud at work until a coworker sighs;
- **F** is the *fitness function* — a mapping from (payload, audience,
  timestamp) to shares. F is not differentiable, not continuous, and not
  your friend.

**Definition 2.2 (Template).** A *template* is a meme payload with typed
holes. Formally it is a lambda abstraction over text zones:
`λ(topText, bottomText, …). P`. Plato called templates "Forms" and claimed
they lived outside spacetime; we store ours in `data/templates/`, which is
gitignored, and is therefore also outside spacetime as far as the repository
is concerned.

**Definition 2.3 (Instance).** An *instance* is a template applied to
arguments. Instantiation is total: there is no template so cursed that no
caption can be applied to it. (Proof: empirical; see any wall.)

**Definition 2.4 (Dankness).** A partial order ⪯ on memes. Antisymmetry
fails in practice (two memes can each be considered danker than the other by
different group chats), so dankness is properly a *preorder*, which explains
most internet arguments.

**Definition 2.5 (Normie).** An evaluation context in which F ≈ 0 for all
inputs minted after 2016.

---

## 3. Axioms

**A1 (Conservation of Relatability).** Relatability is neither created nor
destroyed; it is only redistributed from the specific to the general. A meme
about *your* Monday becomes a meme about *Mondays*.

**A2 (The Explanation–Annihilation Principle).** The humor content of a meme
and the completeness of its explanation cannot simultaneously be nonzero.
This is not a limitation of our instruments. It is a property of the meme.

**A3 (Monotonicity of Context Collapse).** Every meme drifts toward an
audience that lacks the context for it. The half-life of shared context is
approximately one repost.

**A4 (The Grandparent Limit).** Every meme is eventually received, sincerely
and without irony, by someone's grandparent, at which point it exits
circulation. This is the memetic analogue of heat death.

**A5 (Impact Invariance).** Any meme text set in Impact (or a licensed
stand-in such as Anton — see §7) is *prima facie* recognized as a caption
and not as a statement by the image's original author. This axiom is
load-bearing for the entire legal system of the internet.

---

## 4. The Fundamental Theorem of Memetics

**Theorem 4.1.** *A meme explained is a meme destroyed.*

**Proof.** Let M = (P, R, F) with F(M) > 0, and let E(M) be a complete
explanation of why M is funny. By A2, humor(M) · completeness(E) = 0.
Since E is complete, completeness(E) > 0, hence humor(M) = 0, hence
F(M) = 0 for all audiences, including the one that just asked "wait, I
don't get it." The meme persists as bytes but is dead as a meme; what
remains is a *fossil*, suitable only for academic citation. ∎

**Corollary 4.2 (The Observer Effect).** Asking "is this funny?" collapses
the meme's humor superposition, and never in the direction you hoped.

**Corollary 4.3 (Self-Application).** This paper, being a complete
explanation of memes, is not itself funny. Any laughter experienced while
reading it is a measurement error and should be reported as an issue.

---

## 5. Essence and Existence, or: The Metaphysics of the Template

A certain eleventh-century physician and logician held that the *essence* (quiddity,
*māhiyya*) of a thing is distinct from its *existence*, and that essence in
itself is indifferent to whether it exists.² The meme confirms this with a
precision the eleventh century could only dream of:

- The **template** is essence. "Distracted Boyfriend" *as such* asserts
  nothing, mocks no one, ships no take. It merely *is* — three typed holes
  and a promise.
- The **instance** is existence. The moment captions are applied, the meme
  comes to exist *contingently*: it could have been about JavaScript
  frameworks, and in fact it usually is.
- Every contingent instance receives its existence from something prior —
  instance from template, template from screenshot, screenshot from some
  original event that is, per Baudrillard,³ no longer locatable and possibly
  never occurred. Following the chain backward, one arrives at that which
  exists necessarily and is the uncaused cause of all instances. The
  scholastics called this the Necessary Existent. We call it **the classic
  pack**, and `npm run templates` will install it.

**Thought experiment 5.1 (The Floating Meme).** Suppose a meme created in a
void: no viewers, no feed, no metrics, its creator suspended in sensory
deprivation with the post button pressed into darkness. Does the meme exist?
The philosopher's original argument concluded that the floating man, cut off
from all sensation, still affirms his own self. We reach the parallel
conclusion: the floating meme is still *self-aware* — but by Definition 2.1
it is not yet a *meme*, because R and F are undefined. It is merely
*content*. The distinction between a meme and content is exactly the
distinction between a self and a corpse.

² Ibn Sina, *Kitāb al-Shifāʾ* (The Book of Healing), Metaphysics I.5. The
book healed no one; the title remains aspirational.
³ Baudrillard, J. (1981). *Simulacres et Simulation*. A deep-fried JPEG is
a copy so many generations removed from its original that it becomes
hyperreal. Baudrillard saw it coming.

---

## 6. The Pragmatist Criterion

Metaphysics tells us what a meme *is*; it cannot tell us whether a meme is
*good*. For that we require the pragmatic maxim: the meaning of a conception
is exhausted by its practical effects.⁴ Applied to memetics:

**Criterion 6.1 (Cash-Value).** The entire meaning of a meme is the
difference it makes in practice. A meme's practical effects are enumerable:
it is forwarded, or it is not. It gets "lmaoo," or it gets "lol" (a
catastrophic outcome), or — worst of all — it gets *seen-zoned*, the
pragmatist's name for meaninglessness.

**Criterion 6.2 (Truth).** Pragmatism holds that truth is what works. A meme
therefore is *true* precisely insofar as it is **relatable**. The vernacular
confirms the theory: the highest truth-predicate available to a meme is not
"accurate" but "**too real**." No correspondence theory of truth can explain
why a cartoon dog in a burning room is the most accurate description of the
twenty-first century yet produced. Pragmatism can.

**Criterion 6.3 (Verification).** Claims about memes must cash out in
observable posting behavior. A meme that is "funny in principle" is like a
check drawn on a bank that does not exist. Post it or retract it.

This criterion has engineering consequences. It is why the Forge ships a
**download button** and a **wall**: a meme unexported is a proposition
unasserted. The system is, in the strict technical sense, a pragmatism
compiler — it lowers essence (§5) into cash-value (§6) at native template
resolution.

⁴ Peirce, C.S. (1878), "How to Make Our Ideas Clear"; James, W. (1907),
*Pragmatism*. Neither is in a position to object.

---

## 7. Formal Semantics of the Image Macro

The classical image macro admits a complete grammar:

```
macro      ::= TOP-TEXT image BOTTOM-TEXT
TOP-TEXT   ::= situation | ""
BOTTOM-TEXT::= subversion | ""
situation  ::= UPPERCASE-STRING          (* Impact, white, black outline *)
subversion ::= UPPERCASE-STRING          (* must recontextualize situation *)
```

subject to the well-formedness constraint **funny(subversion | situation) >
funny(subversion) + funny(situation)** — humor must be *emergent* or the
macro is merely two captions in a trench coat.

**Remark 7.1 (Typography).** The canonical face is Impact (1965), a font
designed for British newspaper headlines that instead achieved immortality
captioning cats. Licensing realities force open implementations to stand-ins
such as Anton. We prove the substitution sound: no human under measurement
conditions has ever noticed. The outline is non-negotiable; a caption
without an outline is legally a *quote*, and by A5 the entire edifice
collapses.

**Remark 7.2 (Deep-Frying).** Let D be the deep-fry operator (saturation ↑,
JPEG quality ↓). D is *entropy injection*: it signals that a
meme has circulated so widely that its degradation is itself the message —
compression artifacts as tree rings. Fitness is non-monotonic in frying
depth: there exists an optimum (the **Maillard bound**) beyond which the
payload becomes an orange rectangle. Locating the Maillard bound is left as
an exercise for the slider.

**Remark 7.3 (Zones).** We represent text zones in fractional coordinates,
x/y/w/h ∈ [0,1] of the document. This is not merely an implementation
choice; it is a confession that the meme is *scale-free*. A meme is the
same meme at 240p in a group chat and at 4K in a deposition.

---

## 8. Empirical Methodology

Our experimental design follows field standards:

- **Sample:** n = 1 group chat (convenience sample; the other group chat
  is dry).
- **Protocol:** memes were posted; replies were counted; feelings were
  managed.
- **Significance:** we adopt p < 0.05, where p denotes the probability of
  being made admin *or* removed by one, events we could not distinguish.
- **Replication:** trivially achieved; replication is the R in the triple.
  This makes memetics the only field where the replication crisis is a
  *feature*.
- **Blinding:** double-blind review was attempted but reviewers kept
  replying "no context needed, this is about me," violating A1.

Results: statistically significant at the "trust me" level.

---

## 9. Threats to Validity

1. Theorem 4.1 implies this paper has destroyed every meme it cites.
   We regret the loss and thank them for their service.
2. The dankness preorder (Def. 2.4) may not admit a supremum; the "best
   meme" may be a proper class. Group chats are advised to stop looking.
3. All axioms were validated on internet humans. Behavior of memes among
   well-adjusted people offline is out of scope and frankly unverified.
4. A pragmatist framework implies this paper is true only if it works —
   i.e., only if you send it to someone. The authors have thus smuggled
   Criterion 6.3 into your obligations. This is called *praxis*.

## 10. Ethics Statement

No boomers were harmed in the preparation of this work; several were
confused, which the IRB ruled was their baseline. The authors declare a
conflict of interest: they operate a meme forge and stand to gain
incalculable non-monetary value (banter) from wider adoption of memes.

## 11. Conclusion

The meme is essence awaiting existence (§5), truth cashing itself out in
forwards (§6), a grammar with one production rule and one commandment
(§7), and a fragile miracle that dies when explained (§4) — which is why
this conclusion stops here, before it proves anything else.

**Availability:** an implementation of the above theory is running at the
address on the tin. The whitepaper contains no token, no roadmap, and no
airdrop. It is, in this respect alone, the most honest whitepaper of its
generation.

---

*Correspondence to: the wall. Reviews may be submitted as memes; per
Criterion 6.2, only the relatable ones are true.*
