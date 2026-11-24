// A FAKE fal.ai server for the BE-10 tests: it answers like fal.ai (any-llm and FLUX) but
// runs on this PC, costs nothing, and records every request so tests can check what we sent.
// CI never calls the real fal.ai.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A tiny real PNG, served as the "picture".
export const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

export interface FalRequest {
  path: string;
  body: Record<string, unknown>;
}

type Reply = string | { status: number; body: string };

export interface FakeFal {
  url: string;
  requests: FalRequest[];
  /** Replies for the next story-text calls, in order (then `story` is used). */
  storyReplies: Reply[];
  /** The normal story-text reply (a JSON string). */
  story: string;
  title: string;
  /** true → every Scene Director call answers 500. */
  sceneFails: boolean;
  /** The next N FLUX calls answer 500. */
  fluxFailures: number;
  /** The content type the picture download answers with. */
  pictureType: string;
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeFal(): Promise<FakeFal> {
  const fake: FakeFal = {
    url: "",
    requests: [],
    storyReplies: [],
    story: "{}",
    title: "Tibbo and the Whispering Clinic",
    sceneFails: false,
    fluxFailures: 0,
    pictureType: "image/png",
    reset() {
      this.requests = [];
      this.storyReplies = [];
      this.story = "{}";
      this.title = "Tibbo and the Whispering Clinic";
      this.sceneFails = false;
      this.fluxFailures = 0;
      this.pictureType = "image/png";
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const send = (res: import("node:http").ServerResponse, status: number, body: string, type = "application/json") => {
    res.writeHead(status, { "Content-Type": type });
    res.end(body);
  };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = req.url ?? "";
      if (req.method === "GET" && path.startsWith("/files/")) {
        res.writeHead(200, { "Content-Type": fake.pictureType });
        res.end(FAKE_PNG);
        return;
      }
      if (req.headers.authorization !== "Key test-fal-key-123") return send(res, 401, '{"detail":"bad key"}');
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
      fake.requests.push({ path, body });

      if (path === "/fal-ai/any-llm") {
        const prompt = String(body.prompt ?? "");
        const system = String(body.system_prompt ?? "");
        let reply: Reply;
        if (system.startsWith("You are the Scene Director")) {
          if (fake.sceneFails) return send(res, 500, '{"detail":"scene down"}');
          reply = "the hero kneels beside a sleepy puppy in the clinic, warm morning light";
        } else if (prompt.includes("Write the title")) reply = fake.title;
        else reply = fake.storyReplies.shift() ?? fake.story;
        if (typeof reply !== "string") return send(res, reply.status, reply.body);
        return send(res, 200, JSON.stringify({ output: reply }));
      }
      if (path === "/fal-ai/flux/dev") {
        if (fake.fluxFailures > 0) {
          fake.fluxFailures -= 1;
          return send(res, 500, '{"detail":"flux down"}');
        }
        const n = fake.requests.filter((r) => r.path === path).length;
        return send(res, 200, JSON.stringify({ images: [{ url: `${fake.url}/files/picture-${n}.png` }], seed: body.seed }));
      }
      send(res, 404, '{"detail":"no such endpoint"}');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
