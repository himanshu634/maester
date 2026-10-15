# Maester logo: Total

The name on a double rule, the way a final total is ruled off in a set of accounts.

The logo uses only ink `#000000` and paper `#EDEDE8`. The wordmark is the masthead's Archivo at 125% width and weight 800. It's converted to outlines, so no file needs the font installed. Archivo's licence, the SIL Open Font License, allows this.

## Files

| File | Use |
| --- | --- |
| `maester-total-lockup.svg` | The logo in ink, on a clear background |
| `maester-total-lockup-paper.svg` | The same in paper, for ink or dark backgrounds |
| `maester-total-mark.svg`, `maester-total-mark-paper.svg` | The m on its rules, for square or tight spaces |
| `maester-total-github-social-preview.png` | 1280 × 640, the repository's social preview (Settings → General → Social preview) |

## Where it is used

- **Web app.** [`Wordmark.svelte`](../../apps/web/src/lib/components/Wordmark.svelte) draws the logo inline in `currentColor`, so it is ink on paper and paper on an ink block. The masthead, the terminal rail and the index footer use it. The site-down page, [`static/50x.html`](../../apps/web/static/50x.html), carries its own copy because it loads nothing.
- **Browser and home-screen icons.** [`src/lib/assets/favicon.svg`](../../apps/web/src/lib/assets/favicon.svg), and `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `site.webmanifest` and `og-image.png` in [`apps/web/static/`](../../apps/web/static/). `og-image.png` needs an absolute address in `<meta property="og:image">`, so it is wired in once the site has a public address.
- **README.** The lockup at the top follows the reader's light or dark mode.

## Use

- **Clear space.** Leave at least the height of the lowercase letters clear on every side.
- **Smallest size.** The full logo goes down to 120 px wide on screen (24 px type) or 25 mm wide in print. Below that, use the mark, which works down to 16 px.
- **Colour.** Use ink on paper or paper on ink. The blue plate is for illustration and print only.
- **The rules.** They run the full width of the word. The first sits 0.14 of the font size below the baseline. Each rule is 0.078 of the font size thick, and the gap between them is the same.
- **Don't** recolour, outline, stretch or add effects to the logo. Don't set the name in another typeface, and don't move or resize the rules.
