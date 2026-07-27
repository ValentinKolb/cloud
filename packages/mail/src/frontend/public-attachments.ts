import { env } from "@valentinkolb/cloud/config";
import { type AuthContext, auth, rateLimit } from "@valentinkolb/cloud/server";
import { ratelimit } from "@k2b/sync";
import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { attachmentLinks, messages } from "../service";
import { resolveByteRange } from "../service/byte-range";

const GRANT_COOKIE = "mail_attachment_grant";
const MAX_UNLOCK_BODY_BYTES = 4 * 1024;
const unlockAttemptLimiter = ratelimit({
  id: "public-attachment-unlock",
  limit: 10,
  windowSecs: 5 * 60,
  prefix: "mail:rate-limit",
});

const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const unlockPage = (params: { filename: string | null; byteLength: number; error?: string }): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Download attachment</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: Canvas; color: CanvasText; }
      main { width: min(100%, 440px); border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; padding: 24px; background: Canvas; }
      h1 { margin: 0 0 8px; font-size: 20px; } p { margin: 0 0 18px; color: color-mix(in srgb, CanvasText 65%, transparent); }
      label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; }
      input, button { width: 100%; min-height: 42px; border-radius: 6px; font: inherit; }
      input { border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); padding: 0 12px; background: Canvas; color: CanvasText; }
      button { margin-top: 12px; border: 0; background: CanvasText; color: Canvas; font-weight: 600; cursor: pointer; }
      .error { color: #b91c1c; font-size: 13px; margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(params.filename || "Attachment")}</h1>
      <p>${params.byteLength > 0 ? `${formatBytes(params.byteLength)} · ` : ""}Enter the password supplied by the sender.</p>
      ${params.error ? `<div class="error" role="alert">${escapeHtml(params.error)}</div>` : ""}
      <form method="post">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus />
        <button type="submit">Unlock download</button>
      </form>
    </main>
  </body>
</html>`;

const safeFilename = (value: string | null): string => {
  const normalized = [...(value?.normalize("NFC") || "attachment")].slice(0, 255).join("");
  return normalized || "attachment";
};

const contentDisposition = (filename: string | null): string => {
  const normalized = safeFilename(filename);
  const fallback = normalized.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(normalized).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

const download = async (c: Context<AuthContext>, token: string, grantToken: string) => {
  const inspected = await attachmentLinks.inspectPublicAttachmentDownload({ publicToken: token, grantToken });
  if (!inspected.ok) return null;
  const range = resolveByteRange(c.req.header("range"), inspected.data.total);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${inspected.data.total}`, "Cache-Control": "private, no-store" },
    });
  }
  const claimed = await attachmentLinks.claimPublicAttachmentDownload({
    publicToken: token,
    grantToken,
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || null,
    userAgent: c.req.header("user-agent") ?? null,
  });
  if (!claimed.ok || claimed.data.blobId !== inspected.data.blobId) return null;
  const selected = range ?? { start: 0, endExclusive: claimed.data.total };
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(selected.endExclusive - selected.start),
    "Content-Type": "application/octet-stream",
    "Content-Disposition": contentDisposition(claimed.data.filename),
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (range) headers.set("Content-Range", `bytes ${selected.start}-${selected.endExclusive - 1}/${claimed.data.total}`);
  return new Response(
    messages.createAttachmentStream({
      blobId: claimed.data.blobId,
      chunkSize: claimed.data.chunkSize,
      chunkCount: claimed.data.chunkCount,
      start: selected.start,
      endExclusive: selected.endExclusive,
      assertCurrentAccess: () => attachmentLinks.assertPublicAttachmentDownloadAccess(claimed.data.linkId, grantToken),
    }),
    { status: range ? 206 : 200, headers },
  );
};

const readUnlockPassword = async (request: Request): Promise<string | null> => {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_UNLOCK_BODY_BYTES) {
        await reader.cancel("body-too-large");
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const password = new URLSearchParams(new TextDecoder().decode(bytes)).get("password") ?? "";
  return password && new TextEncoder().encode(password).byteLength <= 256 ? password : null;
};

export const publicAttachmentRoutes = new Hono<AuthContext>()
  .use("*", rateLimit({ keyBy: "ip", limitPerSecond: 20 }))
  .get("/attachments/:token", auth.requireRole("*"), async (c) => {
    const token = c.req.param("token");
    const grant = getCookie(c, GRANT_COOKIE) ?? null;
    if (grant) {
      const response = await download(c, token, grant);
      if (response) return response;
    }
    const presentation = await attachmentLinks.getPublicAttachmentLinkPresentation(token);
    if (!presentation.ok) return c.text("Attachment link not found", 404);
    if (!presentation.data.passwordProtected) {
      const range = resolveByteRange(c.req.header("range"), presentation.data.byteLength);
      if (range === "unsatisfiable") {
        return c.body(null, 416, {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${presentation.data.byteLength}`,
          "Cache-Control": "private, no-store",
        });
      }
      const unlocked = await attachmentLinks.unlockPublicAttachmentLink(token);
      if (!unlocked.ok) return c.text("Attachment link not found", 404);
      const path = attachmentLinks.publicAttachmentLinkPath(token);
      setCookie(c, GRANT_COOKIE, unlocked.data.grantToken, {
        path,
        httpOnly: true,
        secure: !env.IS_DEVELOPMENT,
        sameSite: "Strict",
        maxAge: Math.max(1, Math.floor((Date.parse(unlocked.data.expiresAt) - Date.now()) / 1000)),
      });
      const response = await download(c, token, unlocked.data.grantToken);
      return response ? c.newResponse(response.body, response) : c.text("Attachment link not found", 404);
    }
    return c.html(unlockPage(presentation.data), 200, { "Cache-Control": "private, no-store" });
  })
  .post("/attachments/:token", rateLimit({ keyBy: "ip", limitPerSecond: 1, windowSecs: 5 }), auth.requireRole("*"), async (c) => {
    const token = c.req.param("token");
    const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const attempt = await unlockAttemptLimiter.check(
      `link:${attachmentLinks.hashAttachmentLinkToken(token)}:client:${attachmentLinks.hashAttachmentLinkToken(clientIp)}`,
    );
    if (attempt.limited) {
      c.header("Retry-After", String(Math.max(1, Math.ceil(attempt.resetIn / 1000))));
      return c.text("Too many unlock attempts. Try again later.", 429, { "Cache-Control": "private, no-store" });
    }
    const presentation = await attachmentLinks.getPublicAttachmentLinkPresentation(token);
    if (!presentation.ok || !presentation.data.passwordProtected) return c.text("Attachment link not found", 404);
    const password = await readUnlockPassword(c.req.raw);
    const unlocked = password ? await attachmentLinks.unlockPublicAttachmentLink(token, password) : null;
    if (!unlocked?.ok) {
      return c.html(unlockPage({ ...presentation.data, error: "The password is incorrect or the link is no longer available." }), 404, {
        "Cache-Control": "private, no-store",
      });
    }
    const path = attachmentLinks.publicAttachmentLinkPath(token);
    setCookie(c, GRANT_COOKIE, unlocked.data.grantToken, {
      path,
      httpOnly: true,
      secure: !env.IS_DEVELOPMENT,
      sameSite: "Strict",
      maxAge: Math.max(1, Math.floor((Date.parse(unlocked.data.expiresAt) - Date.now()) / 1000)),
    });
    return c.redirect(path, 303);
  });
