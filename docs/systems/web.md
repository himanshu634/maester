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
| reading | One of the 10 daily market values on the Market mood page, for example India VIX. `READING_KEYS` in `types.ts` lists them. |
| reading key | The code name of one reading, for example `india_vix`. The path of a reading page ends with it. |
| scored reading | One of the 7 readings that the API uses to calculate the market mood. |
| market mood | A score from 0 to 100 that the API calculates from the scored readings. |
| band | One of the five names for a range of the market mood, from "Very cautious" (0 to 19) to "Very eager" (80 to 100). |
| family | One of the four groups of readings: `fear`, `money`, `breadth` and `havens`. |
| reading page | The page for one reading, at `/terminal/market-mood/<reading key>`. |
| market refresh | One run of the worker that gets new market data from Dhan and FRED. The API gives the state of the last market refresh as `fetch`. |
| market connection | The saved access data for one market data source: Dhan or FRED. The API keeps it. |
| access token | The secret that Dhan gives for a market connection. |
| API key | The secret that FRED gives for a market connection. |
| settings item | One part of a group on the Settings page. A button in its heading opens and closes it. |
| filing | A document that has a company. The API groups the filings by company. |
| read annual report | A filing that is an annual report and that Maester read. Only these filings give figures to a statement table. |
| statement table | One statement on one basis. It has a line for each printed label and a column for each financial year. The API makes it. |
| company page | The page `/terminal/research/company`. The query `id` of the address gives the company. |
| stock summary | The top part of the company page: one sentence, four figures and a chart of the closing prices of the last year. |
| figure panel | The part of the company page that tells where the selected figure came from. |
| closing price | The NSE price at the end of one day. The API reads it from the Dhan data that the worker stores. |
| design token | A CSS custom property in `tokens.css`. |
| reset token | The secret value in the emailed link for a new password. The link gives it as `token` in the address. |
| design guard | The test file `design-guard.test.ts`. |

## Function

The web app is the browser client of Maester for investors. It is a static site. The build makes all pages before deployment, and nginx serves them as files. The script in each page then calls the API through the proxy on the same origin. Thus, the session cookie is a first-party cookie.

The web app has public pages, sign-in pages, one error page and the terminal. In the terminal, four pages work with real data: Documents, Research, Market mood and Settings. Each other terminal page is a coming-soon page.

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
| Page list | `src/lib/terminal/pages.ts` | The nine terminal pages, their paths, their groups and the `soon` flag. |
| Coming-soon pages | `src/routes/terminal/*/+page.svelte`, `ComingSoon.svelte`, `components/terminal/sketches/` | Five pages that tell what each page will do. |
| Demo | `src/routes/terminal/demo/`, `src/lib/terminal/` | The overview page with the synthetic data in `fixture.ts`. |
| Documents page | `src/routes/terminal/documents/+page.svelte`, `src/lib/components/documents/` | Adds a PDF file, shows the progress and lets the investor correct the answers. |
| Documents client | `src/lib/documents/client.ts` | Typed calls to the document routes of the API. |
| Intake logic | `src/lib/documents/intake.ts` | Functions without Svelte for the Documents page: file checks, slip choice, ladder steps, error messages. |
| API types | `src/lib/documents/types.ts` | A copy of a subset of the types in `packages/contracts`. |
| Research pages | `src/routes/terminal/research/+page.svelte`, `src/routes/terminal/research/company/+page.svelte`, `src/lib/components/research/` | List the companies. Show the stock summary, the statement tables and the figure panel of one company. |
| Research client | `src/lib/research/client.ts` | Typed calls to the Research routes of the API. `pageHref` makes the link to a page of a PDF. |
| Research logic | `src/lib/research/view.ts`, `summary.ts`, `grid.ts`, `links.ts` | Functions without Svelte: words and numbers, the stock summary, the arrow-key moves and the link to a company page. |
| Research types | `src/lib/research/types.ts` | A copy of the Research types in `packages/contracts`. |
| Market mood page | `src/routes/terminal/market-mood/+page.svelte`, `src/lib/components/market-mood/` | Shows the market mood, the 10 readings, a chart of the last 12 months and the method. |
| Reading pages | `src/routes/terminal/market-mood/[key]/`, `ReadingPage.svelte` | Ten pages, one for each reading. Each page shows the value and a chart of the last 2 years. |
| Market mood client | `src/lib/market-mood/client.ts` | Typed calls to the market mood routes of the API. |
| Market mood logic | `src/lib/market-mood/view.ts`, `src/lib/market-mood/chart.ts` | Functions without Svelte: units, ranks, day words, notices and the geometry of the charts. |
| Market mood types | `src/lib/market-mood/types.ts` | A copy of the market mood types in `packages/contracts`. |
| Settings page | `src/routes/terminal/settings/+page.svelte`, `src/lib/components/settings/` | Shows the account. Lets the investor save, replace and remove the two market connections. |
| Settings client | `src/lib/settings/client.ts` | Typed calls to the market connection routes of the API. |
| Settings logic | `src/lib/settings/view.ts` | Functions without Svelte: state words, dates, field checks and save errors. |
| Settings types | `src/lib/settings/types.ts` | A copy of the market connection types in `packages/contracts`. |
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

1. `TerminalShell` reads `pagesIn('portfolio')`, `pagesIn('research')` and `pagesIn('foot')` from `pages.ts`. It shows the pages in these three groups. Market mood is in the `portfolio` group, after Holdings.
2. A page with `soon: true` shows "Soon" after its label. In `pages.ts`, `market-mood`, `research`, `documents` and `settings` have `soon: false`.
3. Under a session, the account block shows the email and a Sign out button. `endSession` calls `signOut()`.
4. If `signOut()` succeeds, the page goes to `/`. If it fails, the shell shows a failure line, and the session stays.
5. The five coming-soon routes put `ComingSoon` and one sketch in `SignedInPage`.
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
8. If the intake state is `read`, no job runs and the document has a company, the slip shows "See the figures". This link goes to the company page, with `companyHref`.

### Market mood page

1. `MarketMoodPage` starts only after `SignedInPage` finds a user.
2. On mount, `start()` calls `mood()` of `marketMoodApi` (`GET /v1/market-mood`). The page uses no workspace.
3. While the first load runs, the page shows hatch boxes and one status line. If the first load fails, the page shows a `SectionIssue` with "Try again".
4. The head shows the band, the score and `MoodRuler`. Under them, `headLine` tells how many scored readings the API used. It also names each scored reading without a score, with the reason.
5. `dayTag` shows the day of the latest Indian session. The tag says "Provisional" when an Indian scored reading is older than that session.
6. `fetchNotice` selects a `Notice` from the state of the last market refresh. After a good market refresh, no notice shows.
7. These notices have a link to `/terminal/settings`:
   - No market refresh ran yet.
   - Dhan refused the access token.
   - FRED refused the API key.
8. `byFamily` puts the readings in the four families, in the sequence of `READING_KEYS`.
9. Each `ReadingRow` shows the name, the value, the change, the rank and the source with its day. `ScoreTick` shows what the reading adds to the market mood. The name is a link to the reading page.
10. A value that the API does not have shows "—". `inMoodLine` tells why a reading is not in the market mood.
11. `MoodChart` draws the market mood of the last 12 months as an SVG image. It calculates the pixels from the width of its container. Thus, the labels stay at 14 px.
12. "Show as a table" shows the same values in a table, newest first.

### Market mood page: poll

1. After a successful read, the page reads the market mood again after `RELOAD_MS` (10 minutes). Each successful read starts a new interval.
2. When the person hides the tab, the effect cleanup stops the timer.
3. When the tab shows again, a new interval of 10 minutes starts. The page does not read the market mood immediately.
4. If a poll fails, the page keeps the old market mood on the screen. It shows no message.
5. After a failed poll, no new timer starts. The poll starts again only when the person hides the tab and shows it again.

### Reading pages

1. `[key]/+page.ts` sets `prerender = true`. Its `entries` function gives the 10 reading keys of `READING_KEYS`. Thus, the build makes one HTML file for each reading.
2. For a different reading key, `load` gives a 404 error. In the container, nginx sends `404.html` for a path without a file.
3. On mount, `ReadingPage` calls `reading()` of `marketMoodApi` (`GET /v1/market-mood/readings/<reading key>`) one time. The reading page does not poll.
4. The page shows the value, the change, the rank and what the reading measures.
5. `MoodChart` draws the values of the reading for the last 2 years. `niceDomain` sets the range of the axis to whole steps of 1, 2 or 5.
6. If the read fails, the page shows a `SectionIssue` with "Try again". The link back to the Market mood page always shows.

### Research list page

1. `ResearchPage` starts only after `SignedInPage` finds a user.
2. On mount, `start()` calls `readMe`. It uses the first workspace in the answer. If the person has no workspace, the page shows a `SectionIssue` and stops.
3. Then `start()` calls `companies()` of `researchApi` (`GET .../research/companies`). While the call runs, the page shows hatch boxes and one status line.
4. If the call fails, the page shows a `SectionIssue` with "Try again".
5. If the list is empty, the page tells how a company gets there. It has a link to the Documents page.
6. If not, the page shows a table with one line for each company, in the order of the API. The name is a link that `companyHref` makes.
7. The columns are Company, Read from, Latest year and Where it stands. `readFrom` gives the number of read annual reports in words. `fyLabel` gives the latest year, for example "2025–26".
8. `standing` gives the last column. It selects the first of these that is true:
   - `failed` is more than 0: "N filings didn’t read".
   - `reading` is more than 0: "Reading N filings".
   - `annualReportsRead` is more than 0: "Read".
   - None of these: "Nothing read yet".
9. If the container of the table is narrower than 36 rem, the columns Read from and Latest year do not show. Their words show in one line under the name.

### Research company page

1. `CompanyPage` reads `id` from the query of the address in the browser. The build makes one HTML file for the route. Thus the company travels in the query.
2. If `id` is not a UUID, the page shows "This company isn’t in your workspace." and a link to Research. It shows the same text if the person has no workspace.
3. If not, `start()` calls `financials()` and `stock()` at the same time with `Promise.allSettled`. Only the latest call of `start()` can change the page.
4. If `financials()` fails with status 404, the page shows the same not-found text. If it fails in a different way, the page shows a `SectionIssue` with "Try again".
5. If `stock()` fails, the stock summary shows a `SectionIssue` for the prices only. Its "Try again" calls `stock()` again. The statements stay on the screen.
6. The head shows the name, the NSE symbol, the BSE code, the CIN and the periods of the read annual reports, newest first.
7. `summarize` in `summary.ts` makes the stock summary. It uses no model. The sentence comes from fixed templates.
8. `summarize` uses the income statement of the company. It takes the consolidated one, or the standalone one if there is no consolidated one, or the one with an unknown basis.
9. Revenue, profit and earnings per share come from the newest column of this statement table only. A change compares the newest column with the column before it.
10. If a line has no value in the newest column, `summarize` writes nothing for that line. An older column never stands in.
11. `summarize` shows no amount for a currency other than `INR`. It also shows no amount if the scale has no value or `unitShort` cannot name it. The reason is "The statement’s unit isn’t one Maester can name."
12. If no line has a profit name, the reason for the profit is "Profit wasn’t found in the statement."
13. The price to earnings is the last closing price divided by the basic earnings per share of the newest column. If the statement table has no basic line, `summarize` uses the first per-share line.
14. If the earnings per share is zero or less, there is no price to earnings. The reason says that the company made a loss.
15. `StockSummary` shows the sentence and the four figures. A figure with no value shows "—". The reason is in the text for a screen reader or in the note.
16. `RangeRuler` shows where the last closing price is between the low and the high of the last year.
17. If the stock has a state other than `ok`, the page shows no chart. The reason is no NSE symbol, no Dhan connection (with a link to Settings), or a share that is not in the Nifty 500.
18. If the stock has more than one closing price, `MoodChart` draws the last year of closing prices. It marks the low and the high and uses a left gutter of 72 px for the rupee labels.
19. The Statements section has two groups of toggle buttons: the statement and the basis. A basis shows only if a statement table has it. A toggle clears the selected figure.
20. `StatementTable` shows the selected statement table in a region that scrolls sideways. The region starts at the newest years. The names of the lines stay in place when the region scrolls.
21. Each figure is a button with `aria-pressed`. Only one button has `tabindex="0"`. The arrow keys, Home and End call `move` in `grid.ts`.
22. A click on a figure selects it. `FigurePanel` then shows the filing and the page of the figure.
23. `onPage` tells if the text of the page has the printed figure. `addsUp` tells if the sum of the figure adds up.
24. `FigurePanel` shows "Used in" only if the selected figure is the earnings per share that the price to earnings uses.
25. If the browser is 1024 px wide or wider, the figure panel is beside the statement table. If not, a click moves the focus to the panel, and "Back to the table" moves it back to the figure.
26. "Open the PDF at page N" is a link that opens in a new tab. It goes to `pageHref`: `.../documents/<id>/file#page=N`. The API redirects to the PDF, and the browser keeps the page.
27. Under the statement table, notes tell that each year comes whole from the newest filing that prints it. They also tell how many figures have no date, and which filings the API left out.
28. A last note names the results for a quarter or a half year. These are not in the statement tables.

### Settings page

1. On mount, `start()` calls `readMe` and `list()` of `connectionsApi` at the same time. If one of them fails, the page shows a `SectionIssue` with "Try again".
2. The Account group shows the name, the email and the name of the first workspace.
3. The Connections group shows one settings item for Dhan and one settings item for FRED. `opensOnLoad` opens a settings item if its state is not `connected`.
4. Each `SettingsItem` has a button in an `h3`. The `aria-expanded` attribute gives its state. More than one settings item can be open.
5. A settings item without a good market connection shows a form. A connected settings item shows the last 4 characters of the secret and the time of the last read. For Dhan, it also shows the client ID and the expiry date.
6. On a connected settings item, "Replace" shows the form again. "Cancel" closes the form.
7. Before the request, `checkDhan` refuses an empty client ID. It also refuses an access token that has fewer than 20 characters.
8. Before the request, `checkFred` refuses an API key that is not 32 lower-case letters and digits.
9. "Save and check" sends `PUT /v1/settings/connections/dhan` or `PUT /v1/settings/connections/fred`. The secret goes only in the request body.
10. While the API checks the secret, the page disables "Save and check" and shows a `Ruler`.
11. If the API refuses, `saveFailure` selects the message. The message shows under the field or under the form. The focus moves to the field.
12. After a save, the page replaces the settings item. It moves the focus to the settings item button and tells the change in a polite status region.

### Settings page: disconnect

1. "Disconnect" opens `DisconnectDialog`, a modal `dialog` element.
2. In the dialog, "Disconnect" sends `DELETE /v1/settings/connections/<provider>`.
3. "Keep it" or the Escape key closes the dialog. The market connection stays.
4. After a removal, the page reads the list again. If that read fails, the page sets the settings item to `not_connected`.
5. The page moves the focus to the settings item button and tells the change in the status region.
6. If the `DELETE` request fails, the dialog closes and the settings item shows a failure line.

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
| Market mood does not load | `GET /v1/market-mood` fails, and no market mood is on the screen. | The page shows a `SectionIssue` with "Try again". |
| Market mood poll fails | A later `GET /v1/market-mood` fails. | The old market mood stays. The page shows no message, and the poll stops. |
| No market mood | Fewer than 5 scored readings have a score. | The head tells how many scored readings have a score, and why the others do not. `MoodRuler` shows no block. |
| No market refresh yet | `fetch.state` is `never`. | A `Notice` with a link to Settings. |
| First market refresh runs | `fetch.state` is `running`, and the API has no market points yet. | A `Notice` tells that Maester gets the first readings now. It has no link. |
| `DHAN_TOKEN_EXPIRED`, `FRED_KEY_REFUSED` | The last market refresh failed with this code. | A `Notice` tells the last day of data. It has a link to Settings. |
| `DHAN_RATE_LIMITED`, `SOURCE_UNAVAILABLE`, other codes | The last market refresh failed with a different code. | A `Notice` gives the day of the failure in India. It tells that Maester tries again within 30 minutes. |
| Companies do not load | `readMe` or `companies()` fails. | The Research list shows a `SectionIssue` with "Try again". |
| Company not found | `id` is not a UUID, the person has no workspace, or `financials()` fails with status 404. | The company page shows "This company isn’t in your workspace." |
| Statements do not load | `financials()` fails in a different way. | The company page shows a `SectionIssue` with "Try again". |
| Prices do not load | `stock()` fails. | The stock summary shows a `SectionIssue` for the prices. The figures that need a price show "—". The statements stay. |
| No price | The stock has the state `no_symbol`, `not_connected` or `not_tracked`. | The figures that need a price show "—" with the reason. There is no chart. |
| No annual report read | The company has no read annual report. | The Statements section tells this and links to the Documents page. |
| Statement not read | No statement table has the chosen statement and basis. | The section tells that Maester did not read such a statement yet. |
| Unit not named | The scale of the statement table has no value or `unitShort` cannot name it, or its currency is not `INR`. | The profit shows "—" with the reason. The sentence has no amount. |
| Loss | The basic earnings per share is zero or less. | The price to earnings shows "—". The reason says that the company made a loss. |
| Reading does not load | `GET /v1/market-mood/readings/<reading key>` fails. | The reading page shows a `SectionIssue` with "Try again". |
| Unknown reading key | The path has a reading key that is not in `READING_KEYS`. | The error page shows the `not-found` view. |
| Settings do not load | `readMe` or the list fails. The list also fails with `INVALID_STATE` when the API has no `CONNECTIONS_KEY`. | The page shows a `SectionIssue` with "Try again". The Account group does not show. |
| Market connection `expired` | Dhan refused the access token, or its expiry time is in the past. | The settings item opens. A `Notice` gives the day at which the Market mood page stops. |
| Market connection `failing` | The worker wrote `FRED_KEY_REFUSED` on the market connection. No other code gives this state. | The settings item opens. A `Notice` tells that the source did not answer and that Maester tries again every 30 minutes. |
| `DATA_PLAN_INACTIVE` | Dhan accepted the access token, but the Data API subscription is off. | A `Notice` tells the investor to turn on the subscription. |
| Field check fails | `checkDhan` or `checkFred` finds a bad value. | The message shows under the field. No request goes to the API. |
| `VALIDATION_FAILED` on save | The source refused the secret, or the access token is for a different client ID. | The message shows under the field. The API keeps nothing. |
| `RATE_LIMITED` on save | Dhan asked for fewer requests. | A message under the form tells the investor to try again in a minute. |
| Other error on save | The source did not answer, or the request failed. | A message under the form tells that the source did not answer. |
| Disconnect fails | The `DELETE` request fails. | The dialog closes. The settings item shows a failure line. |
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
| `/v1/workspaces/<id>/research/companies` | `GET` | `companies` in `research/client.ts` |
| `/v1/workspaces/<id>/companies/<id>/financials` | `GET` | `financials` in `research/client.ts` |
| `/v1/workspaces/<id>/companies/<id>/stock` | `GET` | `stock` in `research/client.ts` |
| `/v1/workspaces/<id>/documents/<id>/file` | `GET` | The link "Open the PDF at page N". The browser opens it in a new tab. |
| `/v1/market-mood` | `GET` | `mood` in `market-mood/client.ts` |
| `/v1/market-mood/readings/<reading key>` | `GET` | `reading` in `market-mood/client.ts` |
| `/v1/settings/connections` | `GET` | `list` in `settings/client.ts` |
| `/v1/settings/connections/dhan` | `PUT` | `saveDhan` |
| `/v1/settings/connections/fred` | `PUT` | `saveFred` |
| `/v1/settings/connections/<provider>` | `DELETE` | `remove` |

The Settings page also calls `readMe`. It sends the access token and the API key only in the body of a `PUT` request. It never puts them in an address or in browser storage. The API never sends a secret back, only its last 4 characters.

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

Vitest runs the 20 test files in `src` in a Node environment. The design guard is one of these files.

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

WARNING: Send the Dhan access token and the FRED API key only in the body of a `PUT` request. Never put them in an address, in browser storage or in a log. An address can go into the access log of nginx.

WARNING: Do not remove the `safeNext` check from a page that reads `next`. Without this check, a link from a different person can send the investor to a different site after sign-in.

CAUTION: When a type in `packages/contracts` changes, change its copy in the web app too. The copies are `src/lib/documents/types.ts`, `src/lib/market-mood/types.ts` and `src/lib/settings/types.ts`. The web app cannot import `@maester/contracts`, and no test compares the files.

## Limits

- Only the Documents, Research, Market mood and Settings pages use real data. Each other terminal page is a coming-soon page: overview, holdings, watchlist, analyst and activity.
- After a failed poll, the Market mood page does not poll again until the person hides the tab and shows it again. The page shows no message for a failed poll.
- The reading pages do not poll.
- The Research pages do not poll. They read the companies, the statements and the prices one time for each visit.
- The Research list reads up to 100 companies. The company page shows annual reports only.
- The line "Reviewed" in the figure panel always says "Not yet". The web app has no function to review a figure.
- If the API has no `CONNECTIONS_KEY`, the whole Settings page does not load. Thus, the message `noServerKey` of `saveFailure` cannot show.
- For a `failing` market connection, the notice tells that the source did not answer. But the only cause of this state is a refused FRED API key.
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
- [`apps/web/src/routes/terminal/research/+page.svelte`](../../apps/web/src/routes/terminal/research/+page.svelte)
- [`apps/web/src/routes/terminal/research/company/+page.svelte`](../../apps/web/src/routes/terminal/research/company/+page.svelte)
- [`apps/web/src/lib/components/research/ResearchPage.svelte`](../../apps/web/src/lib/components/research/ResearchPage.svelte)
- [`apps/web/src/lib/components/research/CompanyPage.svelte`](../../apps/web/src/lib/components/research/CompanyPage.svelte)
- [`apps/web/src/lib/components/research/StockSummary.svelte`](../../apps/web/src/lib/components/research/StockSummary.svelte)
- [`apps/web/src/lib/components/research/RangeRuler.svelte`](../../apps/web/src/lib/components/research/RangeRuler.svelte)
- [`apps/web/src/lib/components/research/StatementTable.svelte`](../../apps/web/src/lib/components/research/StatementTable.svelte)
- [`apps/web/src/lib/components/research/FigurePanel.svelte`](../../apps/web/src/lib/components/research/FigurePanel.svelte)
- [`apps/web/src/lib/research/types.ts`](../../apps/web/src/lib/research/types.ts)
- [`apps/web/src/lib/research/client.ts`](../../apps/web/src/lib/research/client.ts)
- [`apps/web/src/lib/research/view.ts`](../../apps/web/src/lib/research/view.ts)
- [`apps/web/src/lib/research/summary.ts`](../../apps/web/src/lib/research/summary.ts)
- [`apps/web/src/lib/research/grid.ts`](../../apps/web/src/lib/research/grid.ts)
- [`apps/web/src/lib/research/links.ts`](../../apps/web/src/lib/research/links.ts)
- [`apps/web/src/lib/content/research.ts`](../../apps/web/src/lib/content/research.ts)
- [`apps/web/src/routes/terminal/market-mood/+page.svelte`](../../apps/web/src/routes/terminal/market-mood/+page.svelte)
- [`apps/web/src/routes/terminal/market-mood/[key]/+page.svelte`](../../apps/web/src/routes/terminal/market-mood/%5Bkey%5D/+page.svelte)
- [`apps/web/src/routes/terminal/market-mood/[key]/+page.ts`](../../apps/web/src/routes/terminal/market-mood/%5Bkey%5D/+page.ts)
- [`apps/web/src/lib/components/market-mood/MarketMoodPage.svelte`](../../apps/web/src/lib/components/market-mood/MarketMoodPage.svelte)
- [`apps/web/src/lib/components/market-mood/ReadingPage.svelte`](../../apps/web/src/lib/components/market-mood/ReadingPage.svelte)
- [`apps/web/src/lib/components/market-mood/ReadingRow.svelte`](../../apps/web/src/lib/components/market-mood/ReadingRow.svelte)
- [`apps/web/src/lib/components/market-mood/MoodChart.svelte`](../../apps/web/src/lib/components/market-mood/MoodChart.svelte)
- [`apps/web/src/lib/components/market-mood/MoodRuler.svelte`](../../apps/web/src/lib/components/market-mood/MoodRuler.svelte)
- [`apps/web/src/lib/components/market-mood/RankRuler.svelte`](../../apps/web/src/lib/components/market-mood/RankRuler.svelte)
- [`apps/web/src/lib/components/market-mood/ScoreTick.svelte`](../../apps/web/src/lib/components/market-mood/ScoreTick.svelte)
- [`apps/web/src/lib/market-mood/types.ts`](../../apps/web/src/lib/market-mood/types.ts)
- [`apps/web/src/lib/market-mood/client.ts`](../../apps/web/src/lib/market-mood/client.ts)
- [`apps/web/src/lib/market-mood/view.ts`](../../apps/web/src/lib/market-mood/view.ts)
- [`apps/web/src/lib/market-mood/chart.ts`](../../apps/web/src/lib/market-mood/chart.ts)
- [`apps/web/src/lib/market-mood/view.test.ts`](../../apps/web/src/lib/market-mood/view.test.ts)
- [`apps/web/src/lib/content/market-mood.ts`](../../apps/web/src/lib/content/market-mood.ts)
- [`apps/web/src/routes/terminal/settings/+page.svelte`](../../apps/web/src/routes/terminal/settings/+page.svelte)
- [`apps/web/src/lib/components/settings/SettingsPage.svelte`](../../apps/web/src/lib/components/settings/SettingsPage.svelte)
- [`apps/web/src/lib/components/settings/SettingsGroup.svelte`](../../apps/web/src/lib/components/settings/SettingsGroup.svelte)
- [`apps/web/src/lib/components/settings/SettingsItem.svelte`](../../apps/web/src/lib/components/settings/SettingsItem.svelte)
- [`apps/web/src/lib/components/settings/ConnectionSection.svelte`](../../apps/web/src/lib/components/settings/ConnectionSection.svelte)
- [`apps/web/src/lib/components/settings/DisconnectDialog.svelte`](../../apps/web/src/lib/components/settings/DisconnectDialog.svelte)
- [`apps/web/src/lib/settings/types.ts`](../../apps/web/src/lib/settings/types.ts)
- [`apps/web/src/lib/settings/client.ts`](../../apps/web/src/lib/settings/client.ts)
- [`apps/web/src/lib/settings/client.test.ts`](../../apps/web/src/lib/settings/client.test.ts)
- [`apps/web/src/lib/settings/view.ts`](../../apps/web/src/lib/settings/view.ts)
- [`apps/web/src/lib/content/settings.ts`](../../apps/web/src/lib/content/settings.ts)
- [`apps/api/src/routes/market-mood.ts`](../../apps/api/src/routes/market-mood.ts)
- [`apps/api/src/routes/research.ts`](../../apps/api/src/routes/research.ts)
- [`apps/api/src/routes/connections.ts`](../../apps/api/src/routes/connections.ts)
- [`apps/worker/src/market/refresh.ts`](../../apps/worker/src/market/refresh.ts)
- [`apps/web/src/lib/errors/errors.ts`](../../apps/web/src/lib/errors/errors.ts)
- [`apps/web/src/lib/loading/loading.ts`](../../apps/web/src/lib/loading/loading.ts)
- [`apps/web/src/lib/styles/tokens.css`](../../apps/web/src/lib/styles/tokens.css)
- [`apps/web/src/lib/styles/design-guard.test.ts`](../../apps/web/src/lib/styles/design-guard.test.ts)
- [`apps/web/src/app.css`](../../apps/web/src/app.css)
- [`docs/DESIGN.md`](../DESIGN.md)
