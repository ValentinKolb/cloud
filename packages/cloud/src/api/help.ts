import { Hono, type MiddlewareHandler } from "hono";
import type { AppRegistryEntry, HelpRegistryEntry } from "../contracts/registry";
import { getApp, getHelp } from "../_internal/registry";
import { type AuthContext, auth } from "../server";
import type { HelpDocumentPayload, HelpSearchPayload } from "../shared/help";
import { markdownToPlainText, renderHelpMarkdown } from "../shared/markdown";

export type HelpRouteDependencies = {
  getApp?: (appId: string) => Promise<AppRegistryEntry | null>;
  getHelp?: (appId: string) => Promise<HelpRegistryEntry | null>;
  authenticate?: MiddlewareHandler<AuthContext>;
};

type ResolvedHelp = {
  app: AppRegistryEntry;
  help: HelpRegistryEntry;
};

const resolveHelp = async (appId: string, dependencies: HelpRouteDependencies): Promise<ResolvedHelp | Response> => {
  const [app, help] = await Promise.all([(dependencies.getApp ?? getApp)(appId), (dependencies.getHelp ?? getHelp)(appId)]);
  if (!app?.help || !help) {
    return Response.json({ code: "APP_UNAVAILABLE", message: `Help for ${appId} is not currently available` }, { status: 404 });
  }
  if (app.help.manifestHash !== help.manifestHash) {
    return Response.json({ code: "HELP_STALE", message: `Help for ${appId} is being refreshed` }, { status: 503 });
  }
  return { app, help };
};

export const createHelpRoutes = (dependencies: HelpRouteDependencies = {}) =>
  new Hono<AuthContext>()
    .use(dependencies.authenticate ?? auth.requireRole("*"))
    .get("/help/v1/:appId/search", async (c) => {
      const resolved = await resolveHelp(c.req.param("appId"), dependencies);
      if (resolved instanceof Response) return resolved;
      const query = c.req.query("q")?.trim().toLocaleLowerCase().slice(0, 200) ?? "";
      const payload: HelpSearchPayload = {
        ids: query
          ? resolved.help.documents
              .filter((document) =>
                [document.title, document.description, markdownToPlainText(document.markdown)].some((value) =>
                  value?.toLocaleLowerCase().includes(query),
                ),
              )
              .map((document) => document.id)
          : [],
      };
      return c.json(payload);
    })
    .get("/help/v1/:appId/documents/:documentId", async (c) => {
      const resolved = await resolveHelp(c.req.param("appId"), dependencies);
      if (resolved instanceof Response) return resolved;
      const document = resolved.help.documents.find((candidate) => candidate.id === c.req.param("documentId"));
      if (!document) return c.json({ code: "HELP_NOT_FOUND", message: "Help document not found" }, 404);
      const payload: HelpDocumentPayload = {
        id: document.id,
        title: document.title,
        markdown: document.markdown,
        html: renderHelpMarkdown(document.markdown),
      };
      return c.json(payload);
    });

export type HelpApiType = ReturnType<typeof createHelpRoutes>;
