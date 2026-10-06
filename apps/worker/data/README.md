# Worker data

## `nifty500.csv`

The Nifty 500 member list that market mood's two breadth readings are worked out from.

- **Where it comes from.** Download "Nifty 500 index constituents" by hand from
  https://www.niftyindices.com/indices/equity/broad-based-indices/nifty--500. Its terms allow
  personal use. Never fetch it from code.
- **What is read.** Only the `Symbol` column (the NSE trading symbol, such as `RELIANCE`). The
  other columns are ignored.
- **Date it.** Write the day you downloaded it below, and change it each time you replace the
  file. Breadth uses today's members for all history, so it carries survivorship bias.
- **When it is missing.** The refresher logs "nifty500.csv not found; breadth skipped" and
  stores no breadth. The other readings still refresh.

As of: not downloaded yet.
