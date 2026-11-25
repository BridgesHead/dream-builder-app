import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

// Sending emails. Which "mailer" is used depends on where the API runs:
//   development: prints the email in YOUR terminal, so you can click the link (no real email)
//   test:        keeps emails in `outbox`, so tests can read the link
//   production:  sends it through Amazon SES from EMAIL_FROM (staging and prod servers).
//                Without EMAIL_FROM: logs that an email was NOT sent, without the link.
//
// Sending never throws: a lost email must not break sign-up or give away whether an account
// exists (forgot password). The parent can ask for the email again.

export interface Email {
  to: string;
  subject: string;
  text: string;
}

// Emails "sent" while testing, newest last. Only filled when NODE_ENV is "test".
export const outbox: Email[] = [];

// One SES client for the whole API, made on first use. AWS credentials come from the server's
// IAM role (dreambuilder-ec2-role, policy "email" from infra/aws/setup-ses.sh).
let ses: SESv2Client | null = null;
const sesClient = () => (ses ??= new SESv2Client({ region: config.email.sesRegion }));

// SES error messages can contain the recipient's address: never log one of those.
const withoutAddresses = (text: string) => text.replace(/[^\s@<>"',;:]+@[^\s@<>"',;:]+/g, "<address>");

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
      // Never log the text (it contains a secret link) or the address (personal data).
      if (!config.email.from) {
        logger.warn({ subject: email.subject }, "Email NOT sent: EMAIL_FROM is not set (see infra/aws/setup-ses.sh)");
        return;
      }
      try {
        const sent = await sesClient().send(
          new SendEmailCommand({
            FromEmailAddress: config.email.from,
            Destination: { ToAddresses: [email.to] },
            Content: {
              Simple: {
                Subject: { Data: email.subject, Charset: "UTF-8" },
                Body: { Text: { Data: email.text, Charset: "UTF-8" } },
              },
            },
          }),
        );
        logger.info({ subject: email.subject, messageId: sent.MessageId }, "Email sent");
      } catch (err) {
        // e.g. MessageRejected while SES is in its sandbox and the address isn't confirmed there.
        const e = err as Error;
        logger.error({ subject: email.subject, error: e.name, reason: withoutAddresses(e.message ?? "") }, "Email NOT sent: Amazon SES refused it");
      }
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
