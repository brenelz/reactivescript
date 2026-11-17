# Board probe, 2026-11-17: 3 Opus .rx desks on the AC-1g draft

Not preregistered. Three fresh board desks (`scaffold.mjs board rx --brief plain --inline-docs`). The prompt is the same
as round 15's except for two new bullets in guide/async.md ("three layers"). The compiler had the first draft of AC-1g:
a row parameter, or a local read from a source *before* the `await`. Same Solid (rc.23), grader (`grade.sh`,
`FUZZ_ROUND=--r15`) and hold probes (round 15 `trace/holds.mjs`); 3 desks ran at a time.

| desk | hidden | overlap | fuzz | defects (holds that probe clean and the after-left family excluded) |
|---|---|---|---|---|
| opus-1 | 43/45 | 23/26 | 2/20 | 4 |
| opus-2 | 43/45 | 22/26 | 1/20 | 4 |
| opus-3 | 43/45 | 20/26 | 7/20 | 9 |

The mean is 5.67, against 6.33 for round 15's six Opus board apps: no real change.

What the defects are (traced):
- **Stale or wrong-column writes disappeared from the code that AC-1g's draft could see.** No app writes a row it was
  given. Two apps (opus-1, opus-2) moved the read after the `await` instead (`let found = findCard(r.id, todo, doing,
  done)`, `let now = locate(…)`) and copied that row into the target column. When a rename of the card was accepted
  while two moves of it were out, the moves held the rename (a shared list) and the copy put the old title back:
  fuzz opus-1 seed 11, opus-2 seed 8, and "a renamed card keeps its new title when it moves" (opus-2, opus-3). The
  final AC-1g (the same commit as this folder) flags any source read in such a write, before or after the `await`.
  It rejects opus-1 and opus-2, and nothing else in the corpus.
- **A move's accepted re-ask follows `from`, the column at the click** (opus-2, opus-3: "an earlier move declined
  while a later move of the card is out", which fails its hold probe). The fix is the One store rule ("re-ask the
  answers that held the row … and add the one that holds it now"). A check can't see this.
- **A guess in a list of its own beside an answer written directly** (opus-1 "an item added while the checklist
  reloads shows once" and fuzz seed 9; opus-3 fuzz seeds 3 and 8, "(adding…)" beside its card). The new guide bullet
  ("A guess and the answer that ends it share a place") was not followed.
- **Ledger composition.** opus-3's move guess carries the title passed at the click, so a rename guess doesn't reach
  the moving card. opus-3's detail drops the column and title while its checklist reloads (fuzz seeds 7, 10, 12, 14,
  18).
- opus-1's new-card input sits under To do's loading region, so it is gone while the reopened board loads.
- opus-2 "toggles keep showing while the checklist reloads": the app keeps its own ±1 count (not fully traced).

All three agents kept guess ledgers. opus-2 guessed moves on the column answers directly (the reference's shape) but
kept ledgers for renames, toggles and item adds.
