# Maester for macOS: design

Status: approved for planning, 13 October 2026.

## Goal

A Mac app, `Maester.app`, puts Maester in the menu bar and in macOS's own notifications, for the one person who uses it. It gives four things the browser cannot:

1. **Menu-bar mood.** The menu bar shows today's market mood in words ("Cautious 29"). A click opens a menu with Maester's pages.
2. **Notifications.** macOS tells the investor when a document is read, needs them or stopped, when a market data connection is about to expire, has expired or is failing, and when the mood moves to another band.
3. **PDFs from Finder.** A filing dropped on the Dock icon or on the menu-bar item goes to Documents through the page's own drop strip.
4. **Runs at login.** The app starts with the Mac, makes sure Maester's services are up, and keeps them up, so fetches and readings happen without a browser tab.

The window shows the same web pages as the browser. The app adds no page of its own except `/desktop/signed-in` (see Sign-in).

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Purpose | Native features: menu bar, notifications, Finder drop, start at login | Chosen by the user |
| Where the services run | Today's Docker Compose stack on this Mac | Chosen by the user; the least new work. Docker Desktop must be installed |
| Shell | Electron, TypeScript, in a new `apps/desktop` | Same language as the API and worker. Tray, notifications, login items, Dock drops and URL schemes are built in. The background process can share the window's session (`net.fetch` with `credentials: "include"`). Size (~200 MB) does not matter for one user |
| Rejected | Tauri (Rust; the background process cannot easily share the web view's cookies) and Swift/SwiftUI (new language and toolchain; no reuse of `packages/contracts`) | |
| What the window loads | `http://localhost:5173`, the nginx origin of the web container | Cookies, the `/api/auth` and `/v1` proxy and every page keep working unchanged |
| Google sign-in | Through the default browser, handed back with a one-time token and a `maester://` link | Google refuses OAuth in an embedded browser ("This browser or app may not be secure"). The user signs in with Google |
| Distribution | Built on this Mac, ad-hoc signed, not notarised, copied to /Applications | Personal use only. No Apple Developer account needed |

## Shape

```
Maester.app (Electron)
  main process        menu-bar item, menu, notifications, stack check, login item,
                      maester:// links, Dock and tray drops, background checks
  preload             window.maesterDesktop: the only bridge between pages and the app
  window              http://localhost:5173/… (the web container, unchanged)
        │
        ▼
docker compose stack in the Maester folder: web (nginx) → api → worker → extractor, postgres
```

- `apps/desktop` joins the pnpm workspace beside `apps/api` and `apps/worker`, so it can import `@maester/contracts` for typed API responses.
- The main and preload code are bundled with tsup, as the API and worker are, so the packaged app carries no `node_modules`. electron-builder makes `Maester.app`.
- pnpm scripts, no Make targets: `pnpm --filter @maester/desktop dev` runs the app against the running stack; `pnpm --filter @maester/desktop build` makes `apps/desktop/dist/mac-arm64/Maester.app`.
- The app's own logic lives in plain TypeScript modules under `apps/desktop/src/lib/` with no Electron import, so vitest can test it. The Electron wiring around it stays thin.

### The bridge

The preload script exposes `window.maesterDesktop` with a small, fixed surface:

| Member | Direction | Use |
| --- | --- | --- |
| `signInWithGoogle()` | page → app | The Google button asks the app to start the hand-off |
| `onSignInToken(cb)` | app → page | The app passes a one-time token to the page to verify |
| `onFile(cb)` | app → page | The app hands the Documents page a dropped PDF |
| `fileAccepted()` | page → app | The Documents page says it took the file, so the app may hand over the next |

Pages check for `window.maesterDesktop` and behave as they do in a browser when it is absent. The window has `contextIsolation` on, `nodeIntegration` off and the sandbox on. It may only navigate within `http://localhost:5173`; any other address opens in the default browser.

## Sign-in

Email and password sign-in works in the window as it does in the browser. Google goes through the default browser:

1. In the window, "Continue with Google" sees `window.maesterDesktop` and calls `signInWithGoogle()` instead of redirecting the window to Google.
2. The app makes a random `state` (32 bytes, base64url), remembers it for 5 minutes, and opens `http://localhost:5173/desktop/signed-in?state=<state>` in the default browser.
3. `/desktop/signed-in` is a signed-in page (`SignedInPage`). Signed out, it sends the browser to `/login?next=` itself, so the user signs in with Google there as usual and comes back.
4. Signed in, the page asks the API for a one-time token (`/api/auth/one-time-token/generate`) and sends the browser to `maester://signed-in?token=<token>&state=<state>`. The browser may ask "Open Maester?" first. The page says "You're signed in. Maester is opening." and has an "Open Maester" button with the same link, in case the browser did not follow it. It uses `AuthLayout`; a failure to get a token shows a `Notice` with "Try again".
5. The app receives the link (`open-url`). It accepts it only when `state` matches a hand-off it started in the last 5 minutes, and then forgets that `state`. Any other `maester://signed-in` link is ignored, so a page elsewhere cannot sign the app in to another account.
6. The app shows the window and passes the token to the page through `onSignInToken`. The page posts it to `/api/auth/one-time-token/verify` from the window, same origin, so the session cookie lands in the window's cookie jar. The window then goes to `/terminal`.

### Changes outside the app

- **API**: add Better Auth's `oneTimeToken` plugin (in `better-auth` 1.7.3) to `createAuth`, with `storeToken: "hashed"` and the default 3-minute expiry. A token is single-use.
- **Web**: the `/desktop/signed-in` route; the bridge check in `GoogleButton`; the token listener in the root layout, which runs only when the bridge exists. The route is `noindex`. Its copy lives in `lib/content/`.

## The stack

- **First run.** The app asks for the Maester folder (the repository, holding `docker-compose.yml`) with a folder picker, checks that the file is there, and remembers the path in the app's settings file.
- **At launch, and from the menu.** The app checks `http://localhost:5173/` and `http://localhost:8787/healthz`. Both answer: running. Otherwise:
  1. `docker info`. If Docker is not running, `open -a Docker`, then check every 3 s for up to 2 minutes.
  2. `docker compose up -d` in the Maester folder. Compose builds images that do not exist yet, so the first start can take several minutes.
  3. Check the two addresses every 3 s for up to 5 minutes.
- **States**, shown as the menu's first line: "Maester is running", "Starting Maester…", "Docker isn't running" (with "Open Docker"), "Maester didn't start" (with "Show the log", the last 200 lines of `docker compose logs`), "Choose the Maester folder".
- **While running**, the app checks every 60 s and shows a state change in the menu. It does not restart services on its own after the first start; "Start Maester" in the menu does.
- **Quitting the app leaves the services running**, so the worker keeps fetching. "Stop Maester's services" runs `docker compose stop`.
- **Login item.** On first run the app turns on "Start at login" (`app.setLoginItemSettings`). At login it opens with no window, only the menu-bar item. The menu has a "Start at login" checkbox.

## Menu bar

The title is text, never colour:

| Situation | Title |
| --- | --- |
| A mood with 5 or more scored readings | the band and score, e.g. "Cautious 29" |
| Signed in, but fewer than 5 scored readings or no readings yet | "Mood —" |
| Signed out, or the stack is not running | "Maester" |

Band words follow the Market mood page (`lib/content/market-mood.ts`): Very cautious, Cautious, Middling, Eager, Very eager.

The menu, in order:

1. The stack state line (not clickable), and its action when it has one ("Open Docker", "Show the log", "Choose the Maester folder", "Start Maester").
2. Open Maester · Market mood · Documents
3. Add a PDF…
4. Sign in (only when signed out)
5. Start at login (checkbox) · Stop Maester's services
6. Quit Maester

Closing the window does not quit the app. The Dock icon shows while the window is open and hides when it is closed.

## Notifications

The main process checks the API with `net.fetch(…, { credentials: "include" })`, which sends the window's session cookies. Signed out (a 401), it checks nothing more until a sign-in, and the title says "Maester".

| Source | Endpoint | Every | Notify when |
| --- | --- | --- | --- |
| Documents | `GET /v1/workspaces/:ws/documents` | 30 s while any document's `intakeState` is `identifying` or `reading`, otherwise 10 min | a document's `intakeState` becomes `read`; becomes `needs_company` or `needs_kind`; becomes `identify_failed` or `read_failed` |
| Connections | `GET /v1/settings/connections` | 30 min | Dhan expires within 3 days (at most once a calendar day); a connection becomes `expired` or `failing` |
| Mood | `GET /v1/market-mood` | 10 min, as the page does | the band changes (a score change alone does not notify) |

The documents workspace is the first one from `/v1/me`, as the Documents page does.

Copy, sentence case, saying what happened and, where it applies, what to do:

- "ar-2026.pdf is read."
- "ar-2026.pdf needs you. Which company is it?" / "ar-2026.pdf needs you. What is it?"
- "Maester couldn't read ar-2026.pdf."
- "Your Dhan token expires on 5 Nov. Replace it in Settings." / "Your Dhan token has expired. Replace it in Settings." / "Maester can't reach FRED. Check it in Settings."
- "Mood moved from Cautious to Middling."

Clicking a notification shows the window on the page it is about: the document's slip, Settings, or Market mood.

**No repeats.** The app keeps what it last saw (each document's state, each connection's state and expiry day, the band) in a JSON file in its data folder. The first check after the app starts, or after a sign-in, only records the current state and notifies nothing, so a restart never repeats old news. The pure rule, `notificationsFor(previous, current, today)`, returns the notifications to show and is what the tests cover.

### Change to the Documents page

The slip opens the document named in `?document=<id>` when the address has one, otherwise the document it opens today. This lets a notification open a given document. It is the only Documents change.

## PDFs from Finder

- **Where:** the Dock icon (the app declares it opens PDFs, so `open-file` fires), the menu-bar item (the tray's `drop-files`), and "Add a PDF…" (the system file picker, PDFs only).
- **How:** the app shows the window on `/terminal/documents` and hands the file to the page through `onFile`. The page puts it through its drop strip as if it were dropped there: the same PDF and 50 MB checks, the same refusal notice, loader, slip and focus. There is no second upload path in the app.
- **Several files:** the app keeps a queue and hands over the next file when the page calls `fileAccepted()`, as the drop strip takes one file at a time.
- **Signed out or stack down:** the app keeps the queue, shows the window on the sign-in page or the stack state, and hands the files over once Documents is open.

## Copy and design

Native menus and notifications are macOS chrome, not pages, so `docs/DESIGN.md` does not style them. Their words follow section 7: sentence case, plain verbs, the investor's point of view, words not colour, unknown shown as "—". `/desktop/signed-in` is built from `AuthLayout`, `Notice` and `.button` with no new component; it gets a line under section 10. The app icon is the wordmark's "M" in ink on paper. It is a drawing, so it needs no new colour token.

## Testing

- **Unit (vitest, `apps/desktop/src/lib/`)**: `notificationsFor` (each transition, the first-check rule, the daily limit on the Dhan expiry notice, band changes against score changes), the menu title, the stack state machine (with `docker` and HTTP checks injected), the `state` check on `maester://` links (match, expiry, single use, unknown), and the file queue.
- **API**: a one-time token generated for a session verifies once into a session cookie, and fails a second time and after expiry.
- **Web**: `GoogleButton` calls the bridge when it exists and redirects to Google when it does not; `/desktop/signed-in` builds the `maester://` link with the `state` it was given; the slip honours `?document=`.
- **On this Mac, by hand**, before calling it done: sign in with Google through the browser; drop one and then three PDFs on the Dock icon and on the menu-bar item; see each kind of notification and click it; log out of macOS and back in to see the app start, with Docker stopped and then running; quit and see the services keep running.

## Risks and checks

- **Background cookies.** The plan's first task checks that `net.fetch` with `credentials: "include"` sends the window's session cookie to `localhost:5173`. If it does not, the background checks run in the window's renderer instead (a hidden window when the main one is closed), with the same rules.
- **Google's view of the hand-off.** Google sign-in happens in the user's real browser, so Google's embedded-browser rule does not apply. Nothing in the OAuth client changes: the callback is still `http://localhost:5173/api/auth/callback/google`.
- **Docker Desktop at login.** Docker can take a minute to start. The 2-minute wait covers it, and "Docker isn't running" with "Open Docker" covers a Mac where it does not start.
- **Local only.** The app assumes the stack on this Mac at `localhost:5173`. If Maester is later hosted, the window's address and the stack section change; the menu bar, notifications and drop do not.

## Out of scope

Bundling Postgres, Node or Python into the app; a hosted backend; notarisation and auto-update; Windows and Linux; the coming-soon pages' alerts (reviews due, position limits) until those pages work; offline use (Gemini, Dhan and FRED need the network).

## Docs to update with the build

`docs/ARCHITECTURE.md` (the new app), `docs/DEVELOPMENT.md` (building and running it), `docs/SIGN_IN.md` (the desktop hand-off), `docs/DESIGN.md` section 10 (`/desktop/signed-in`) and `apps/desktop/README.md`.
