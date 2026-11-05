# OneKeel Gmail extension (Boomerang replacement: meeting times in an email)

Adds a compact **Meeting times** button to Gmail compose and reply. It opens the Calendar app's
`/schedule?gmail=1` page in a popup, you pick free times, press **Insert into Gmail**, and the same
table of time buttons used by "Copy for email" lands in your draft where your cursor was.

What it is not: not live. The inserted times are a **snapshot**. Each time is a link to the booking
page, which rechecks availability when the guest clicks, so a taken time fails safe there. It
never sends mail, never reads your inbox or drafts, and loads no remote code.

## Files

| Path | Role |
| --- | --- |
| `extensions/gmail/manifest.json` | MV3. Permissions: `storage`. Runs only on `https://mail.google.com/mail/*`. |
| `extensions/gmail/bridge-core.js` | Pure helpers: URL validation, nonce, message validation, HTML sanitizer. |
| `extensions/gmail/compose-dom.js` | Finds compose bodies, adds the button, saves selection, inserts HTML. |
| `extensions/gmail/content.js` | Wiring: opens the popup, listens for messages, replies. |
| `extensions/gmail/options.html` / `options.js` | Settings page and toolbar popup: Calendar app URL. |
| `extensions/gmail/test/harness.html` | In-browser check against a fake compose (no Gmail needed). |
| `features/embed/email/gmail-bridge.ts` | App side: session check, handshake, trusted-reply check. |
| `features/embed/email/email-copy-actions.tsx` | Shows **Insert into Gmail** only after the handshake succeeded. |

## Settings

Default app URL is `https://onekeel-calendar.onrender.com` (constant `DEFAULT_APP_URL` in
`bridge-core.js`; change it there if the production URL differs). Saved in `chrome.storage.sync`.
Only `https://` is accepted, plus `http://localhost`, `http://127.0.0.1` and `http://[::1]` for development. Only the
origin is kept (path, query and credentials are dropped).

## How the popup and Gmail talk

1. Click **Meeting times**. The extension saves your caret, creates a random 32-hex nonce and
   `window.open`s `<app>/schedule?gmail=1#nonce=<nonce>`. The nonce is in the fragment, so it is not sent to the server or logged.
2. `/schedule` offers **Insert into Gmail** only if it has `gmail=1`, a valid nonce and a
   `window.opener`. It then posts `hello` to the opener with target origin exactly
   `https://mail.google.com`. The extension answers `ready` only if the sender's origin is the
   configured app origin, `event.source` is the popup it opened, and the nonce matches. Only then does the button appear.
3. **Insert into Gmail** posts `{type:"insert", nonce, requestId, html, text}`: the rendered selected times and nothing else (no auth, tokens or calendar details).
4. The extension re-validates, **sanitizes** the HTML, inserts it at the saved caret (end of body if none),
   and replies `result`. If the draft is gone, the app copies the times to the clipboard and tells the user to paste.
   Plain **Copy for email** always works as the fallback.

Sanitizer: rebuilds the HTML from an allowlist (tables, p/div/span/br, bold/italic, lists, headings, links).
Drops scripts, styles, frames, forms, images, SVG, comments, event handlers, classes, ids, `data-*`.
Links must be `http(s):` or `mailto:` and get `target="_blank" rel="noopener noreferrer"`. Inline styles
keep a short property allowlist; any `url()`, `expression`, `@import` or backslash drops the whole style. Payloads over 100,000 characters are refused.

## Requirements on the app

- `/schedule` must **not** send `Cross-Origin-Opener-Policy: same-origin`, or the popup loses `window.opener`.
- The popup must render the existing email embed panel, which uses `EmailCopyActions`.
- The email links should point at the same public URL as the configured app URL.

## Verify

- No-install check: `node --test extensions/gmail/test/bridge-core.test.mjs` (core logic, no vitest or esbuild needed).
- Unit tests: `npx vitest run --project unit features/embed/email/gmail-bridge.test.ts`
  (origin, nonce, source, message shape, sanitizer incl. the real email embed output).
- DOM harness: `npx serve extensions/gmail`, open `/test/harness.html`; the tab title becomes `HARNESS PASS`.
- Live (needs a human): load unpacked `extensions/gmail`, open Gmail compose, click **Meeting times**,
  pick times, **Insert into Gmail**, confirm the table appears at the caret and nothing was sent.
  Then close the compose and press the button again to see the clipboard fallback message.

## Known limits

- Gmail's markup changes without notice. Selectors live in `compose-dom.js` (`BODY_SELECTOR`, `SEND_SELECTOR`); if the button vanishes, fix them there.
- Not tested against live Gmail yet. The one thing to confirm first: that `event.source` equals the popup returned by `window.open` inside the content script.
- Plain-text compose mode (no rich body) gets no button; use Copy for email.
- Inserted times do not update. Re-pick to refresh.
- Sign-in: if `/schedule` sends a signed-out user to the login page, the URL fragment (and nonce) is lost on the way back. The popup then shows only Copy for email. After signing in, close it and click **Meeting times** again; the session is reused and the button appears. (The nonce is kept out of the query on purpose so it never reaches server logs.)
