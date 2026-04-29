import { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";
import { getRuntimeContext } from "@valentinkolb/cloud/ssr";

/**
 * Page router for the API Docs aggregator. Mounted at `/app/api-docs`.
 *
 * Scalar's hono middleware accepts a config-resolver function — we read
 * the runtime registry on every request and emit one `sources` entry per
 * app that opted in via `defineApp({ openapi: "..." })`. New apps appear
 * as soon as they heartbeat into the registry; removing an app drops them
 * out of the switcher on the next reload. No special cases — this file
 * is just a flat filter+map over the registry.
 */
const pages = new Hono().get(
  "/",
  Scalar(async (c) => {
    const runtime = getRuntimeContext(c);
    const sources = runtime.apps
      .flatMap((app) =>
        app.openapi ? [{ slug: app.id, title: app.name, url: app.openapi }] : [],
      )
      .sort((a, b) => a.title.localeCompare(b.title));

    return {
      theme: "saturn",
      pageTitle: "Cloud API Docs",
      hideClientButton: true,
      sources,
    };
  }),
);

export default pages;
