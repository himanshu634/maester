# @maester/financial-engine (TypeScript)

The named, versioned rules that decide or derive what an investor sees, each a pure function with a fixture whose expected values were worked out by hand. Document extraction itself stays in Python (`packages/financial-engine`, served by `apps/extractor`), per [ADR 0004](../../docs/decisions/0004-python-extraction-sidecar.md).

## The source rule (`src/sources.ts`, `SOURCE_RULE_VERSION = 1`)

Which source's numbers a statement shows when a filing comes as both XBRL and PDF:

- `rankSlotCandidates` and `slotOwner`: the revision that owns a slot. XBRL before PDF, then the newer filing period (none last), then the newer revision, then the larger revision id.
- `annualSlotOf`: the annual-table slot a fact fills, or none. A results filing fills no annual column (the investor's Q4 question stays open; see the phase 4 plan). An XBRL fact fills only its year or its own period-end instant; a PDF fact fills its slot as read, comparatives included.
- `planPdfNumbers`: whether a results PDF is `read`, `skip`ped because settled XBRL covers every statement and basis it prints, or held (`wait`) for XBRL that could still turn out to be its company and period. `coveringXbrl` names the covering XBRL alone.

The fixture is `fixtures/source-rule.json`. Its Python twin, `maester_eval.source_rule` in `apps/eval`, is tested against the same file (`tests/test_eval_source_rule.py`), so a change to the rule changes both, bumps `SOURCE_RULE_VERSION` and updates the fixture by hand.

```sh
pnpm --filter @maester/financial-engine test
```
