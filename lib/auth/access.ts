/**
 * Internal-access allowlist for sign-up and sign-in. Pure and I/O free so it can be tested
 * exhaustively. Configured by environment:
 *   ALLOWED_EMAILS         comma-separated exact addresses
 *   ALLOWED_EMAIL_DOMAINS  comma-separated domains (exact match; subdomains are NOT included)
 *   ADMIN_EMAIL            the only address that may become the first admin
 * If either allowlist variable has any non-blank entry the instance is "restricted": only listed
 * addresses (and ADMIN_EMAIL) may create an account or get a session, on every path (password,
 * magic link, OAuth), including the very first account. Malformed entries are dropped but the
 * instance stays restricted, so a typo can only shrink access, never widen it.
 */

export type AccessConfig = {
  restricted: boolean;
  emails: ReadonlySet<string>;
  domains: ReadonlySet<string>;
  adminEmail: string | null;
};

export const OPEN_ACCESS: AccessConfig = { restricted: false, emails: new Set(), domains: new Set(), adminEmail: null };

/** Lower-cased address with exactly one "@" and no whitespace; otherwise null. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  const parts = value.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return value;
}

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

function normalizeDomain(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/^@/, "");
  return DOMAIN.test(value) ? value : null;
}

const tokens = (raw: string | undefined) => (raw ?? "").split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);

export function parseAccessConfig(source: Record<string, string | undefined>): AccessConfig {
  const rawEmails = tokens(source.ALLOWED_EMAILS);
  const rawDomains = tokens(source.ALLOWED_EMAIL_DOMAINS);
  const emails = new Set(rawEmails.map(normalizeEmail).filter((e): e is string => e !== null));
  const domains = new Set(rawDomains.map(normalizeDomain).filter((d): d is string => d !== null));
  return {
    restricted: rawEmails.length > 0 || rawDomains.length > 0 || tokens(source.ADMIN_EMAIL).length > 0,
    emails,
    domains,
    adminEmail: normalizeEmail(source.ADMIN_EMAIL),
  };
}

export const accessConfigFromProcessEnv = (): AccessConfig => parseAccessConfig(process.env);

/** May this address have an account? Unrestricted instances allow everyone (signup mode still applies). */
export function isEmailAllowed(access: AccessConfig, email: string | null | undefined): boolean {
  if (!access.restricted) return true;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (normalized === access.adminEmail || access.emails.has(normalized)) return true;
  return access.domains.has(normalized.split("@")[1]);
}

/** May this address become the instance admin? Anyone when ADMIN_EMAIL is not set. */
export function mayBecomeAdmin(access: AccessConfig, email: string | null | undefined): boolean {
  if (access.adminEmail === null) return true;
  return normalizeEmail(email) === access.adminEmail;
}
