import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  defineCapabilities,
  type UniversalSearchInput,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { ok } from "@k2b/stdlib";
import { filesService } from "./service";

const supportsFilesApp = (user: { provider: string; profile: string }) => user.provider === "ipa" && user.profile === "user";

const normalizePath = (path: string): string => (!path || path === "/" ? "/" : path.startsWith("/") ? path : `/${path}`);

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

const TAG_OVERFETCH_MULTIPLIER = 5;
const TAG_OVERFETCH_CAP = 200;

type FileLike = { type: "file" | "directory"; mimeType?: string; name: string };

const TAG_FILTERS: Record<string, (file: FileLike) => boolean> = {
  file: (file) => file.type === "file",
  folder: (file) => file.type === "directory",
  directory: (file) => file.type === "directory",
  image: (file) => file.type === "file" && isImage(file.mimeType),
  pdf: (file) => file.type === "file" && (file.mimeType === "application/pdf" || /\.pdf$/i.test(file.name)),
  excel: (file) => file.type === "file" && (/(spreadsheet|excel|csv)/i.test(file.mimeType ?? "") || /\.(xlsx|xls|csv)$/i.test(file.name)),
};

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const user = context.user;
  if (!user || !supportsFilesApp(user)) return ok({ data: [] });

  const tagPredicates = input.tags
    .map((tag) => TAG_FILTERS[tag])
    .filter((predicate): predicate is (file: FileLike) => boolean => Boolean(predicate));
  if (input.query.length === 0 && tagPredicates.length === 0) return ok({ data: [] });

  const bases = await filesService.base.listResolved({ user });
  if (bases.length === 0) return ok({ data: [] });

  const pattern = input.query.length === 0 ? "**/*" : toPattern(input.query);
  const fetchLimit = tagPredicates.length > 0 ? Math.min(TAG_OVERFETCH_CAP, input.limit * TAG_OVERFETCH_MULTIPLIER) : input.limit;
  const result = await filesService.search.list({ bases, pattern, showHidden: false, limit: fetchLimit });
  if (!result.ok) return ok({ data: [] });

  const matches = (file: FileLike) => tagPredicates.every((predicate) => predicate(file));
  const data: CloudResourceView[] = result.data.results
    .flatMap((group) =>
      group.files.filter(matches).map((file) => {
        const id = `${group.base.type}:${group.base.id}:${file.path}`;
        return {
          ref: { type: file.type === "directory" ? "files.directory" : "files.file", id },
          title: file.name,
          preview: `${group.base.name} • ${file.path}`,
          icon: file.type === "directory" ? "ti ti-folder" : "ti ti-file",
          priority: file.type === "directory" ? 5 : 6,
          metadata: [
            { label: "Type", value: file.type === "directory" ? "Directory" : "File" },
            { label: "Base", value: group.base.name },
            { label: "Path", value: file.path },
          ],
          links: [
            { rel: "open" as const, href: buildFileHref(group.base.type, group.base.id, file.path) },
            ...(file.type === "file" && isImage(file.mimeType)
              ? [{ rel: "preview" as const, href: buildPreviewUrl(group.base.type, group.base.id, file.path) }]
              : []),
          ],
        };
      }),
    )
    .slice(0, input.limit);
  return ok({ data });
};

export const filesCapabilities = defineCapabilities({
  protocolVersion: 1,
  types: {
    file: { title: "File", description: "A file in personal or shared storage.", icon: "ti ti-file" },
    directory: { title: "Directory", description: "A folder in personal or shared storage.", icon: "ti ti-folder" },
  },
  queries: {
    search: {
      title: "Search files",
      description: "Find permission-filtered files and directories across accessible storage bases.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      universalSearch: {
        tags: [
          { tag: "file", title: "Files", description: "Show files only." },
          { tag: "folder", title: "Folders", description: "Show directories only.", aliases: ["directory"] },
          { tag: "image", title: "Images", description: "Show image files only." },
          { tag: "excel", title: "Spreadsheets", description: "Show spreadsheet files such as XLSX, XLS, and CSV." },
          { tag: "pdf", title: "PDF", description: "Show PDF documents only." },
        ],
      },
      run: runSearch,
    },
  },
});
