import nodemailer from "nodemailer";
import type { Env } from "@/lib/env";

export type CalendarPart = { method: "REQUEST" | "CANCEL" | "PUBLISH"; content: string };

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** iCalendar invitation, sent as a text/calendar part so clients show accept/update UI. */
  calendar?: CalendarPart;
};

/** Minimal mail-sending port so jobs can be tested without SMTP. */
export type Mailer = { send(email: OutgoingEmail): Promise<void> };

export function createSmtpMailer(
  env: Pick<Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASSWORD"> & Partial<Pick<Env, "MAILGUN_API_KEY" | "MAILGUN_DOMAIN" | "MAILGUN_REGION">>,
): Mailer {
  // HTTPS delivery keeps the same verified OneKeel sending domain without SMTP ports.
  if (env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN) {
    const key = env.MAILGUN_API_KEY;
    const domain = env.MAILGUN_DOMAIN;
    const endpoint = env.MAILGUN_REGION === "EU" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
    const mime = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    return {
      async send({ calendar, ...email }) {
        const message = await mime.sendMail({
          ...email,
          ...(calendar && { icalEvent: { method: calendar.method, filename: "invite.ics", content: calendar.content } }),
        });
        const form = new FormData();
        form.set("to", email.to);
        form.set("message", new Blob([new Uint8Array(message.message as Buffer)], { type: "message/rfc822" }), "message.eml");
        const response = await fetch(endpoint + "/v3/" + encodeURIComponent(domain) + "/messages.mime", {
          method: "POST",
          headers: { Authorization: "Basic " + Buffer.from("api:" + key).toString("base64") },
          body: form,
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error("Email delivery failed (" + response.status + ").");
      },
    };
  }
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return {
    async send({ calendar, ...email }) {
      await transporter.sendMail({
        ...email,
        ...(calendar && {
          icalEvent: { method: calendar.method, filename: "invite.ics", content: calendar.content },
        }),
      });
    },
  };
}
