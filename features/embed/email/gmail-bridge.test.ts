import { describe, expect, it, vi } from "vitest";
import "../../../extensions/gmail/bridge-core.js";
import { MAX_EMAIL_SLOTS, renderEmailEmbed } from "./email-html";
import {
  connectGmailBridge,
  GMAIL_BRIDGE_APP_ID,
  GMAIL_BRIDGE_VERSION,
  GMAIL_MAX_HTML,
  GMAIL_MAX_TEXT,
  GMAIL_ORIGIN,
  insertMessage,
  parseGmailReply,
  readGmailSession,
} from "./gmail-bridge";

type Core = {
  APP_ID: string; VERSION: number; GMAIL_ORIGIN: string; MAX_HTML: number; MAX_TEXT: number; DEFAULT_APP_URL: string;
  normalizeAppUrl(u: unknown): string | null;
  scheduleUrl(origin: string, nonce: string): string;
  createNonce(c?: unknown): string;
  sameNonce(a: unknown, b: unknown): boolean;
  validateAppMessage(e: unknown, ctx: unknown): { ok: boolean; reason?: string; message?: { type: string; requestId?: string; html?: string; text?: string } };
  buildReady(n: string): unknown;
  buildResult(n: string, id: string, ok: boolean, reason?: string): unknown;
  sanitizeHtml(h: unknown): string;
  sanitizeText(t: unknown): string;
};
const core = (globalThis as unknown as { OneKeelBridge: Core }).OneKeelBridge;

const NONCE = "0123456789abcdef0123456789abcdef";
const OTHER = "ffffffffffffffffffffffffffffffff";
const APP = "https://onekeel-calendar.onrender.com";

describe("shared constants", () => {
  it("app helper and extension core agree", () => {
    expect(core.APP_ID).toBe(GMAIL_BRIDGE_APP_ID);
    expect(core.VERSION).toBe(GMAIL_BRIDGE_VERSION);
    expect(core.GMAIL_ORIGIN).toBe(GMAIL_ORIGIN);
    expect(core.MAX_HTML).toBe(GMAIL_MAX_HTML);
    expect(core.MAX_TEXT).toBe(GMAIL_MAX_TEXT);
  });
});

describe("normalizeAppUrl", () => {
  it("accepts https and returns the bare origin", () => {
    expect(core.normalizeAppUrl("https://cal.example.com/some/path?x=1#y")).toBe("https://cal.example.com");
    expect(core.normalizeAppUrl(core.DEFAULT_APP_URL)).toBe(APP);
  });
  it("allows http only for localhost dev", () => {
    expect(core.normalizeAppUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(core.normalizeAppUrl("http://127.0.0.1:3000/x")).toBe("http://127.0.0.1:3000");
    expect(core.normalizeAppUrl("http://cal.example.com")).toBeNull();
    expect(core.normalizeAppUrl("http://localhost.evil.com")).toBeNull();
  });
  it("rejects credentials, other schemes and junk", () => {
    for (const bad of ["https://u:p@cal.example.com", "javascript:alert(1)", "ftp://x.com", "file:///etc/passwd", "cal.example.com", "", null, 5])
      expect(core.normalizeAppUrl(bad)).toBeNull();
  });
  it("builds the schedule URL with the nonce in the fragment, not the query", () => {
    const url = new URL(core.scheduleUrl(APP, NONCE));
    expect(url.pathname).toBe("/schedule");
    expect(url.searchParams.get("gmail")).toBe("1");
    expect(url.search).not.toContain(NONCE);
    expect(url.hash).toBe(`#nonce=${NONCE}`);
  });
});

describe("nonce", () => {
  it("is 32 hex chars and unique", () => {
    const a = core.createNonce();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(core.createNonce()).not.toBe(a);
  });
  it("compares strictly", () => {
    expect(core.sameNonce(NONCE, NONCE)).toBe(true);
    expect(core.sameNonce(NONCE, OTHER)).toBe(false);
    expect(core.sameNonce(NONCE, undefined)).toBe(false);
    expect(core.sameNonce("short", "short")).toBe(false);
  });
});

describe("extension validateAppMessage (Gmail side)", () => {
  const popup = {};
  const ctx = { appOrigin: APP, popup, nonce: NONCE };
  const msg = { app: "onekeel-calendar", v: 1, type: "insert", nonce: NONCE, requestId: "abc123", html: "<p>hi</p>", text: "hi" };
  const ev = (over: Record<string, unknown> = {}) => ({ origin: APP, source: popup, data: msg, ...over });

  it("accepts the right origin, source and nonce", () => {
    const r = core.validateAppMessage(ev(), ctx);
    expect(r.ok).toBe(true);
    expect(r.message).toMatchObject({ type: "insert", requestId: "abc123", html: "<p>hi</p>" });
  });
  it("rejects wrong origin (incl. subdomain and http downgrade)", () => {
    for (const origin of ["https://evil.example", "https://x.onekeel-calendar.onrender.com", "http://onekeel-calendar.onrender.com", "null"])
      expect(core.validateAppMessage(ev({ origin }), ctx)).toMatchObject({ ok: false, reason: "origin" });
  });
  it("rejects a message from any window except the popup we opened", () => {
    expect(core.validateAppMessage(ev({ source: {} }), ctx)).toMatchObject({ ok: false, reason: "source" });
    expect(core.validateAppMessage(ev({ source: null }), ctx)).toMatchObject({ ok: false, reason: "source" });
  });
  it("rejects wrong or missing nonce and wrong version/app", () => {
    expect(core.validateAppMessage(ev({ data: { ...msg, nonce: OTHER } }), ctx)).toMatchObject({ ok: false, reason: "nonce" });
    expect(core.validateAppMessage(ev({ data: { ...msg, nonce: undefined } }), ctx)).toMatchObject({ ok: false, reason: "nonce" });
    expect(core.validateAppMessage(ev({ data: { ...msg, v: 2 } }), ctx)).toMatchObject({ ok: false, reason: "shape" });
    expect(core.validateAppMessage(ev({ data: { ...msg, app: "other" } }), ctx)).toMatchObject({ ok: false, reason: "shape" });
    expect(core.validateAppMessage(ev({ data: "insert" }), ctx)).toMatchObject({ ok: false, reason: "shape" });
  });
  it("rejects bad request ids, empty or oversized payloads and unknown types", () => {
    expect(core.validateAppMessage(ev({ data: { ...msg, requestId: "a b" } }), ctx).ok).toBe(false);
    expect(core.validateAppMessage(ev({ data: { ...msg, html: "" } }), ctx).ok).toBe(false);
    expect(core.validateAppMessage(ev({ data: { ...msg, html: "x".repeat(GMAIL_MAX_HTML + 1) } }), ctx).ok).toBe(false);
    expect(core.validateAppMessage(ev({ data: { ...msg, type: "exec" } }), ctx)).toMatchObject({ ok: false, reason: "type" });
  });
  it("answers hello", () => {
    expect(core.validateAppMessage(ev({ data: { app: "onekeel-calendar", v: 1, type: "hello", nonce: NONCE } }), ctx).message).toEqual({ type: "hello" });
  });
  it("needs a live session", () => {
    expect(core.validateAppMessage(ev(), null).ok).toBe(false);
    expect(core.validateAppMessage(ev(), { ...ctx, popup: null }).ok).toBe(false);
  });
});

describe("readGmailSession (app side)", () => {
  it("needs gmail=1 and a valid nonce", () => {
    expect(readGmailSession("?gmail=1", `#nonce=${NONCE}`)).toEqual({ nonce: NONCE });
    expect(readGmailSession("", `#nonce=${NONCE}`)).toBeNull();
    expect(readGmailSession("?gmail=0", `#nonce=${NONCE}`)).toBeNull();
    expect(readGmailSession("?gmail=1", "")).toBeNull();
    expect(readGmailSession("?gmail=1", "#nonce=nothex")).toBeNull();
    expect(readGmailSession(`?gmail=1&nonce=${NONCE}`, "")).toBeNull(); // query nonce is not accepted
  });
});

describe("parseGmailReply (app side)", () => {
  const opener = {};
  const data = { app: "onekeel-calendar", v: 1, type: "result", nonce: NONCE, requestId: "r1", ok: true };
  it("accepts only Gmail origin + opener window + nonce", () => {
    expect(parseGmailReply({ origin: GMAIL_ORIGIN, source: opener, data }, opener, NONCE)).toEqual({ type: "result", requestId: "r1", ok: true, reason: undefined });
    expect(parseGmailReply({ origin: "https://evil.example", source: opener, data }, opener, NONCE)).toBeNull();
    expect(parseGmailReply({ origin: "https://mail.google.com.evil.example", source: opener, data }, opener, NONCE)).toBeNull();
    expect(parseGmailReply({ origin: GMAIL_ORIGIN, source: {}, data }, opener, NONCE)).toBeNull();
    expect(parseGmailReply({ origin: GMAIL_ORIGIN, source: opener, data: { ...data, nonce: OTHER } }, opener, NONCE)).toBeNull();
    expect(parseGmailReply({ origin: GMAIL_ORIGIN, source: null, data }, null, NONCE)).toBeNull();
  });
});

describe("insertMessage", () => {
  it("carries only app, version, type, nonce, requestId, html and text", () => {
    const m = insertMessage(NONCE, "r1", "<p>x</p>", "x");
    expect(Object.keys(m!).sort()).toEqual(["app", "html", "nonce", "requestId", "text", "type", "v"]);
  });
  it("refuses empty or oversized content", () => {
    expect(insertMessage(NONCE, "r1", "", "x")).toBeNull();
    expect(insertMessage(NONCE, "r1", "x".repeat(GMAIL_MAX_HTML + 1), "x")).toBeNull();
    expect(insertMessage(NONCE, "bad id", "<p>x</p>", "x")).toBeNull();
  });
});

describe("connectGmailBridge handshake and insert", () => {
  function fakeWindow(opts: { search?: string; hash?: string; opener?: boolean }) {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const posted: { message: Record<string, unknown>; target: string }[] = [];
    const opener = opts.opener === false ? null : { closed: false, postMessage: (message: Record<string, unknown>, target: string) => void posted.push({ message, target }) };
    const win = {
      location: { search: opts.search ?? "?gmail=1", hash: opts.hash ?? `#nonce=${NONCE}` },
      opener,
      addEventListener: (_t: "message", l: (e: MessageEvent) => void) => void listeners.push(l),
      removeEventListener: () => {},
      setTimeout: (fn: () => void, ms: number) => Number(setTimeout(fn, ms)),
      clearTimeout: (id: number) => clearTimeout(id),
      crypto: { getRandomValues: <T extends ArrayBufferView>(a: T) => a },
    };
    const send = (origin: string, source: unknown, data: unknown) => listeners.forEach((l) => l({ origin, source, data } as MessageEvent));
    return { win, opener, posted, send };
  }

  it("does nothing without opener, flag or nonce", () => {
    expect(connectGmailBridge(fakeWindow({ opener: false }).win, vi.fn())).toBeNull();
    expect(connectGmailBridge(fakeWindow({ search: "" }).win, vi.fn())).toBeNull();
    expect(connectGmailBridge(fakeWindow({ hash: "" }).win, vi.fn())).toBeNull();
  });

  it("says hello to Gmail's exact origin, becomes ready only on a valid reply, then inserts", async () => {
    vi.useFakeTimers();
    const f = fakeWindow({});
    const onReady = vi.fn();
    const bridge = connectGmailBridge(f.win, onReady)!;
    vi.advanceTimersByTime(1);
    expect(f.posted[0]).toMatchObject({ target: GMAIL_ORIGIN, message: { type: "hello", nonce: NONCE } });

    const ready = { app: "onekeel-calendar", v: 1, type: "ready", nonce: NONCE };
    f.send("https://evil.example", f.opener, ready);
    f.send(GMAIL_ORIGIN, {}, ready);
    f.send(GMAIL_ORIGIN, f.opener, { ...ready, nonce: OTHER });
    expect(onReady).not.toHaveBeenCalled();
    expect(await bridge.insert("<p>x</p>", "x")).toEqual({ ok: false, reason: "unavailable" });

    f.send(GMAIL_ORIGIN, f.opener, ready);
    expect(onReady).toHaveBeenCalledTimes(1);

    const pending = bridge.insert("<p>x</p>", "x");
    const sent = f.posted.at(-1)!;
    expect(sent.target).toBe(GMAIL_ORIGIN);
    expect(sent.message).toMatchObject({ type: "insert", html: "<p>x</p>", text: "x", nonce: NONCE });
    f.send(GMAIL_ORIGIN, f.opener, { app: "onekeel-calendar", v: 1, type: "result", nonce: NONCE, requestId: sent.message.requestId, ok: true });
    expect(await pending).toEqual({ ok: true, reason: undefined });
    bridge.dispose();
    vi.useRealTimers();
  });
});

describe("sanitizeHtml", () => {
  const s = (h: string) => core.sanitizeHtml(h);

  it("removes scripts, styles, frames, forms, images and their content", () => {
    expect(s(`<p>a</p><script>alert(1)</script><style>p{}</style><iframe src="x">z</iframe><img src=x onerror=alert(1)><form><input></form><svg><script>1</script></svg>b`)).toBe("<p>a</p>b");
  });
  it("removes event handlers, classes, ids and data attributes", () => {
    expect(s(`<td class="x" id="y" onclick="e()" data-a="1" onmouseover=e() bgcolor="#fff">t</td>`)).toBe(`<td bgcolor="#fff">t</td>`);
  });
  it("only keeps http(s)/mailto links, including entity and whitespace obfuscation", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " java\nscript:alert(1)", "jav&#x61;script:alert(1)", "jav&#97;script&colon;alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "//evil.example", "/relative"]) {
      const out = s(`<a href="${bad}">x</a>`);
      expect(out, bad).toBe("x");
    }
    expect(s(`<a href="https://cal.example.com/ada?date=2026-10-06&amp;slot=1">x</a>`)).toBe(
      `<a href="https://cal.example.com/ada?date=2026-10-06&amp;slot=1" target="_blank" rel="noopener noreferrer">x</a>`,
    );
    expect(s(`<a href="mailto:a@b.co" target="_top" rel="opener">x</a>`)).toContain('target="_blank" rel="noopener noreferrer"');
  });
  it("filters inline styles to a safe property/value set", () => {
    expect(s(`<p style="color:#111;position:fixed;background:url(http://x/y);font-size:14px">a</p>`)).toBe("<p>a</p>"); // url() poisons the whole attribute
    expect(s(`<p style="color:#111;position:fixed;font-size:14px;width:expression(alert(1))">a</p>`)).toBe("<p>a</p>");
    expect(s(`<p style="color:#111;position:fixed;font-size:14px">a</p>`)).toBe(`<p style="color:#111;font-size:14px">a</p>`);
    expect(s(`<p style="display:none;color:red">a</p>`)).toBe(`<p style="color:red">a</p>`);
    expect(s(`<p style="color:red\\;x">a</p>`)).toBe("<p>a</p>");
  });
  it("neutralises broken and nested markup, comments and attribute breakouts", () => {
    expect(s(`<!-- <script>x</script> --><b>x`)).toBe("<b>x</b>");
    expect(s(`<p title="x"><script>alert(1)</script>y`)).toBe("<p>y</p>");
    expect(s(`<a href="https://a.co" onclick="x">q</a></div></td>`)).not.toMatch(/<\/(div|td)>/);
    expect(s(`a < b && c > d`)).toBe("a &lt; b &amp;&amp; c &gt; d");
    expect(s(`<p style='color:red" onload="x'>a</p>`)).not.toMatch(/onload=/);
    expect(s(`<scr<script>ipt>alert(1)</script>`)).not.toMatch(/<script/i);
  });
  it("rejects non-strings, empty and oversized input", () => {
    expect(s(undefined as unknown as string)).toBe("");
    expect(s("")).toBe("");
    expect(s("x".repeat(GMAIL_MAX_HTML + 1))).toBe("");
  });
  it("sanitizes plain text", () => {
    expect(core.sanitizeText("a\u0000b\r\nc")).toBe("ab\nc");
  });
});

describe("sanitizer keeps the real email embed intact", () => {
  const embed = renderEmailEmbed({
    appUrl: "https://onekeel-calendar.onrender.com",
    target: { calLink: "julie/intro", label: "Intro call" },
    duration: 30,
    timeZone: "America/Chicago",
    locale: "en",
    hour12: true,
    days: [{ date: "2026-11-10", slots: ["2026-11-10T15:00:00.000Z", "2026-11-10T16:30:00.000Z"] }],
    note: "A few times & ideas",
    maxSlots: MAX_EMAIL_SLOTS,
  });

  it("keeps tables, link hrefs, inline styles and text", () => {
    const out = core.sanitizeHtml(embed.html);
    expect(out).not.toBe("");
    expect(out.match(/<table/g)?.length).toBe(embed.html.match(/<table/g)?.length);
    expect(out.match(/<td/g)?.length).toBe(embed.html.match(/<td/g)?.length);
    const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs(out)).toEqual(hrefs(embed.html));
    expect(out).toContain("background-color:#f4f4f5");
    expect(out).toContain("border-radius:6px");
    expect(out).toContain("display:inline-block");
    expect(out).toContain("A few times &amp; ideas");
    expect(out).not.toMatch(/<script|onclick|javascript:/i);
  });
  it("is idempotent", () => {
    const once = core.sanitizeHtml(embed.html);
    expect(core.sanitizeHtml(once)).toBe(once);
  });
});

describe("result builders", () => {
  it("carry the nonce and request id", () => {
    expect(core.buildReady(NONCE)).toEqual({ app: "onekeel-calendar", v: 1, type: "ready", nonce: NONCE });
    expect(core.buildResult(NONCE, "r1", false, "no-compose")).toEqual({ app: "onekeel-calendar", v: 1, type: "result", nonce: NONCE, requestId: "r1", ok: false, reason: "no-compose" });
  });
});
