import { Hono } from "hono";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { HelpDocumentManifest, HelpDocumentPayload, HelpSearchPayload } from "../shared/help";
import { markdownToPlainText, renderHelpMarkdown } from "../shared/markdown";

const metadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  icon: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  order: z.number().int().default(100),
});

type HelpDocument = z.infer<typeof metadataSchema> & {
  markdown: string;
  html: string;
  searchText: string;
};

export type HelpCollection = {
  manifest: readonly HelpDocumentManifest[];
  router: Hono;
  /** Raw Markdown for future agent context and non-UI consumers. */
  getMarkdown: (id: string) => string | undefined;
};

const parseSource = (source: string): HelpDocument => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error("Help documents require YAML frontmatter wrapped in --- markers");

  const metadata = metadataSchema.parse(parseYaml(match[1]!));
  const markdown = match[2]!.trim();
  if (!markdown) throw new Error(`Help document "${metadata.id}" has no body`);

  return {
    ...metadata,
    markdown,
    html: renderHelpMarkdown(markdown),
    searchText: markdownToPlainText(markdown),
  };
};

/**
 * Define one app-owned help corpus. The explicit source list is deliberate:
 * IDs, ordering and ownership stay visible in code; no filesystem scanning or
 * build-time convention is required.
 */
export const defineHelpCollection = (options: { basePath: string; sources: readonly string[] }): HelpCollection => {
  const basePath = options.basePath.replace(/\/$/, "");
  const documents = options.sources.map(parseSource).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  const byId = new Map<string, HelpDocument>();

  for (const document of documents) {
    if (byId.has(document.id)) throw new Error(`Duplicate help document id "${document.id}"`);
    byId.set(document.id, document);
  }

  const searchUrl = `${basePath}/search`;
  const manifest = documents.map<HelpDocumentManifest>(({ id, title, icon, description, order }) => ({
    id,
    title,
    icon,
    description,
    order,
    searchUrl,
    url: `${basePath}/${encodeURIComponent(id)}`,
  }));

  const router = new Hono()
    .get("/search", (context) => {
      const query = context.req.query("q")?.trim().toLocaleLowerCase().slice(0, 200) ?? "";
      const payload: HelpSearchPayload = {
        ids: query
          ? documents
              .filter((document) =>
                [document.title, document.description, document.searchText].some((value) => value?.toLocaleLowerCase().includes(query)),
              )
              .map((document) => document.id)
          : [],
      };
      return context.json(payload);
    })
    .get("/:id", (context) => {
      const document = byId.get(context.req.param("id"));
      if (!document) return context.json({ error: "Help document not found" }, 404);
      const payload: HelpDocumentPayload = {
        id: document.id,
        title: document.title,
        markdown: document.markdown,
        html: document.html,
      };
      return context.json(payload);
    });

  return {
    manifest,
    router,
    getMarkdown: (id) => byId.get(id)?.markdown,
  };
};
