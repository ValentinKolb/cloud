import { createFibelApp } from "@valentinkolb/fibel";
import { Hono } from "hono";
import { dirname, extname, join, normalize, resolve } from "path";
import fibelConfig from "../fibel.config";
import HomePage from "./home/HomePage";
import { config as ssrConfig, html } from "./ssr";
import UiCatalogPage, { type CatalogComponent } from "./ui/UiCatalogPage";

const fibel = await createFibelApp(fibelConfig);
const app = new Hono();
const catalogComponents: Record<CatalogComponent, string> = {
  "panel-header": "PanelHeader",
  "status-badge": "StatusBadge",
  "stat-grid": "StatGrid",
};
const assetsRoot =
  process.env.NODE_ENV === "production" ? join(import.meta.dir, "assets") : resolve(import.meta.dir, "..", "assets");
const ssrRoot = ssrConfig.dev ? ssrConfig.rootDir ?? process.cwd() : dirname(Bun.main);

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
      "Cache-Control": process.env.NODE_ENV === "production" ? "public, max-age=3600" : "no-cache",
    },
  });
};

app.get("/_ssr/_ping", (c) => c.text("ok"));
app.get("/_ssr/_reload", () =>
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
app.get("/en", () =>
  html(() => <HomePage />, {
    title: "Cloud — the open-source application platform",
    description: "Shared application building blocks, operated on your infrastructure.",
    path: "/en",
  }),
);
app.get("/ui", () =>
  html(() => <UiCatalogPage />, {
    title: "Cloud UI — live component catalog",
    description: "Live examples of the shared components exported by Cloud.",
    path: "/ui",
    styles: [
      "/assets/generated/tabler-icons.min.css",
      "/assets/generated/cloud-ui.css",
      "/assets/ui-catalog.css",
    ],
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
    styles: [
      "/assets/generated/tabler-icons.min.css",
      "/assets/generated/cloud-ui.css",
      "/assets/ui-catalog.css",
    ],
  });
});
app.get("/assets/:path{.+}", (c) => serveAsset(c.req.param("path")));
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
