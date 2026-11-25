// The servers' mailer (AWS-01): emails go out through Amazon SES, and a failure never breaks
// the request or leaks the link or the address into the logs. SES itself is never called here.
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config.js";
import { logger } from "../../src/lib/logger.js";
import { sendEmail, verificationEmail } from "../../src/services/email.js";

const original = { nodeEnv: config.nodeEnv, from: config.email.from };
const email = verificationEmail("parent@example.com", "Amina", "secret-token-123");

describe("sendEmail on the servers (production mode)", () => {
  beforeEach(() => {
    config.nodeEnv = "production";
    config.email.from = "Dream Builder <hello@example.com>";
  });
  afterEach(() => {
    config.nodeEnv = original.nodeEnv;
    config.email.from = original.from;
    vi.restoreAllMocks();
  });

  it("sends through SES from EMAIL_FROM, to the parent, with the subject and text", async () => {
    const send = vi.spyOn(SESv2Client.prototype, "send").mockResolvedValue({ MessageId: "m-1" } as never);
    await sendEmail(email);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0] as SendEmailCommand;
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input.FromEmailAddress).toBe("Dream Builder <hello@example.com>");
    expect(command.input.Destination?.ToAddresses).toEqual(["parent@example.com"]);
    expect(command.input.Content?.Simple?.Subject?.Data).toBe(email.subject);
    expect(command.input.Content?.Simple?.Body?.Text?.Data).toContain("/verify-email?token=secret-token-123");
  });

  it("doesn't throw when SES refuses, and logs neither the link nor the address", async () => {
    const refusal = Object.assign(new Error("Email address is not verified. The following identities failed the check in region AP-SOUTH-1: parent@example.com"), { name: "MessageRejected" });
    vi.spyOn(SESv2Client.prototype, "send").mockRejectedValue(refusal as never);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(sendEmail(email)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(error.mock.calls[0]);
    expect(logged).toContain("MessageRejected");
    expect(logged).not.toContain("parent@example.com");
    expect(logged).not.toContain("secret-token-123");
  });

  it("without EMAIL_FROM, sends nothing and says so in the log", async () => {
    config.email.from = null;
    const send = vi.spyOn(SESv2Client.prototype, "send");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

    await sendEmail(email);

    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain("secret-token-123");
  });
});
