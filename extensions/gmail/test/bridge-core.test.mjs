// Runs without vitest/esbuild:  node --test extensions/gmail/test/
import test from "node:test";
import assert from "node:assert/strict";
import "../bridge-core.js";

const c = globalThis.OneKeelBridge;
const s = c.sanitizeHtml;
const N = "0123456789abcdef0123456789abcdef";

test("app URL validation", () => {
  assert.equal(c.normalizeAppUrl("https://cal.example.com/x?y#z"), "https://cal.example.com");
  assert.equal(c.normalizeAppUrl("http://localhost:3000/a"), "http://localhost:3000");
  for (const bad of ["http://cal.example.com", "http://localhost.evil.com", "https://u:p@a.com", "javascript:1", "a.com", "", null])
    assert.equal(c.normalizeAppUrl(bad), null, String(bad));
  const u = new URL(c.scheduleUrl("https://a.com", N));
  assert.equal(u.search, "?gmail=1");
  assert.equal(u.hash, `#nonce=${N}`);
});

test("nonce", () => {
  assert.match(c.createNonce(), /^[a-f0-9]{32}$/);
  assert.notEqual(c.createNonce(), c.createNonce());
  assert.equal(c.sameNonce(N, N), true);
  assert.equal(c.sameNonce(N, "f".repeat(32)), false);
});

test("message validation: origin, source, nonce", () => {
  const popup = {};
  const ctx = { appOrigin: "https://a.com", popup, nonce: N };
  const d = { app: "onekeel-calendar", v: 1, type: "insert", nonce: N, requestId: "r1", html: "<p>x</p>" };
  assert.ok(c.validateAppMessage({ origin: "https://a.com", source: popup, data: d }, ctx).ok);
  assert.equal(c.validateAppMessage({ origin: "https://b.com", source: popup, data: d }, ctx).reason, "origin");
  assert.equal(c.validateAppMessage({ origin: "https://a.com", source: {}, data: d }, ctx).reason, "source");
  assert.equal(c.validateAppMessage({ origin: "https://a.com", source: popup, data: { ...d, nonce: "f".repeat(32) } }, ctx).reason, "nonce");
  assert.equal(c.validateAppMessage({ origin: "https://a.com", source: popup, data: { ...d, type: "exec" } }, ctx).reason, "type");
  assert.equal(c.validateAppMessage({ origin: "https://a.com", source: popup, data: { ...d, html: "" } }, ctx).ok, false);
});

test("sanitizer removes active content", () => {
  assert.equal(s(`<p>a</p><script>alert(1)</script><style>p{}</style><iframe>z</iframe><img src=x onerror=1><svg><script>1</script></svg>b`), "<p>a</p>b");
  assert.equal(s(`<td class="x" id="y" onclick="e()" data-a="1" bgcolor="#fff">t</td>`), `<td bgcolor="#fff">t</td>`);
  for (const bad of ["javascript:alert(1)", " java\nscript:alert(1)", "jav&#x61;script:alert(1)", "jav&#97;script&colon;alert(1)", "data:text/html,x", "//evil.example", "/rel"])
    assert.equal(s(`<a href="${bad}">x</a>`), "x", bad);
  assert.equal(s(`<p style="color:#111;position:fixed;font-size:14px">a</p>`), `<p style="color:#111;font-size:14px">a</p>`);
  assert.equal(s(`<p style="color:red;background:url(http://x)">a</p>`), "<p>a</p>");
  assert.doesNotMatch(s(`<scr<script>ipt>alert(1)</script>`), /<script/i);
  assert.equal(s(`a < b && c > d`), "a &lt; b &amp;&amp; c &gt; d");
  assert.equal(s("x".repeat(c.MAX_HTML + 1)), "");
});

test("sanitizer keeps link and table styling and is idempotent", () => {
  const html = `<table role="presentation" width="100%" cellpadding="0" style="width:100%;border-collapse:separate;"><tr><td bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;"><a href="https://x.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer" style="font-family:-apple-system,'Segoe UI',Arial;display:inline-block;">9:00 AM</a></td></tr></table>`;
  const out = s(html);
  assert.match(out, /href="https:\/\/x\.com\/a\?b=1&amp;c=2"/);
  assert.match(out, /border-radius:8px/);
  assert.match(out, /display:inline-block/);
  assert.equal(s(out), out);
});
