import { resolve, sep } from "node:path";
import type { Context } from "hono";

const publicRoot = resolve(process.cwd(), "public");

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function resolvePublicAsset(pathname: string): string | null {
  const decoded = decodePathname(pathname);
  if (!decoded?.startsWith("/public/")) return null;

  const path = resolve(process.cwd(), decoded.slice(1));
  if (path !== publicRoot && !path.startsWith(`${publicRoot}${sep}`)) return null;
  return path;
}

function acceptsEncoding(header: string | null, encoding: "br" | "gzip"): boolean {
  if (!header) return false;

  return header.split(",").some((part) => {
    const [name, ...params] = part.trim().split(";");
    if (name?.trim().toLowerCase() !== encoding) return false;
    return !params.some((param) => {
      const [key, value] = param.trim().split("=");
      return key?.toLowerCase() === "q" && Number(value) === 0;
    });
  });
}

async function encodedFile(path: string, encoding: "br" | "gzip"): Promise<Bun.BunFile | null> {
  const suffix = encoding === "br" ? ".br" : ".gz";
  const file = Bun.file(`${path}${suffix}`);
  return (await file.exists()) ? file : null;
}

export function servePublicAsset(isDevelopment: boolean) {
  return async (c: Context) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      c.header("Allow", "GET, HEAD");
      return c.text("Method Not Allowed", 405);
    }

    const path = resolvePublicAsset(new URL(c.req.url).pathname);
    if (!path) return c.notFound();

    const sourceFile = Bun.file(path);
    if (!(await sourceFile.exists())) return c.notFound();

    const acceptEncoding = c.req.header("Accept-Encoding") ?? null;
    let selected = sourceFile;
    let selectedEncoding: "br" | "gzip" | null = null;

    if (acceptsEncoding(acceptEncoding, "br")) {
      const br = await encodedFile(path, "br");
      if (br) {
        selected = br;
        selectedEncoding = "br";
      }
    }

    if (!selectedEncoding && acceptsEncoding(acceptEncoding, "gzip")) {
      const gz = await encodedFile(path, "gzip");
      if (gz) {
        selected = gz;
        selectedEncoding = "gzip";
      }
    }

    const headers = new Headers({
      "Cache-Control": isDevelopment ? "no-store" : "public, max-age=31536000, immutable",
      "Content-Length": String(selected.size),
      "Content-Type": sourceFile.type || "application/octet-stream",
      Vary: "Accept-Encoding",
    });

    if (selectedEncoding) headers.set("Content-Encoding", selectedEncoding);

    return new Response(c.req.method === "HEAD" ? null : selected, { headers });
  };
}
