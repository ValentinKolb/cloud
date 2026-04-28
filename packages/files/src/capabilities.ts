import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { filesService } from "./service";

const SEARCH_TAGS = ["file", "folder", "directory", "image", "excel", "pdf"] as const;
const SEARCH_HELP = "Find files and folders in your personal and shared storage.";
const SEARCH_TAG_HELP = [
  { tag: "file", help: "Show files." },
  { tag: "folder", help: "Show folders." },
  { tag: "directory", help: "Show directory results." },
  { tag: "image", help: "Focus on image files." },
  { tag: "excel", help: "Focus on spreadsheet files." },
  { tag: "pdf", help: "Focus on PDF documents." },
] as const;
const supportsFilesApp = (user: { provider: string; profile: string }) => user.provider === "ipa" && user.profile === "user";
const hasAllTags = (requested: string[]) => requested.every((tag) => SEARCH_TAGS.includes(tag as (typeof SEARCH_TAGS)[number]));

const normalizePath = (path: string): string => {
  if (!path || path === "/") return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

const buildFileHref = (baseType: "home" | "group", baseId: string, path: string): string => {
  const normalizedPath = normalizePath(path);

  if (baseType === "home") {
    if (normalizedPath === "/") return "/app/files/home";
    const encodedSegments = normalizedPath
      .slice(1)
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `/app/files/home/${encodedSegments}`;
  }

  if (normalizedPath === "/") return `/app/files/group/${encodeURIComponent(baseId)}`;
  return `/app/files/group/${encodeURIComponent(baseId)}?path=${encodeURIComponent(normalizedPath)}`;
};

const toPattern = (query: string): string => (query.includes("*") || query.includes("?") ? query : `**/*${query}*`);
const isImage = (mimeType?: string) => typeof mimeType === "string" && mimeType.startsWith("image/");
const buildPreviewUrl = (baseType: "home" | "group", baseId: string, path: string) =>
  `/api/app/files/${baseType}/${encodeURIComponent(baseId)}/thumbnail?path=${encodeURIComponent(path)}`;

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (!supportsFilesApp(user)) return [];
  if (input.tags.length > 0 && !hasAllTags(input.tags)) return [];

  const bases = await filesService.base.listResolved({ user });
  if (bases.length === 0) return [];

  const result = await filesService.search.list({
    bases,
    pattern: toPattern(input.query),
    showHidden: false,
    limit: input.limit,
  });

  if (!result.ok) return [];

  return result.data.results
    .flatMap((group) =>
      group.files.map((file) => ({
        id: `${group.base.type}:${group.base.id}:${file.path}`,
        title: file.name,
        href: buildFileHref(group.base.type, group.base.id, file.path),
        preview: `${group.base.name} • ${file.path}`,
        icon: file.type === "directory" ? "ti ti-folder" : "ti ti-file",
        priority: file.type === "directory" ? (5 as const) : (6 as const),
        metadata: [
          { label: "Type", value: file.type === "directory" ? "Directory" : "File" },
          { label: "Base", value: group.base.name },
          { label: "Path", value: file.path },
        ],
        previewUrl: file.type === "file" && isImage(file.mimeType) ? buildPreviewUrl(group.base.type, group.base.id, file.path) : undefined,
      })),
    )
    .slice(0, input.limit);
};

export const filesCapabilities = {
  search: {
    tags: [...SEARCH_TAGS],
    help: SEARCH_HELP,
    tagHelp: [...SEARCH_TAG_HELP],
    run: search,
  },
} as const;
