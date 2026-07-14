export type OpenApiApp = {
  id: string;
  name: string;
  description?: string | null;
  openapi?: string | null;
};

export type ApiDocSource = {
  id: string;
  name: string;
  description: string;
  url: string;
};

const isSafeOpenApiUrl = (url: string): boolean => (/^\/(?!\/)/.test(url) || /^https?:\/\//i.test(url));

export const buildApiDocSources = (apps: readonly OpenApiApp[]): ApiDocSource[] => {
  const seen = new Set<string>();
  return apps
    .flatMap((app) => {
      const id = app.id.trim();
      const url = app.openapi?.trim();
      if (!id || !url || seen.has(id) || !isSafeOpenApiUrl(url)) return [];
      seen.add(id);
      return [
        {
          id,
          name: app.name.trim() || id,
          description: app.description?.trim() || "",
          url,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
};

export const buildScalarSources = (apps: readonly OpenApiApp[]) =>
  buildApiDocSources(apps).map((source) => ({
    slug: source.id,
    title: source.name,
    url: source.url,
  }));
