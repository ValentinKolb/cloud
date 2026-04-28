import { Hono } from "hono";
import type { WidgetResponse } from "@valentinkolb/cloud/contracts";
import { quotesService } from "../service";

/**
 * Widget endpoints for the dashboard. Public — no auth gate, mirrors the
 * normal quote endpoint. Returns 200 with a `WidgetResponse` payload that
 * the dashboard renders into a `<Widget>` with one Status block.
 */
const app = new Hono().get("/quote", async (c) => {
  const result = await quotesService.quote.get();
  const body: WidgetResponse = result.ok
    ? {
        title: "Quote of the hour",
        icon: "ti ti-quote",
        blocks: [
          {
            kind: "hero",
            icon: "ti ti-quote",
            tone: "blue",
            title: result.data.text,
            subtitle: `— ${result.data.author}`,
          },
        ],
      }
    : {
        title: "Quote of the hour",
        icon: "ti ti-quote",
        blocks: [
          {
            kind: "hero",
            icon: "ti ti-cloud-off",
            title: "No quote right now",
            subtitle: "Provider unreachable — try again in a minute",
          },
        ],
      };
  return c.json(body);
});

export default app;
