type OpenApiApp = {
  id: string;
  name: string;
  openapi?: string | null;
};

const isSafeOpenApiUrl = (url: string): boolean => url.startsWith("/") || /^https?:\/\//i.test(url);

export const buildScalarSources = (apps: readonly OpenApiApp[]) => {
  const seen = new Set<string>();
  return apps
    .flatMap((app) => {
      const slug = app.id.trim();
      const url = app.openapi?.trim();
      if (!slug || !url || seen.has(slug) || !isSafeOpenApiUrl(url)) return [];
      seen.add(slug);
      return [{ slug, title: app.name.trim() || slug, url }];
    })
    .sort((a, b) => a.title.localeCompare(b.title));
};
