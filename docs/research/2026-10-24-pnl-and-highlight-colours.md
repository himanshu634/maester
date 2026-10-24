# Colour for P&L, and one highlight

Researched 24 Oct 2026. The user asked for P&L in distinct colours, "such as red and green, that align with the theme", and for "a tertiary color to highlight text or specific areas when required". Today [`docs/DESIGN.md`](../DESIGN.md) §2 allows ink, paper and muted ink only, says "no semantic green or red", and shows direction by a sign, never a colour. This page is the evidence for changing that. The proposal is drawn on round 4 of the "Maester Broker Accounts" canvas (<https://claude.ai/artifact/3kUub9WRnmnm2neMpGkmNy>). Nothing in the app changes until the user approves it.

## Method

Every figure below was computed, not judged by eye. The script is `.claude/skills/design-directions/assets/kit/colour-check.mjs`.

- **Contrast:** the WCAG 2.x contrast ratio. Text from 14px to 17px needs 4.5:1 for AA.
- **Colour vision:** Machado, Oliveira and Fernandes (2009) simulation matrices at full severity, applied in linear RGB, for protanopia, deuteranopia and tritanopia.
- **Distance:** Euclidean distance in OKLab, multiplied by 100, used to compare how far apart two colours look. Treat it as a rough guide, not a threshold.

The ground colours are paper `#EDEDE8` and ink `#000000`.

## Gain and loss

| Pair | Gain on its ground | Loss on its ground | Distance, typical vision | Protanopia | Deuteranopia | Tritanopia |
| --- | --- | --- | --- | --- | --- | --- |
| Common `#2E7D32` / `#C62828`, on paper | 4.37:1, fails AA | 4.79:1 | 28.3 | 11.6 | **4.3** | 30.9 |
| Darker `#1D6B3A` / `#B3261E`, on paper | 5.56:1 | 5.57:1 | 25.6 | 8.6 | 7.1 | 29.5 |
| **Proposed `#006B55` / `#BA2C1A`, on paper** | **5.53:1** | **5.16:1** | 26.3 | 9.2 | **12.1** | 30.3 |
| Classic light `#4CC77F` / `#FF7369`, on ink | 9.78:1 | 7.91:1 | 29.2 | 14.5 | 3.5 | 33.0 |
| **Proposed `#3FC4A2` / `#FF7A4D`, on ink** | **9.63:1** | **8.14:1** | 27.4 | 14.4 | **11.1** | 32.6 |

What this shows:

1. **A common red and green fail the people they must serve.** For deuteranopia, the most common form, they come out 4.3 apart, which is close to the same muddy olive. Red–green colour blindness affects about 1 man in 12 of European descent.
2. **Leaning the green towards teal and the red towards vermilion roughly triples the gap for deuteranopia** (12.1 on paper, 11.1 on ink). It keeps both colours above 5:1 on paper, so both pass AA for the 14–17px figures in the tables.
3. **It is still not enough on its own,** so the + or − sign stays on every figure (WCAG 1.4.1: colour is never the only way information is shown). The colour repeats what the sign says.
4. **On an ink panel the pair must be lighter.** Paper text sits on ink, so the dark pair would fail there.

## One highlight

| Option | Hex | Use | Ink text on it | Against paper | Distance from loss (protan / deutan / tritan) | Distance from gain (protan / deutan / tritan) |
| --- | --- | --- | --- | --- | --- | --- |
| **G · Highlighter** | `#F9DC5C` | Fill behind ink text | 15.4:1 | 1.16:1 | 47.7 / 39.1 / 39.8 | 39.3 / 44.7 / 44.3 |
| Deeper marker | `#F2C53D` | Fill | 12.8:1 | 1.39:1 | 41.7 / 33.8 / 33.9 | 33.5 / 39.6 / 40.7 |
| H · Signal orange | `#FF5F1F` | Fill | 6.9:1 | 2.59:1 | 18.7 / 19.3 / **13.4** | **10.8** / 25.5 / 36.7 |
| J · Blue pencil | `#1F4FBF` | Text and a 3px rule | 2.9:1, fails | 6.10:1 | 25.4 / 28.4 / 29.8 | 23.4 / 22.9 / **5.1** |
| Soft blue fill | `#C9D8F7` | Fill | 14.7:1 | 1.22:1 | 49.5 / 38.8 / 43.3 | 41.0 / 41.8 / 41.4 |
| Lilac fill | `#D9CCF5` | Fill | 13.9:1 | 1.29:1 | 47.3 / 37.9 / 40.5 | 38.9 / 40.7 / 41.0 |

**Recommendation: G · Highlighter, `#F9DC5C`, as a new token `--highlight`.**

- It is what a person does to a ledger with a highlighter pen, so it fits a system built on the look of accounts.
- Ink text keeps nearly full contrast on it (15.4:1).
- It stays far from both gain and loss for every kind of colour vision.
- Its weakness is that it is faint against paper (1.16:1). So it only ever marks words that already say what they mean ("Three need a sign-in today", "Signed out at 06:00"), and it is never the only signal.

The two blue-family fills behave the same way but read as "selected" rather than "look here". H is the strongest presence, but it sits too close to loss for tritanopia and to gain for protanopia. J cannot be a fill, and blue text looks like a link in a system where links are underlined ink.

The illustration yellow (`--illus-yellow`, `#F2C53D`) is close to G, but DESIGN.md keeps illustration colours out of the interface. The highlight gets a token of its own, so the two can change separately.

## Rules that come with the colours

- `--gain` and `--loss` colour only a signed P&L figure and its %. They never colour a price, a value, a weight or a quantity.
- They are for text only. There are no green or red fills, rows, bars or borders. An unknown figure stays "—" in ink.
- `--gain-on-ink` and `--loss-on-ink` are used on inverted panels.
- `--highlight` is a fill behind ink text. It marks something that needs the investor, or a match, in words that already say so. A screen uses it a few times at most, and never as the only signal.
- **The advice rule:** the product rule that colour must not read as investment advice ([UI specification](../UI_SPECIFICATION.md), DESIGN.md §2) is narrowed. Gain and loss describe what has already happened to money invested. They never mark a share as one to buy or sell, and never colour a forecast, a rank or a mood.

## What changes on the go-ahead

- ADR 0002 gets an amendment, or a new ADR replaces its colour decision.
- DESIGN.md:
  - §2 gets the five tokens and the rules above.
  - §5 covers the holdings ledger, the strip and the Notice where the highlight applies.
  - §10's "Figures" paragraph changes, because direction may now also be a colour, after the sign.
- `apps/web/src/lib/styles/tokens.css` gets the five tokens, each with a comment saying where it is used.
- `design-guard.test.ts` allows `--gain` and `--loss` only on the P&L figure class, and `--highlight` only on `mark` and the highlight class.
- `docs/UI_SPECIFICATION.md` §3's colour rule is amended to match.
