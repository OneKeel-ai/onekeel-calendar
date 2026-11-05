/**
 * App side of the OneKeel Gmail extension bridge (extensions/gmail). The /schedule popup is opened
 * by the extension from Gmail with `?gmail=1#nonce=<32 hex>`. Only then does the app offer
 * "Insert into Gmail". It posts the selected-times HTML and text, nothing else, to window.opener
 * with the exact Gmail origin as target, and trusts replies only from that origin, from the
 * opener window, and carrying the same nonce. Constants mirror extensions/gmail/bridge-core.js
 * (a unit test keeps them equal).
 */

export const GMAIL_BRIDGE_APP_ID = "onekeel-calendar";
export const GMAIL_BRIDGE_VERSION = 1;
export const GMAIL_ORIGIN = "https://mail.google.com";
export const GMAIL_MAX_HTML = 100_000;
export const GMAIL_MAX_TEXT = 20_000;

const NONCE_RE = /^[a-f0-9]{32}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type GmailSession = { nonce: string };

/** The session handed over by the extension, or null unless both `gmail=1` and a valid nonce are present. */
export function readGmailSession(search: string, hash: string): GmailSession | null {
  if (new URLSearchParams(search).get("gmail") !== "1") return null;
  const nonce = new URLSearchParams(hash.replace(/^#/, "")).get("nonce");
  return nonce && NONCE_RE.test(nonce) ? { nonce } : null;
}

export type GmailReply = { type: "ready" } | { type: "result"; requestId: string; ok: boolean; reason?: string };

/** Validates a message received from Gmail; null for anything that is not from the opener Gmail tab with our nonce. */
export function parseGmailReply(
  event: { origin: string; source: unknown; data: unknown },
  opener: unknown,
  nonce: string,
): GmailReply | null {
  if (event.origin !== GMAIL_ORIGIN) return null;
  if (!opener || event.source !== opener) return null;
  const d = event.data;
  if (d === null || typeof d !== "object" || Array.isArray(d)) return null;
  const m = d as Record<string, unknown>;
  if (m.app !== GMAIL_BRIDGE_APP_ID || m.v !== GMAIL_BRIDGE_VERSION || m.nonce !== nonce) return null;
  if (m.type === "ready") return { type: "ready" };
  if (m.type === "result" && typeof m.requestId === "string" && REQUEST_ID_RE.test(m.requestId) && typeof m.ok === "boolean") {
    return { type: "result", requestId: m.requestId, ok: m.ok, reason: typeof m.reason === "string" ? m.reason.slice(0, 40) : undefined };
  }
  return null;
}

export const helloMessage = (nonce: string) => ({ app: GMAIL_BRIDGE_APP_ID, v: GMAIL_BRIDGE_VERSION, type: "hello", nonce });

/** The only payload that leaves the app: the rendered selected times. Null when it is empty or too big. */
export function insertMessage(nonce: string, requestId: string, html: string, text: string) {
  if (!html || html.length > GMAIL_MAX_HTML || text.length > GMAIL_MAX_TEXT || !REQUEST_ID_RE.test(requestId)) return null;
  return { app: GMAIL_BRIDGE_APP_ID, v: GMAIL_BRIDGE_VERSION, type: "insert", nonce, requestId, html, text };
}

export type GmailInsertResult = { ok: boolean; reason?: string };

type BridgeWindow = {
  location: { search: string; hash: string };
  opener: { closed?: boolean; postMessage(message: unknown, targetOrigin: string): void } | null;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
  crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };
};

export type GmailBridge = { insert(html: string, text: string): Promise<GmailInsertResult>; dispose(): void };

/**
 * Starts the handshake when this window was opened by the Gmail extension. Returns null otherwise
 * (no opener, no flag, no nonce), in which case the UI must not offer "Insert into Gmail".
 * `onReady` fires once the extension in the Gmail tab answered the hello with our nonce.
 */
export function connectGmailBridge(win: BridgeWindow, onReady: () => void): GmailBridge | null {
  const session = readGmailSession(win.location.search, win.location.hash);
  const opener = win.opener;
  if (!session || !opener || opener.closed) return null;

  const pending = new Map<string, (result: GmailInsertResult) => void>();
  let ready = false;
  const timers: number[] = [];

  const listener = (event: MessageEvent) => {
    const reply = parseGmailReply(event, opener, session.nonce);
    if (!reply) return;
    if (reply.type === "ready") {
      if (!ready) {
        ready = true;
        onReady();
      }
      return;
    }
    const done = pending.get(reply.requestId);
    if (done) {
      pending.delete(reply.requestId);
      done({ ok: reply.ok, reason: reply.reason });
    }
  };
  win.addEventListener("message", listener);

  const hello = () => {
    if (!ready) opener.postMessage(helloMessage(session.nonce), GMAIL_ORIGIN);
  };
  for (const ms of [0, 400, 1200, 3000]) timers.push(win.setTimeout(hello, ms));

  return {
    insert(html, text) {
      const bytes = new Uint8Array(8);
      win.crypto.getRandomValues(bytes);
      const requestId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const message = insertMessage(session.nonce, requestId, html, text);
      if (!message || !ready || opener.closed) return Promise.resolve({ ok: false, reason: "unavailable" });
      return new Promise((resolve) => {
        const timer = win.setTimeout(() => {
          pending.delete(requestId);
          resolve({ ok: false, reason: "timeout" });
        }, 4000);
        timers.push(timer);
        pending.set(requestId, (result) => {
          win.clearTimeout(timer);
          resolve(result);
        });
        opener.postMessage(message, GMAIL_ORIGIN);
      });
    },
    dispose() {
      win.removeEventListener("message", listener);
      timers.forEach((t) => win.clearTimeout(t));
      pending.clear();
    },
  };
}
