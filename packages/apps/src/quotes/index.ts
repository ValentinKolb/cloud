import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import { createQuoteWidget } from "./widget";
import { quotesService } from "./service";

const app = {
  meta: {
    id: "quotes",
    name: "Quotes",
    icon: "ti ti-quote",
    description: "Display a cached motivational quote that refreshes hourly.",
  },
  service: quotesService,
  routes: {
    api: new Hono().route("/app/quotes", apiRoutes),
  },
  widgets: [createQuoteWidget],
} satisfies AppFacade<typeof quotesService>;

export default app;
export { quotesService as service };
export type { ApiType } from "./api";
export type { QuotesService, Quote } from "./service";
