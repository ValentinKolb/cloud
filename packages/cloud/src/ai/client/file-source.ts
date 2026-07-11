/**
 * FileSource adapter over a conversation's VFS routes (/conversations/:id/files).
 * /files is the assistant's editable workspace; /input mirrors what the user
 * sent to the model and stays read-only in the UI. Browser-safe module.
 */
import type { FileSource } from "../../ui/misc/FileBrowser";
import type { FileTreeEntry } from "../../ui/misc/FileTree";
import type { FileViewContent } from "../../ui/misc/FileView";
import type { AiFileStat } from "../files-store";

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

const TEXT_MEDIA_TYPES = new Set(["application/json", "application/yaml", "application/xml", "image/svg+xml", "text/javascript", "text/typescript"]);
const isTextMediaType = (mediaType: string): boolean => mediaType.startsWith("text/") || TEXT_MEDIA_TYPES.has(mediaType);

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
};

export const conversationFileSource = (baseUrl: string, conversationId: string): FileSource => {
  const filesUrl = (suffix = "", params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params).toString()}` : "";
    return `${baseUrl}/conversations/${conversationId}/files${suffix}${query}`;
  };

  const request = async <T>(url: string, init: RequestInit, fallback: string): Promise<T> => {
    const response = await fetch(url, { ...init, headers: init.body instanceof FormData ? undefined : { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(await readError(response, fallback));
    return (await response.json()) as T;
  };

  return {
    async list(): Promise<FileTreeEntry[]> {
      const result = await request<{ files: AiFileStat[] }>(filesUrl(), { method: "GET" }, "Failed to load files");
      return result.files.map((file) => ({
        path: file.path,
        size: file.size,
        mediaType: file.mediaType,
        updatedAt: file.updatedAt,
        badge: file.path.startsWith("/input/") ? "ro" : undefined,
      }));
    },

    async read(path: string): Promise<FileViewContent> {
      const response = await fetch(filesUrl("/content", { path }));
      if (!response.ok) throw new Error(await readError(response, "Failed to load file"));
      const mediaType = response.headers.get("Content-Type")?.split(";")[0]?.trim() || "application/octet-stream";
      const bytes = new Uint8Array(await response.arrayBuffer());
      return isTextMediaType(mediaType)
        ? { encoding: "utf8", content: new TextDecoder().decode(bytes), mediaType }
        : { encoding: "base64", content: bytesToBase64(bytes), mediaType };
    },

    async write(path, content, encoding = "utf8") {
      await request(filesUrl("/content"), { method: "PUT", body: JSON.stringify({ path, content, encoding }) }, "Failed to save file");
    },

    async remove(path) {
      await request(filesUrl("", { path }), { method: "DELETE" }, "Failed to delete file");
    },

    async rename(from, to) {
      await request(filesUrl("/rename"), { method: "POST", body: JSON.stringify({ from, to }) }, "Failed to rename file");
    },

    async upload(dirPath, files) {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        // Uploads from the browser land in the assistant's workspace unless the
        // target is explicitly the uploads area.
        form.append("dir", dirPath.startsWith("/input") ? "/input" : "/files");
        const response = await fetch(filesUrl(), { method: "POST", body: form });
        if (!response.ok) throw new Error(await readError(response, `Failed to upload ${file.name}`));
      }
    },

    downloadHref: (path) => filesUrl("/content", { path }),

    // /input mirrors sent attachments — immutable; new uploads there would
    // desync what the user believes the model received.
    isReadOnly: (path) => !path.startsWith("/files"),
  };
};
