import { config } from "../config.js";
import { logger } from "../lib/logger.js";

// Sending emails. Which "mailer" is used depends on where the API runs:
//   development: prints the email in YOUR terminal, so you can click the link (no real email)
//   test:        keeps emails in `outbox`, so tests can read the link
//   production:  no real sender yet (it arrives with AWS-01). Logs that an email was NOT sent,
//                without the link. Sami Bhai's email setup replaces this.

export interface Email {
  to: string;
  subject: string;
  text: string;
}

// Emails "sent" while testing, newest last. Only filled when NODE_ENV is "test".
export const outbox: Email[] = [];

export async function sendEmail(email: Email): Promise<void> {
  switch (config.nodeEnv) {
    case "test":
      outbox.push(email);
      return;

    case "development":
      // console.log on purpose, not the logger: this text holds a one-time link, and the
      // logger is for things that may be stored. This only ever runs on your own PC.
      console.log(
        [
          "",
          "──────────── 📧 EMAIL (dev mailer, not really sent) ────────────",
          `To:      ${email.to}`,
          `Subject: ${email.subject}`,
          "",
          email.text,
          "────────────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      return;

    case "production":
      // Never log the text: it contains a secret link.
      logger.warn({ subject: email.subject }, "Email NOT sent: no email sender is configured yet (AWS-01)");
      return;
  }
}

export function verificationEmail(to: string, name: string, token: string): Email {
  const link = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Please confirm your email for Dream Builder",
    text: `Hi ${name},\n\nPlease confirm your email address by opening this link:\n${link}\n\nThe link works once and expires in 24 hours.\nIf you didn't create a Dream Builder account, you can ignore this email.`,
  };
}

export function passwordResetEmail(to: string, name: string, token: string): Email {
  const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: "Reset your Dream Builder password",
    text: `Hi ${name},\n\nYou can choose a new password here:\n${link}\n\nThe link works once and expires in 24 hours.\nIf you didn't ask for this, you can ignore this email: your password stays the same.`,
  };
}
