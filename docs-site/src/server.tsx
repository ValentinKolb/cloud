import { createFibelApp } from "@k2b/fibel";
import { Hono } from "hono";
import { dirname, extname, join, normalize, resolve } from "path";
import fibelConfig from "../fibel.config";
import HomePage from "./home/HomePage";
import { html, config as ssrConfig } from "./ssr";
import UiCatalogPage, { type CatalogComponent } from "./ui/UiCatalogPage";

const fibel = await createFibelApp(fibelConfig);
const app = new Hono();
const catalogComponents: Record<CatalogComponent, string> = {
  "panel-header": "PanelHeader",
  "status-badge": "StatusBadge",
  "stat-grid": "StatGrid",
};
const assetsRoot = process.env.NODE_ENV === "production" ? join(import.meta.dir, "assets") : resolve(import.meta.dir, "..", "assets");
const ssrRoot = ssrConfig.dev ? (ssrConfig.rootDir ?? process.cwd()) : dirname(Bun.main);

const themeFromRequest = (request: Request) => {
  const theme = request.headers.get("Cookie")?.match(/(?:^|;\s*)cloud_docs_theme=(dark|light)(?:;|$)/)?.[1];
  return theme === "dark" ? "dark" : "light";
};

const fetchFibelPath = (request: Request, pathname: string) => {
  const url = new URL(request.url);
  url.pathname = pathname;
  return fibel.fetch(new Request(url, request));
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const serveAsset = async (relativePath: string) => {
  const path = normalize(join(assetsRoot, relativePath));
  if (!path.startsWith(`${assetsRoot}/`)) return new Response("Not found", { status: 404 });
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": contentTypes[extname(path)] ?? file.type,
      "Cache-Control": "no-cache",
    },
  });
};

app.use("*", async (c, next) => {
  await next();

  const path = c.req.path;
  if (path.startsWith("/docs/assets/") && !c.res.headers.has("Content-Type")) {
    c.header("Content-Type", contentTypes[extname(path)] ?? "application/octet-stream");
  }

  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (!c.res.headers.has("Cache-Control")) {
    const contentType = c.res.headers.get("Content-Type") ?? "";

    if (path === "/health") {
      c.header("Cache-Control", "no-store");
    } else if (contentType.startsWith("text/html")) {
      c.header("Cache-Control", "private, no-cache");
      c.header("Vary", "Cookie", { append: true });
    } else {
      c.header("Cache-Control", "no-cache");
    }
  }
});

if (ssrConfig.dev) {
  app.get("/_ssr/_ping", (c) => c.text("ok"));
  app.get(
    "/_ssr/_reload",
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": connected\n\n"));
            const interval = setInterval(() => {
              try {
                controller.enqueue(new TextEncoder().encode(": ping\n\n"));
              } catch {
                clearInterval(interval);
              }
            }, 5000);
          },
        }),
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
      ),
  );
}
app.get("/_ssr/:filename{[a-zA-Z0-9._-]+\\.js(?:\\.map)?}", async (c) => {
  const filename = c.req.param("filename");
  const file = Bun.file(join(ssrRoot, "_ssr", filename));
  if (!(await file.exists())) return c.notFound();
  return new Response(file, {
    headers: {
      "Content-Type": filename.endsWith(".map") ? "application/json; charset=utf-8" : "application/javascript; charset=utf-8",
      "Cache-Control": ssrConfig.dev ? "no-cache" : "public, max-age=31536000, immutable",
    },
  });
});
app.get("/", (c) => c.redirect("/en", 302));
app.get("/en", (c) =>
  html(() => <HomePage />, {
    title: "Cloud — the open-source application platform",
    description: "Shared application building blocks, operated on your infrastructure.",
    path: "/en",
    theme: themeFromRequest(c.req.raw),
  }),
);
app.get("/ui", (c) =>
  html(() => <UiCatalogPage />, {
    title: "Cloud UI — live component catalog",
    description: "Live examples of the shared components exported by Cloud.",
    path: "/ui",
    theme: themeFromRequest(c.req.raw),
    styles: ["/assets/generated/tabler-icons.min.css", "/assets/generated/cloud-ui.css", "/assets/ui-catalog.css"],
  }),
);
app.get("/ui/:component", (c) => {
  const component = c.req.param("component") as CatalogComponent;
  const componentName = catalogComponents[component];
  if (!componentName) return c.notFound();
  return html(() => <UiCatalogPage focus={component} />, {
    title: `${componentName} — Cloud UI`,
    description: `Live ${componentName} example from the shared Cloud component package.`,
    path: `/ui/${component}`,
    theme: themeFromRequest(c.req.raw),
    styles: ["/assets/generated/tabler-icons.min.css", "/assets/generated/cloud-ui.css", "/assets/ui-catalog.css"],
  });
});
app.get("/assets/:path{.+}", (c) => serveAsset(c.req.param("path")));
app.get("/robots.txt", (c) => fetchFibelPath(c.req.raw, "/docs/robots.txt"));
app.get("/sitemap.xml", (c) => fetchFibelPath(c.req.raw, "/docs/sitemap.xml"));
app.all("/docs", (c) => fibel.fetch(c.req.raw));
app.all("/docs/*", (c) => fibel.fetch(c.req.raw));
app.get("/health", (c) => c.json({ status: "ok", surfaces: ["/en", "/docs/en", "/ui"] }));
app.get("/humans.txt", (c) =>
  c.text(`Cloud
Open-source application platform
Runtime: Bun
Docs: Fibel
UI: SolidJS

Try: g then d, or g then u
`),
);
app.notFound((c) => c.text("Not found", 404));

export default {
  port: Number(process.env.PORT ?? 4187),
  fetch: app.fetch,
};
