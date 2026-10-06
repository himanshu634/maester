# Web app (`apps/web`): system description

This document tells how the code of the web app works. For the visual rules (color, type, components), read [the design specification](../DESIGN.md). For the API that the web app calls, read [the API description](api.md). For the full system, read [the Maester overview](maester.md).

## Terms

| Term | Meaning |
| --- | --- |
| web app | The SvelteKit project in `apps/web`. |
| static build | The HTML, script and style files that `pnpm build` writes to `apps/web/build`. |
| proxy | The server part that sends the requests for `/api/auth/`, `/v1/` and `/dev/` to the API. In the container, nginx is the proxy. In development, Vite is the proxy. |
| session | The sign-in record that the API keeps. The browser keeps it as an `HttpOnly` cookie. A script cannot read this cookie. |
| auth client | The one client object of Better Auth. `authClient()` makes it in the browser. |
| terminal | The part of the web app under `/terminal`. |
| signed-in page | A terminal page that shows its content only to a person with a session. Each signed-in page uses `SignedInPage`. |
| coming-soon page | A signed-in page that tells what it will do. It has no other function yet. |
| demo | The two pages `/terminal/demo` and `/terminal/demo/quiet`. They show a synthetic portfolio. They use no session and no API. |
| workspace | A group of documents and companies in the API. The web app uses the first workspace that `/v1/me` returns. |
| document | A file that an investor adds on the Documents page. The API keeps one record for each document. |
| answers | What Maester found about a document: the kind, the company, the period and the statements. The API calls this the classification. |
| slip | The part of the Documents page that shows one document. |
| Earlier list | The part of the Documents page that shows the other documents of the workspace. |
| live document | A document that the API still works on. The function `isLive` decides this. |
| poll | A timed request that the web app sends again and again to read the latest state. |
| design token | A CSS custom property in `tokens.css`. |
| reset token | The secret value in the emailed link for a new password. The link gives it as `token` in the address. |
| design guard | The test file `design-guard.test.ts`. |

## Function

The web app is the browser client of Maester for investors. It is a static site. The build makes all pages before deployment, and nginx serves them as files. The script in each page then calls the API through the proxy on the same origin. Thus, the session cookie is a first-party cookie.

The web app has public pages, sign-in pages, one error page and the terminal. In the terminal, only the Documents page works with real data. Each other terminal page is a coming-soon page.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| Index page | `src/routes/+page.svelte`, `src/lib/components/` | Tells what Maester does. The copy is in `src/lib/content/index.ts`. |
| Sign-in pages | `src/routes/login`, `signup`, `verify-email`, `forgot-password`, `reset-password` | Sign in, create an account, confirm an email and set a new password. |
| Auth client | `src/lib/auth/client.ts` | Makes the auth client with `baseURL` set to the origin of the page. |
| Auth messages and checks | `src/lib/auth/messages.ts`, `src/lib/auth/validate.ts` | Change an error code from Better Auth into a message. Check the form fields. |
| Session functions | `src/lib/session.ts` | `readSession`, `endSession`, `safeNext` and `verifyCallback`. |
| Signed-in guard | `src/lib/components/terminal/SignedInPage.svelte` | Checks the session. Shows the terminal shell or sends the person to `/login`. |
| Terminal shell | `src/lib/components/terminal/TerminalShell.svelte` | The rail, the menu for small screens, the context header and the account block. |
| Page list | `src/lib/terminal/pages.ts` | The eight terminal pages, their paths, their groups and the `soon` flag. |
| Coming-soon pages | `src/routes/terminal/*/+page.svelte`, `ComingSoon.svelte`, `components/terminal/sketches/` | Seven pages that tell what each page will do. |
| Demo | `src/routes/terminal/demo/`, `src/lib/terminal/` | The overview page with the synthetic data in `fixture.ts`. |
| Documents page | `src/routes/terminal/documents/+page.svelte`, `src/lib/components/documents/` | Adds a PDF file, shows the progress and lets the investor correct the answers. |
| Documents client | `src/lib/documents/client.ts` | Typed calls to the document routes of the API. |
| Intake logic | `src/lib/documents/intake.ts` | Functions without Svelte for the Documents page: file checks, slip choice, ladder steps, error messages. |
| API types | `src/lib/documents/types.ts` | A copy of a subset of the types in `packages/contracts`. |
| Error page | `src/routes/+error.svelte`, `src/lib/errors/errors.ts` | One page for all errors. `errorView` selects the view. |
| Loader and hatch | `src/lib/loading/`, `src/lib/components/loading/` | The wait indicators and the one clock that moves them. |
| Copy | `src/lib/content/` | All text that a person reads on the pages. |
| Design tokens | `src/lib/styles/tokens.css`, `src/app.css` | The only colors, fonts and sizes. `app.css` also stops motion for reduced motion. |
| Design guard | `src/lib/styles/design-guard.test.ts` | A test that fails when the CSS breaks the rules of `docs/DESIGN.md`. |
| Build settings | `vite.config.ts`, `src/routes/+layout.ts` | The static adapter, the development proxy and the test settings. |
| Container | `Dockerfile`, `nginx.conf.template`, `static/50x.html` | Builds the site and serves it with nginx. |

## Operation

### Build and serve

1. `src/routes/+layout.ts` sets `prerender = true`, `ssr = true` and `trailingSlash = 'never'`. Thus, the build makes an HTML file for each route.
2. `vite.config.ts` uses `adapter-static` with `strict: true` and `fallback: '404.html'`. The fallback file is the app shell without page content.
3. The `Dockerfile` runs `pnpm build` in a `node:22-slim` stage. Then it copies `build/` into an `nginx:1.27-alpine` image.
4. The `Dockerfile` makes the nginx configuration from `nginx.conf.template` with `envsubst`. Then it runs `nginx -t`. A bad configuration stops the image build.
5. nginx listens on port 8080. For a request to `/api/auth/`, `/v1/` or `/dev/`, nginx sends the request to `API_PROXY_TARGET`.
6. For all other paths, nginx tries the file, then the file with `.html`, then `index.html` in the directory.
7. If no file agrees with the path, nginx sends `404.html`. The script in that page then shows `+error.svelte`.
8. If nginx itself gives a 5xx answer for a page path, it sends `static/50x.html`. This page has no script and no font download.

### Session check

1. The session cookie is `HttpOnly`. Thus, `readSession` asks the API with `getSession()` of the auth client.
2. If the answer has no user, `readSession` returns `signed-out`. If the request fails, it also returns `signed-out`.
3. Each signed-in page puts its content in `SignedInPage`. On mount, `SignedInPage` calls `readSession`.
4. While the check runs, `SignedInPage` shows the masthead, the page title and a `Loader`.
5. If the person has a session, `SignedInPage` shows `TerminalShell` with the page content.
6. If the person has no session, `SignedInPage` goes to `/login?next=<path>`. It replaces the current history entry.
7. `SignedInPage` keeps the last known user in a module variable. Thus, the shell stays on the screen when the person moves to a different terminal page. Each page checks the session again.
8. A counter in `checkSession` makes sure that only the latest check changes the page.

### Sign-in

1. All sign-in pages read the address values (`next`, `error`, `token`, `email`) in `onMount`, because the build makes the pages before any request.
2. `safeNext` accepts only a relative path on the same site. It refuses a value that starts with `//` or `/\`, or that has control characters. The default is `/terminal`.
3. `/login` calls `signIn.email` or `signIn.social` with `provider: 'google'`. After an email sign-in, the page goes to the `next` path.
4. `/signup` calls `signUp.email` or `signIn.social`. After an email sign-up, the page always goes to `/verify-email`.
5. The emailed links come back to `/verify-email?next=<path>`. `verifyCallback` makes this address.
6. `/forgot-password` calls `requestPasswordReset` with `redirectTo: '/reset-password'`. It shows the same message for an account that exists and for one that does not exist.
7. `/reset-password` reads `token` from the address. Then it removes `token` and `error` from the address bar. Then it calls `resetPassword`. After success, it goes to `/login?reset=done`.
8. `messageFor` in `messages.ts` changes the error code from Better Auth into a message. For status 429, it gives the message for too many requests first.
9. `validate.ts` checks the fields before the request. A new password must have 8 to 128 characters. On `/login`, the page checks only that the password is not empty.

### Terminal shell and pages

1. `TerminalShell` reads `pagesIn('portfolio')`, `pagesIn('research')` and `pagesIn('foot')` from `pages.ts`. It shows the pages in these three groups.
2. A page with `soon: true` shows "Soon" after its label. In `pages.ts`, only `documents` has `soon: false`.
3. Under a session, the account block shows the email and a Sign out button. `endSession` calls `signOut()`.
4. If `signOut()` succeeds, the page goes to `/`. If it fails, the shell shows a failure line, and the session stays.
5. The seven coming-soon routes put `ComingSoon` and one sketch in `SignedInPage`.
6. The demo routes do not use `SignedInPage`. They show `Overview` with `demo` or `quietDemo` from `fixture.ts`.
7. In the demo, the code disables the three write buttons. Each button points to the read-only note with `aria-describedby`.
8. `dueItems` in `due.ts` puts the due items in this order: review, position limit, price that Maester does not know. In each kind, the larger portfolio weight comes first.

### Documents page: first load

1. `DocumentsPage` starts only after `SignedInPage` finds a user.
2. On mount, `start()` calls `readMe` (`GET /v1/me`). It uses the first workspace in the answer.
3. If the person has no workspace, the page shows a `SectionIssue` and stops.
4. Then `start()` calls `listDocuments` and `listCompanies` at the same time. `listDocuments` reads the first 25 documents. `listCompanies` reads the first 100 companies.
5. `pickSlip` selects the document for the slip. The order of choice is:
   - The document that the investor opened, if the page has it.
   - The newest document that Maester did not read, keep or reject.
   - The newest document.
6. If the slip document has answers, `start()` calls `getClassification` for it.
7. While the first load runs, the page shows hatch boxes and one status line. If the load fails, it shows a `SectionIssue` with "Try again".

### Documents page: upload

1. `checkFile` refuses a file that does not end in `.pdf`. It also refuses a type that is not `application/pdf` or empty.
2. `checkFile` refuses a file larger than `MAX_UPLOAD_BYTES` (52,428,800 bytes).
3. The page accepts one file at a time. While an upload runs, the page disables `DropStrip`.
4. `upload` sends `POST .../documents/uploads` with the name and the size. The API returns a document record and an upload target.
5. The page then shows the new document in the slip and moves the focus to the slip heading.
6. `upload` sends the file bytes with `PUT` to the URL of the upload target. It removes the `Content-Length` header from the given headers.
7. `upload` sends `POST .../documents/<id>/finalize`. The API then starts its checks.
8. While the upload runs, the page asks the browser to confirm before the tab closes or reloads (`beforeunload`).

### Documents page: polls

1. While the slip document is live, the page reads it again with `getDocument`. The interval is `POLL_MS` (2 seconds).
2. While the Earlier list has a live document other than the slip document, the page reads the list again. The interval is `LIST_POLL_MS` (5 seconds).
3. Each failed poll makes the next interval longer. The interval is the base interval multiplied by the number of failures plus one. The maximum multiplier is 5.
4. A successful poll sets the count of failures back to zero.
5. When the person hides the tab, both polls stop. The `visibilitychange` event starts them again.
6. When the person leaves the page, the effect cleanup stops both timers.
7. When the slip document changes from live to not live, the page reads the list one more time.
8. The page keeps a write counter for each document. A list poll does not replace a document that the page changed after the poll started.

### Documents page: answers

1. If the API needs the company, the slip shows `CompanyForm`. `companyCandidates` lists the workspace companies that agree with the printed identifiers.
2. `companyCandidates` compares the CIN first, then the exchange code, then the normalized name.
3. If the API needs the kind of document, the slip shows `KindForm`.
4. The "Change" action opens the same forms for an answer that the investor wants to correct.
5. Each form calls `changeClassification` with `basedOn` set to the ID of the current answers.
6. If the API returns `CONFLICT` for `basedOn`, the slip shows the latest answers and a message. It then reads the slip again with `reloadSlip`.
7. "Try again" on a failed step calls `classify` or `extract`. Then the page reads the document again.

### Error page

1. `+error.svelte` calls `errorView` with the status, the path and the connection state.
2. `errorView` returns one of these views:
   - `offline`, when the browser has no connection.
   - `terminal-not-found`, for 404 under `/terminal/demo`.
   - `not-found`, for all other 404 answers.
   - `signed-out` for 401, and `no-access` for 403.
   - `failed`, for all other statuses.
3. Under `/terminal/demo`, the error page uses the demo shell. It never uses the signed-in shell, because it does not read the session.
4. After the page shows the offline view, it keeps that view. When the browser sends the `online` event, `checkConnection` sends `HEAD` for `/robots.txt` with `cache: 'no-store'`.
5. If that request succeeds, the page reloads. If it fails, the page shows the time of the check.

### Loader and hatch

1. `watchPhase` shows the wait indicator after 300 ms. After 10 seconds, it adds a line that tells the person that the wait is long.
2. `createClock` makes one interval of 120 ms for all rulers and hatch boxes on the page.
3. If the person selects reduced motion, the clock does not start. If the person hides the tab, the clock does not move the step.

### Design guard

1. `design-guard.test.ts` reads each `.svelte` and `.css` file in `src`.
2. Outside `tokens.css`, it fails a color literal: hex, color functions or color names.
3. It also fails a radius that is not zero, a shadow, a font outside the design tokens, `transition: all` and motion longer than 300 ms.
4. It fails if a file other than `GoogleButton.svelte` uses the `--brand-google-` design tokens.
5. It fails if `app.css` has no reduced-motion rule for transitions and animations.
6. The design guard ignores a line with `design-guard: allow`.

## States and errors

| State or error | Cause | Result |
| --- | --- | --- |
| Session check runs | `SignedInPage` waits for `readSession`. | The masthead and a `Loader` show. After 10 seconds, "Try again" shows. |
| No session | `getSession()` returns no user, or the request fails. | The page goes to `/login?next=<path>`. |
| Sign-out fails | `signOut()` returns an error or the request fails. | The shell shows a failure line. The session stays. |
| No workspace | `/v1/me` returns no workspace. | The Documents page shows a `SectionIssue`. |
| First load fails | A request in `start()` fails. | The Documents page shows a `SectionIssue` with "Try again". |
| File refused | `checkFile` finds a file that is not a PDF or that is too large. | A `Notice` tells what is wrong. No request goes to the API. |
| `UPLOAD_TOO_LARGE` | The API refuses the size. | The same message as the size check in the browser. |
| `UNAUTHENTICATED` on upload | The session ended. | A `Notice` with a link to sign in again. |
| `NETWORK` | The `fetch` call failed before an answer. | `ApiError` with status 0. On upload, the page shows the offline message. |
| Poll fails | `getDocument` or `listDocuments` fails. | The page shows no message. The next interval is longer. |
| `CONFLICT` for `basedOn` | The answers changed after the form opened. | The slip shows the latest answers and a message. |
| `CONFLICT` for `company.new` | A company with the same identifiers exists. | The form shows a clash message. The page reads the companies again. |
| `identify_failed`, `read_failed` | A job of the API failed. | The ladder shows "Stopped". The slip shows "Try again". |
| `needs_company`, `needs_kind`, `duplicate` | The API needs a decision from the investor. | The ladder shows "Needs you". The slip shows a `Notice`. |
| Answers do not load | `getClassification` fails. | The slip shows a `SectionIssue` with "Try again". |
| Offline | The browser sends the `offline` event. | The error page shows the offline view. The terminal shell shows `OfflineBanner`. |
| nginx 5xx | nginx cannot answer for a page path. | nginx sends `50x.html`. |

## Data

The web app reads and writes no database and no file. It keeps no data in `localStorage` or `sessionStorage`. All data comes from the API through the proxy.

The web app calls these API paths:

| Path | Method | Caller |
| --- | --- | --- |
| `/api/auth/*` | Better Auth | The auth client: session, sign-in, sign-up, sign-out, email confirmation, password reset. |
| `/v1/me` | `GET` | `readMe` |
| `/v1/workspaces/<id>/documents?limit=25` | `GET` | `listDocuments` |
| `/v1/workspaces/<id>/documents/<id>` | `GET` | `getDocument` |
| `/v1/workspaces/<id>/documents/uploads` | `POST` | `upload` |
| The URL of the upload target | `PUT` | `upload`. In local development, this URL is under `/dev/`. |
| `/v1/workspaces/<id>/documents/<id>/finalize` | `POST` | `upload` |
| `/v1/workspaces/<id>/documents/<id>/classification` | `GET`, `POST` | `getClassification`, `changeClassification` |
| `/v1/workspaces/<id>/documents/<id>/classify` | `POST` | `classify` |
| `/v1/workspaces/<id>/documents/<id>/extract` | `POST` | `extract` |
| `/v1/workspaces/<id>/companies?limit=100` | `GET` | `listCompanies` |
| `/v1/workspaces/<id>/companies/<id>` | `GET` | `getCompany` |

The web app reads these environment variables:

| Variable | Read by | Function |
| --- | --- | --- |
| `API_PROXY_TARGET` | `vite.config.ts`, `nginx.conf.template` | The address of the API. The default is `http://localhost:8787`. |
| `API_PROXY_HOST` | `nginx.conf.template` | The `Host` header for requests to the API. |
| `NGINX_RESOLVER` | `nginx.conf.template` | The DNS server for nginx. |
| `BASE_PATH` | `vite.config.ts` | A path prefix, only for a host that serves the site under a sub-path. The default is empty. |

## Procedures

Do these procedures in `apps/web`. The web app is a separate pnpm project with its own lockfile. It is not a member of the root workspace.

### To install the dependencies

1. Use the Node 22 version that `.nvmrc` shows.
2. Run this command:

   ```bash
   pnpm install --frozen-lockfile
   ```

### To run all the checks

1. Run this command:

   ```bash
   pnpm verify
   ```

2. Make sure that the command shows no errors.

`pnpm verify` runs `pnpm check`, `pnpm lint`, `pnpm test` and `pnpm build` in this sequence. `pnpm check` runs `svelte-check` with `--fail-on-warnings`. `pnpm lint` runs Prettier and ESLint.

### To run the tests

1. Run this command:

   ```bash
   pnpm test
   ```

2. Read the result.

Vitest runs the 15 test files in `src` in a Node environment. The design guard is one of these files.

### To run the web app in development

1. Start the API on port 8787.

   [The API description](api.md) tells how to start the API.
2. Run this command:

   ```bash
   pnpm dev
   ```

3. Open `http://localhost:5173` in the browser.
4. Do not open the API port, because the session cookie must come from the web origin.

### To build the container image

1. Go to the root of the repository.
2. Run this command:

   ```bash
   docker build -f apps/web/Dockerfile -t maester/web:local .
   ```

3. Set `API_PROXY_TARGET`, `API_PROXY_HOST` and `NGINX_RESOLVER` when you start the container.

The defaults of these variables in the image are local placeholders.

## Warnings and cautions

WARNING: Keep the access logs of the web server private. The first request for `/reset-password` puts the reset token in the address, and nginx can write that address to its log.

WARNING: Do not remove the `safeNext` check from a page that reads `next`. Without this check, a link from a different person can send the investor to a different site after sign-in.

CAUTION: When a type in `packages/contracts` changes, change `src/lib/documents/types.ts` too. The web app cannot import `@maester/contracts`, and no test compares the two files.

## Limits

- Only the Documents page uses real data. Each of these pages is a coming-soon page: overview, holdings, research, watchlist, analyst, activity and settings.
- The web app uses only the first workspace of the person.
- The Earlier list reads only the first 25 documents. The company form offers only the first 100 companies.
- The Documents page uses polls. The web client does not use Server-Sent Events, but `nginx.conf.template` has settings for them.
- A failed poll shows no message. If the session ends while the Documents page is open, the polls fail and the page does not ask the person to sign in.
- The static site returns no 401 or 403 status. Thus, the `signed-out` and `no-access` views do not show yet.
- There are no tests for the Svelte components. The tests cover only the TypeScript modules in `src/lib`.
- Sign-in needs script in the browser. `/login` and `/signup` tell this in a `<noscript>` note.

## Sources

- [`apps/web/package.json`](../../apps/web/package.json)
- [`apps/web/README.md`](../../apps/web/README.md)
- [`apps/web/.nvmrc`](../../apps/web/.nvmrc)
- [`docker-compose.yml`](../../docker-compose.yml)
- [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts)
- [`apps/web/Dockerfile`](../../apps/web/Dockerfile)
- [`apps/web/nginx.conf.template`](../../apps/web/nginx.conf.template)
- [`apps/web/static/50x.html`](../../apps/web/static/50x.html)
- [`apps/web/src/routes/+layout.ts`](../../apps/web/src/routes/+layout.ts)
- [`apps/web/src/routes/+error.svelte`](../../apps/web/src/routes/+error.svelte)
- [`apps/web/src/routes/login/+page.svelte`](../../apps/web/src/routes/login/+page.svelte)
- [`apps/web/src/routes/signup/+page.svelte`](../../apps/web/src/routes/signup/+page.svelte)
- [`apps/web/src/routes/forgot-password/+page.svelte`](../../apps/web/src/routes/forgot-password/+page.svelte)
- [`apps/web/src/routes/reset-password/+page.svelte`](../../apps/web/src/routes/reset-password/+page.svelte)
- [`apps/web/src/routes/verify-email/+page.svelte`](../../apps/web/src/routes/verify-email/+page.svelte)
- [`apps/web/src/routes/terminal/documents/+page.svelte`](../../apps/web/src/routes/terminal/documents/+page.svelte)
- [`apps/web/src/routes/terminal/demo/+page.svelte`](../../apps/web/src/routes/terminal/demo/+page.svelte)
- [`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts)
- [`apps/web/src/lib/auth/client.ts`](../../apps/web/src/lib/auth/client.ts)
- [`apps/web/src/lib/auth/messages.ts`](../../apps/web/src/lib/auth/messages.ts)
- [`apps/web/src/lib/auth/validate.ts`](../../apps/web/src/lib/auth/validate.ts)
- [`apps/web/src/lib/components/terminal/SignedInPage.svelte`](../../apps/web/src/lib/components/terminal/SignedInPage.svelte)
- [`apps/web/src/lib/components/terminal/TerminalShell.svelte`](../../apps/web/src/lib/components/terminal/TerminalShell.svelte)
- [`apps/web/src/lib/terminal/pages.ts`](../../apps/web/src/lib/terminal/pages.ts)
- [`apps/web/src/lib/components/terminal/ComingSoon.svelte`](../../apps/web/src/lib/components/terminal/ComingSoon.svelte)
- [`apps/web/src/lib/components/terminal/Overview.svelte`](../../apps/web/src/lib/components/terminal/Overview.svelte)
- [`apps/web/src/lib/terminal/due.ts`](../../apps/web/src/lib/terminal/due.ts)
- [`apps/web/src/lib/terminal/fixture.ts`](../../apps/web/src/lib/terminal/fixture.ts)
- [`apps/web/src/lib/components/documents/DocumentsPage.svelte`](../../apps/web/src/lib/components/documents/DocumentsPage.svelte)
- [`apps/web/src/lib/components/documents/DropStrip.svelte`](../../apps/web/src/lib/components/documents/DropStrip.svelte)
- [`apps/web/src/lib/components/documents/Slip.svelte`](../../apps/web/src/lib/components/documents/Slip.svelte)
- [`apps/web/src/lib/documents/client.ts`](../../apps/web/src/lib/documents/client.ts)
- [`apps/web/src/lib/documents/intake.ts`](../../apps/web/src/lib/documents/intake.ts)
- [`apps/web/src/lib/documents/types.ts`](../../apps/web/src/lib/documents/types.ts)
- [`apps/web/src/lib/errors/errors.ts`](../../apps/web/src/lib/errors/errors.ts)
- [`apps/web/src/lib/loading/loading.ts`](../../apps/web/src/lib/loading/loading.ts)
- [`apps/web/src/lib/styles/tokens.css`](../../apps/web/src/lib/styles/tokens.css)
- [`apps/web/src/lib/styles/design-guard.test.ts`](../../apps/web/src/lib/styles/design-guard.test.ts)
- [`apps/web/src/app.css`](../../apps/web/src/app.css)
- [`docs/DESIGN.md`](../DESIGN.md)
