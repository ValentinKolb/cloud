import { searchParams } from "@valentinkolb/stdlib";

export type NavigatorQuery =
  | { view?: undefined; folder?: undefined; tag?: undefined }
  | { view: "favorites" | "recents"; folder?: undefined; tag?: undefined }
  | { view: "folder"; folder: string; tag?: undefined }
  | { view: "tag"; tag: string; folder?: undefined };

const NAVIGATOR_KEYS = new Set(["view", "folder", "tag"]);

export const parseNavigatorQuery = (params: URLSearchParams): NavigatorQuery => {
  const view = params.get("view");
  if (view === "favorites" || view === "recents") return { view };
  if (view === "folder") {
    const folder = params.get("folder")?.trim();
    if (folder) return { view, folder };
  }
  if (view === "tag") {
    const tag = params.get("tag")?.trim().toLowerCase();
    if (tag) return { view, tag };
  }
  return {};
};

export const hasOnlyNavigatorQuery = (params: URLSearchParams): boolean => [...params.keys()].every((key) => NAVIGATOR_KEYS.has(key));

export const withNavigatorQuery = (href: string, query: NavigatorQuery): string => {
  const [pathname, rawSearch = ""] = href.split("?", 2);
  const search = searchParams.serialize(
    {
      view: query.view,
      folder: query.view === "folder" ? query.folder : undefined,
      tag: query.view === "tag" ? query.tag : undefined,
    },
    new URLSearchParams(rawSearch),
  );
  return `${pathname}${search ? `?${search}` : ""}`;
};
