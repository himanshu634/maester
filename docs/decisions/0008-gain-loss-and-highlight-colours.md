# ADR 0008: Gain, loss and one highlight colour

Status: accepted 24 Oct 2026. Amends the colour decision in [ADR 0002](0002-web-sveltekit-brutalist-design-system.md).

## Context

ADR 0002 limits the interface to ink, paper and muted ink. Direction is shown with a sign or a word, never a colour, partly so that colour never reads as investment advice.

On 24 Oct 2026, reviewing Holdings, the user asked: "I think the PNL should use distinct colors, such as red and green, that align with the theme. We also need a tertiary color to highlight text or specific areas when required."

The research is [`docs/research/2026-10-24-pnl-and-highlight-colours.md`](../research/2026-10-24-pnl-and-highlight-colours.md), and the options are drawn on round 4 of the "Maester Broker Accounts" canvas. It checks each candidate in two ways:

- WCAG contrast;
- a colour-vision simulation (Machado et al. 2009).

The research found that a common red and green, `#2E7D32` and `#C62828`, nearly merge for deuteranopia: they are 4.3 apart in OKLab ×100.

## Decision

Five tokens join `tokens.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--gain` | `#006B55` | Text of a signed P&L figure and its % that is above zero. 5.53:1 on paper. |
| `--loss` | `#BA2C1A` | The same, below zero. 5.16:1 on paper. |
| `--gain-on-ink` | `#3FC4A2` | `--gain` on an ink panel. 9.63:1 on ink. |
| `--loss-on-ink` | `#FF7A4D` | `--loss` on an ink panel. 8.14:1 on ink. |
| `--highlight` | `#F9DC5C` | A highlighter fill behind ink text. Ink on it is 15.4:1. |

The green leans teal and the red leans vermilion. That keeps them 12.1 apart under deuteranopia, with both passing AA as text.

The rules that come with the tokens:

- **Gain and loss** colour only a signed P&L figure and its %. They never colour a price, a value, a weight, a quantity, a forecast, a rank or a mood. They are text only: no fills, rows, bars or borders. The + or − sign stays, and the colour repeats it.
- **The highlight** marks words that already say what needs the investor. It is never the only signal, and a screen uses it a few times at most.
- **Where they are used:** Holdings only for now. The design guard names the components that may use them (`HoldingsLedger`, `HoldingsByBroker` and `HoldingsStrip` for gain and loss; `HoldingsNudge` for the highlight). Using them on another page means updating DESIGN.md and the guard together.

The advice rule is narrowed rather than dropped. Gain and loss describe what has already happened to money invested; they never mark a share as one to buy or to sell.

## Consequences

- The interface has two signal colours and a highlight, and each is named for its one job.
- The illustration inks (`--illus-*`) stay apart: the highlight is a token of its own, even though it is close to `--illus-yellow`.
- Colour-blind readers still read direction from the sign. The colour is a second cue, never the first.
