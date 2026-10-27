# ADR 0009: Brokers are compiled-in plugins

Status: proposed 27 Oct 2026. It replaces the "brokers are data" rule from the [broker connections plan](../superpowers/plans/2026-10-19-broker-connections.md), which is written into `packages/brokers/README.md`, `packages/contracts/src/brokers.ts` and DESIGN.md §10. The design is [`docs/superpowers/specs/2026-10-27-broker-plugins-design.md`](../superpowers/specs/2026-10-27-broker-plugins-design.md).

## Context

Holdings reads each broker through one JSON definition. A generic client interprets the definition with a fixed vocabulary. The rule was "to add a broker, add a file", and its safety argument was that a definition has no way to describe an order or reach an undeclared host.

Five brokers were built this way: Zerodha, Dhan, Upstox, Groww and ICICI Direct. Every broker after the first added new words to the shared vocabulary and changed the shared interpreter:

- `settings-connection` and `direct` sign-ins;
- JSON bodies and timestamps;
- GET requests with a body;
- request signing over the body;
- a join of two calls;
- `exchangeIs`.

Adding a broker meant changing code that every other broker depends on. Angel One would add two more words: a token that comes back in the return URL, and an HTTP 200 answer that carries an error.

On 27 October 2026 the user decided:

- Keep only Zerodha (Kite) and Angel One, and build Kite first. Angel One is worked on in another session.
- Make each broker a plugin, so that adding one is as easy as possible and follows extension principles.
- Angel One will sign in through its publisher-login redirect.

## Decision

1. **A broker is a typed TypeScript plugin, compiled into the API.**
   - Each plugin is a folder in `packages/brokers/src/plugins/<id>/`.
   - A plugin has a manifest (data: name, copy, hosts, saved fields, sign-in kind), a sign-in strategy and its reads.
   - One registry line lists it.
   - Nothing is loaded at runtime, so `BROKER_DEFINITIONS_DIR` and the JSON definitions go.
2. **The host enforces the safety rules.** The format no longer makes them impossible to break, so the host does:
   - A plugin only signs in and reads; the contract has no write operation.
   - It reaches the network only through a host-locked HTTP client the host gives it: https only, the manifest's hosts only, no redirects, with a timeout.
   - It throws error codes, never the broker's text.
   - Its figures are validated as decimal strings.
   - The host alone holds credentials, tokens, encryption and the sign-in `state`.
   - A lint rule and a conformance suite that every plugin runs check all of this.
3. **Sign-in strategies are a small closed set.** Today the set has one strategy, `redirect`. A broker that uses an existing strategy changes nothing outside its folder. A new strategy is a deliberate change to the host and the web.
4. **Kite is the one plugin for now; Angel One is the next.** Dhan, Upstox, Groww and ICICI Direct are removed as Holdings brokers, with the vocabulary that only they used. Dhan stays as the Settings market-data connection. Angel One's needs were checked against the contract, and it is added later as a second plugin.

## Consequences

- **Kite-like brokers are easy to add.** A broker whose sign-in fits an existing strategy is one folder, one line and its fixtures, however odd its calls are. The shared interpreter no longer grows with each broker.
- **Adding a broker needs a build.** An operator can no longer add or replace a broker by dropping a file into a folder. That is acceptable for a personal install. A definition already had to be treated as code, because it decided where decrypted keys were sent.
- **Review now carries the "cannot trade" guarantee.** The lint rule and the conformance suite do much of that review's work.
- **Angel One will depend on its own sign-in page.** If its publisher login does not send `state` back, the host refuses the return, and Angel One stays switched off with a reason. This is the rule that kept ICICI Direct off on 24 October 2026. The facts are in [`docs/research/2026-10-27-angel-one-publisher-login.md`](../research/2026-10-27-angel-one-publisher-login.md).
- **Old accounts stay hidden.** Rows for removed brokers stay in `broker_connection`, hidden and never decrypted. There is no migration.
