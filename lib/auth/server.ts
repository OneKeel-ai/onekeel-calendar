import { getDb } from "@/db/client";
import { cipherFromEnv } from "@/lib/crypto/encryption";
import { getEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/enqueue";
import { sealEmail } from "@/lib/jobs/queues";
import { parseAccessConfig } from "./access";
import { type Auth, createAuth } from "./auth";

// One Better Auth instance per process, created lazily so env is only read at runtime.
const globalForAuth = globalThis as unknown as { __opencalAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__opencalAuth) {
    const env = getEnv();
    const cipher = cipherFromEnv(env);
    globalForAuth.__opencalAuth = createAuth({
      db: getDb(),
      env,
      access: parseAccessConfig({ ALLOWED_EMAILS: env.ALLOWED_EMAILS, ALLOWED_EMAIL_DOMAINS: env.ALLOWED_EMAIL_DOMAINS, ADMIN_EMAIL: env.ADMIN_EMAIL }),
      // Links carry one-time tokens: they are sealed before they reach the job table.
      sendEmail: async (request) => {
        await enqueue("emailSend", sealEmail(cipher, request));
      },
    });
  }
  return globalForAuth.__opencalAuth;
}
