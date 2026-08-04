import { Hono, type MiddlewareHandler } from "hono";
import { createHelpCatalog, findHelpDocument, resolveAppHelp, searchHelpCatalog } from "../_internal/help-catalog";
import { getApp, getHelp } from "../_internal/registry";
import type { AppRegistryEntry, HelpRegistryEntry } from "../contracts/registry";
import { type AuthContext, auth } from "../server";
import type { HelpDocumentPayload, HelpSearchPayload } from "../shared/help";
import { renderHelpMarkdown } from "../shared/markdown";

export type HelpRouteDependencies = {
  getApp?: (appId: string) => Promise<AppRegistryEntry | null>;
  getHelp?: (appId: string) => Promise<HelpRegistryEntry | null>;
  authenticate?: MiddlewareHandler<AuthContext>;
  renderMarkdown?: (markdown: string) => string;
};

const resolveHelp = async (appId: string, dependencies: HelpRouteDependencies) => {
  const resolved = await resolveAppHelp(appId, { getApp: dependencies.getApp ?? getApp, getHelp: dependencies.getHelp ?? getHelp });
  if (resolved.status === "missing") {
    return Response.json({ code: "APP_UNAVAILABLE", message: `Help for ${appId} is not currently available` }, { status: 404 });
  }
  if (resolved.status === "stale") {
    return Response.json({ code: "HELP_STALE", message: `Help for ${appId} is being refreshed` }, { status: 503 });
  }
  return resolved;
};

export const createHelpRoutes = (dependencies: HelpRouteDependencies = {}) => {
  const renderedByApp = new Map<string, { manifestHash: string; documents: Map<string, string> }>();
  const renderMarkdown = dependencies.renderMarkdown ?? renderHelpMarkdown;
  const renderDocument = (help: HelpRegistryEntry, documentId: string, markdown: string): string => {
    let cached = renderedByApp.get(help.appId);
    if (!cached || cached.manifestHash !== help.manifestHash) {
      cached = { manifestHash: help.manifestHash, documents: new Map() };
      renderedByApp.set(help.appId, cached);
    }
    const html = cached.documents.get(documentId);
    if (html !== undefined) return html;
    const rendered = renderMarkdown(markdown);
    cached.documents.set(documentId, rendered);
    return rendered;
  };

  return new Hono<AuthContext>()
    .use(dependencies.authenticate ?? auth.requireRole("*"))
    .get("/help/v1/:appId/search", async (c) => {
      const resolved = await resolveHelp(c.req.param("appId"), dependencies);
      if (resolved instanceof Response) return resolved;
      const query = c.req.query("q")?.trim().slice(0, 200) ?? "";
      const catalog = createHelpCatalog([resolved.help]);
      const payload: HelpSearchPayload = {
        ids: query ? searchHelpCatalog(catalog, { query, appId: resolved.app.id, limit: 25 }).map((document) => document.documentId) : [],
      };
      return c.json(payload);
    })
    .get("/help/v1/:appId/documents/:documentId", async (c) => {
      const resolved = await resolveHelp(c.req.param("appId"), dependencies);
      if (resolved instanceof Response) return resolved;
      const document = findHelpDocument(createHelpCatalog([resolved.help]), resolved.app.id, c.req.param("documentId"));
      if (!document) return c.json({ code: "HELP_NOT_FOUND", message: "Help document not found" }, 404);
      const payload: HelpDocumentPayload = {
        id: document.documentId,
        title: document.title,
        markdown: document.markdown,
        html: renderDocument(resolved.help, document.documentId, document.markdown),
      };
      return c.json(payload);
    });
};

export type HelpApiType = ReturnType<typeof createHelpRoutes>;
