import { appendFile } from "node:fs/promises";

const port = Number(process.env.WEBHOOK_PORT ?? 3999);
const hostname = process.env.WEBHOOK_BIND ?? "127.0.0.1";
const captureFile = process.env.WEBHOOK_CAPTURE_FILE;

if (!captureFile) {
  console.error("WEBHOOK_CAPTURE_FILE is required");
  process.exit(1);
}

const appendCapture = async (entry: unknown): Promise<void> => {
  await appendFile(captureFile, `${JSON.stringify(entry)}\n`, "utf8");
};

Bun.serve({
  port,
  hostname,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (req.method !== "POST" || url.pathname !== "/hook") {
      return new Response("not found", { status: 404 });
    }
    const raw = await req.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    await appendCapture({
      at: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      headers: Object.fromEntries(req.headers.entries()),
      raw,
      json,
    });
    return Response.json({ ok: true });
  },
});

console.log(`webhook receiver listening on http://${hostname}:${port}/hook`);
