# Maester

## Design

The visual contract below is loaded into every session. Read it before designing or changing anything a person sees.

@docs/DESIGN.md

- App pages (the terminal and everything behind sign-in) also follow [UI specification](docs/UI_SPECIFICATION.md) §2 (shell and navigation), §12 (component contracts), §13 (accessibility and responsive behaviour) and §14 (required states).
- Any request to design, redesign, restyle or mock up a page goes through the `design-directions` skill: mockups on a canvas first, code only after the user picks a direction.

## Financial figures

Every number an investor or an agent sees is a fact read from a filing or the result of a named calculation; nothing else. The full rules and checklists are the `financial-figures` skill, which loads for any work that reads, stores, computes or shows a figure. The short form:

- A derived number comes from a named, versioned function in `packages/financial-engine-ts` (`@maester/financial-engine`), with a fixture whose expected value was worked out independently of the function. `apps/web` formats figures and never computes one. No prompt asks a model to compute, convert, round, rank or compare figures; the model is never the decision-maker on a number.
- Decimal strings on the wire, `numeric` in Postgres, `decimal.js` or Python `Decimal` in code. Never a float for money, a quantity, a ratio or a percentage.
- What a printed line means comes from the taxonomy (`packages/contracts/concepts.json`), the mapping rules and the recorded mapping or override, never from a regex over labels in a page or a guess at read time.
- Unknown stays unknown: null with its reason, never zero, never an estimate. Every figure carries basis, currency, unit, span and period; consolidated and standalone never mix.
- Model output is data: validated against a schema, never executed, never authority for a number. A model-mapped, disputed, failed-check or unreviewed figure is shown as such.
- A change to a prompt, a mapping rule, the taxonomy, the text-layer reader, a check or a metric ships with an evaluation run (`apps/eval`) and its report under `docs/eval/`; no regression on the held-out set.

Design: [financial data layer](docs/superpowers/specs/2026-10-15-financial-data-layer-design.md), [ADR 0006](docs/decisions/0006-concepts-calculations-agent-access.md).
