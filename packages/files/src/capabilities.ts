import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { getSearchUser } from "./actor";
import { filesService } from "./service";

const SEARCH_TAGS = ["file", "folder", "directory", "image", "excel", "pdf"] as const;
const SEARCH_HELP = "Find files and folders in your personal and shared storage.";
const SEARCH_TAG_HELP = [
  { tag: "file", help: "Show files only." },
  { tag: "folder", help: "Show folders only." },
  { tag: "directory", help: "Show folders only (alias of #folder)." },
  { tag: "image", help: "Show image files only." },
  { tag: "excel", help: "Show spreadsheet files only (xlsx, xls, csv)." },
  { tag: "pdf", help: "Show PDF documents only." },
] as const;
const supportsFilesApp = (user: { provider: string; profile: string }) => user.provider === "ipa" && user.profile === "user";

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
  `/api/files/${baseType}/${encodeURIComponent(baseId)}/thumbnail?path=${encodeURIComponent(path)}`;

// Over-fetch multiplier when post-filtering by tag predicates. The filegate
// glob already enforces a hard limit, so a tag-only `**/*` search could see
// the limit fully consumed by non-matching files (e.g. for `#image` the first
// `limit` files happen to all be PDFs). 5× (capped at 200) gives the post-
// filter enough headroom for realistic directory sizes without pushing
// MIME-aware filtering down into the storage layer.
const TAG_OVERFETCH_MULTIPLIER = 5;
const TAG_OVERFETCH_CAP = 200;

type FileLike = { type: "file" | "directory"; mimeType?: string; name: string };

const TAG_FILTERS: Record<string, (f: FileLike) => boolean> = {
  file: (f) => f.type === "file",
  folder: (f) => f.type === "directory",
  directory: (f) => f.type === "directory",
  image: (f) => f.type === "file" && isImage(f.mimeType),
  pdf: (f) => f.type === "file" && (f.mimeType === "application/pdf" || /\.pdf$/i.test(f.name)),
  excel: (f) => f.type === "file" && (/(spreadsheet|excel|csv)/i.test(f.mimeType ?? "") || /\.(xlsx|xls|csv)$/i.test(f.name)),
};

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = getSearchUser(input.ctx);
  if (!supportsFilesApp(user)) return [];

  const tagPredicates = input.tags.map((t) => TAG_FILTERS[t]).filter((p): p is (f: FileLike) => boolean => Boolean(p));

  // Guard against full-tree scans: an empty query without any narrowing tag
  // filter would expand `toPattern("")` to `**/**` and walk every base. With
  // at least one tag predicate, the recursive scan is bounded by the limit
  // and the post-filter discards non-matching entries cheaply.
  if (input.query.length === 0 && tagPredicates.length === 0) return [];

  const bases = await filesService.base.listResolved({ user });
  if (bases.length === 0) return [];

  const pattern = input.query.length === 0 ? "**/*" : toPattern(input.query);

  const fetchLimit = tagPredicates.length > 0 ? Math.min(TAG_OVERFETCH_CAP, input.limit * TAG_OVERFETCH_MULTIPLIER) : input.limit;

  const result = await filesService.search.list({
    bases,
    pattern,
    showHidden: false,
    limit: fetchLimit,
  });

  if (!result.ok) return [];

  const matches = (file: FileLike) => tagPredicates.every((p) => p(file));

  return result.data.results
    .flatMap((group) =>
      group.files.filter(matches).map((file) => ({
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
