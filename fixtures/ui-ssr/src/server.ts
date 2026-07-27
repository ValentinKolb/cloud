import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { config, routes } from "./config";
import page from "./page";

const stylesPath = fileURLToPath(import.meta.resolve("@k2b/ui/styles.css"));
const assetRoot = dirname(stylesPath);
const styles = [
  readFileSync(stylesPath, "utf8"),
  readFileSync(fileURLToPath(import.meta.resolve("@k2b/ui/icons/tabler.css")), "utf8"),
].join("\n");
const fontAssets = new Map(
  readdirSync(assetRoot)
    .filter((file) => [".woff2", ".woff", ".ttf"].includes(extname(file)))
    .map((file) => [file, readFileSync(`${assetRoot}/${file}`)]),
);

export const app = new Hono()
  .route("/_ssr", routes(config))
  .get("/styles.css", (context) => context.body(styles, 200, { "Content-Type": "text/css; charset=utf-8" }))
  .get("/:asset", (context) => {
    const asset = fontAssets.get(context.req.param("asset"));
    if (!asset) return context.notFound();

    return context.body(asset, 200, {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  })
  .get("/", ...page);

export default {
  port: Number(process.env.PORT ?? 4317),
  fetch: app.fetch,
};
