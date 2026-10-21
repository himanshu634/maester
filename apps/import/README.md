# @maester/import

Sends a folder of PDFs and XBRL instances (`.xml`) through the Maester API, four files at a time.
Each file goes through the same three requests as an upload in the web app: create the upload,
`PUT` the bytes to the signed URL, then finalize. Maester then reads each file as it does any
other upload.

## Run it

```sh
export MAESTER_SESSION_COOKIE='maester.session_token=<value>'
export MAESTER_WORKSPACE=<workspace id>
pnpm --filter @maester/import run import ~/Personal/maester-filings/xbrl
```

Use `run import`. `import` is a pnpm built-in (`pnpm import` builds a lockfile from another
package manager's), so `pnpm --filter @maester/import import` never reaches the script.

| Setting | Flag | Variable | Default |
| --- | --- | --- | --- |
| Workspace id | `--workspace <id>` | `MAESTER_WORKSPACE` | none, required |
| API address | `--api <url>` | `MAESTER_API_URL` | `http://localhost:8787` |
| Session cookie | none | `MAESTER_SESSION_COOKIE` | none, required |

A relative folder is read from the folder where you typed the command.

## Copy the session cookie

1. Sign in to Maester in the browser.
2. Open the developer tools, then Application (Chrome) or Storage (Firefox), then Cookies, and
   pick the address of the API.
3. Copy the session cookie as `name=value`. The API sets `cookiePrefix: "maester"`, so the name is
   `maester.session_token` in development and `__Secure-maester.session_token` in production.

The cookie goes only to the API, never to the signed upload URL. Signing out ends it.

## What you see

- A progress line every 25 files.
- `Sent N. Refused M. Failed K.`, then each refused or failed file by name with its code. The
  command never prints a file's contents.
- Exit code 0 when every file was sent or refused, 1 when any file failed, and 2 when the session
  was signed out. On 2, the files already started finish, nothing new starts, and the output says
  how many files were not sent. Get a fresh cookie and run it again.

The command takes `.pdf` and `.xml` files (any case), goes through the folder depth first in
sorted order, and skips names that start with `.`, `Thumbs.db`, `desktop.ini` and symbolic links.
It sends every `.xml` file before any `.pdf`, each kind in that order, so a results PDF whose XBRL
is already in is not given to a paid read. A file over 50 MB (52428800 bytes) is refused on your machine, without a request. A `400`, `413`
or `415` from the API is a refusal. A network error, or a `5xx` after two retries (after 1 s, then
2 s), is a failure.

## Run it twice

A second run of the same folder creates duplicates. Maester does not read a duplicate again, but
each one is a new entry in Documents.
