import mime from "mime";
import { zipSync, strToU8 } from "fflate";

// ============ Download Utilities ============

/**
 * Download content as a file
 * @param content - File content (string, Uint8Array, or ArrayBuffer)
 * @param filename - Name for the downloaded file
 * @param mimeType - MIME type of the content (default: "text/plain")
 */
export const downloadFileFromContent = (
  content: string | Uint8Array | ArrayBuffer | Blob,
  filename: string,
  mimeType: string = "text/plain",
): void => {
  const blob = content instanceof Blob ? content : new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};

// ============ ZIP Utilities ============

export type ZipSource = string | Blob | ArrayBuffer | Uint8Array;

export type ZipFile = {
  filename: string;
  source: ZipSource;
  mimeType?: string;
};

/**
 * Convert various source types to Uint8Array for ZIP compression
 * @param source - Source data to convert
 * @returns Uint8Array representation of the source
 */
const toUint8Array = async (source: ZipSource): Promise<Uint8Array> => {
  if (source instanceof Uint8Array) {
    return source;
  } else if (source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  } else if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  } else {
    return strToU8(source);
  }
};

/**
 * Create a ZIP file from multiple files
 * @param files - Array of files with filename, source data, and optional mimeType
 * @param compressionLevel - Compression level 0-9 (0 = no compression, 9 = max)
 * @returns Uint8Array containing the ZIP file data
 * @example
 * const zipData = await createZip([
 *   { filename: "hello.txt", source: "Hello World" },
 *   { filename: "data.json", source: JSON.stringify({ foo: "bar" }) }
 * ]);
 */
export const createZip = async (files: ZipFile[], compressionLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Promise<Uint8Array> => {
  const filesArray = await Promise.all(
    files.map(async ({ filename, source }) => ({
      filename,
      data: await toUint8Array(source),
    })),
  );

  const zipFiles = filesArray.reduce((acc, { filename, data }) => ({ ...acc, [filename]: data }), {} as Record<string, Uint8Array>);

  return zipSync(zipFiles, { level: compressionLevel });
};

/**
 * Download multiple files as a ZIP archive
 * @param files - Array of files to include in ZIP
 * @param zipFilename - Name for the ZIP file (default: "download.zip")
 * @param compressionLevel - Compression level 0-9 (default: 6)
 * @example
 * await downloadAsZip([
 *   { filename: "image.webp", source: imageBlob },
 *   { filename: "data.json", source: jsonString }
 * ], "my-files.zip");
 */
export const downloadAsZip = async (
  files: ZipFile[],
  zipFilename: string = "download.zip",
  compressionLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6,
): Promise<void> => {
  const zipData = await createZip(files, compressionLevel);
  downloadFileFromContent(zipData, zipFilename, "application/zip");
};

/**
 * Create a download link element
 * @param content - File content
 * @param filename - Name for the downloaded file
 * @param mimeType - MIME type (default: "text/plain")
 * @param linkText - Display text for the link
 * @param className - CSS class for styling
 * @returns HTMLAnchorElement configured for download
 */
export const createDownloadLink = (
  content: BlobPart,
  filename: string,
  mimeType: string = "text/plain",
  linkText: string = "Download",
  className: string = "hover-text",
): HTMLAnchorElement => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.textContent = linkText;
  link.className = className;

  link.addEventListener("click", () => {
    // Clean up the URL after download
    setTimeout(() => URL.revokeObjectURL(url), 100);
  });

  return link;
};

// ============ File Dialogs ============

/**
 * Show native file picker dialog for single file selection
 * @param conf - Configuration object
 * @param conf.accept - HTML input accept format (extensions like ".txt,.pdf" or MIME types like "image/*")
 * @param conf.multiple - Must be false or undefined for single file
 * @returns Promise resolving to selected File or rejecting if cancelled
 * @example
 * const file = await showFileDialog({ accept: ".pdf" });
 */
export function showFileDialog(conf: { accept?: string; multiple?: false }): Promise<File>;

/**
 * Show native file picker dialog for multiple file selection
 * @param conf - Configuration object
 * @param conf.accept - HTML input accept format (extensions like ".txt,.pdf" or MIME types like "image/*")
 * @param conf.multiple - Must be true for multiple files
 * @returns Promise resolving to array of Files or rejecting if cancelled
 * @example
 * const files = await showFileDialog({ accept: ".jpg,.png", multiple: true });
 */
export function showFileDialog(conf: { accept?: string; multiple: true }): Promise<File[]>;

/**
 * Show native file picker dialog implementation
 */
export function showFileDialog(conf?: { accept?: string; multiple?: boolean }): Promise<File | File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";

    if (conf?.accept) {
      input.accept = conf.accept;
    }

    if (conf?.multiple) {
      input.multiple = true;
    }

    input.addEventListener("change", ({ target }) => {
      const files = (target as HTMLInputElement).files;

      document.body.removeChild(input);

      if (!files || files.length === 0) {
        return reject(new Error("No file selected"));
      }

      if (conf?.multiple) {
        resolve(Array.from(files));
      } else {
        resolve(files[0]!);
      }
    });

    input.addEventListener("cancel", () => {
      document.body.removeChild(input);
      reject(new Error("File dialog cancelled"));
    });

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Show native folder picker dialog
 * @param accept - Optional file filter using same format as checkMimeType (e.g., ".csv,.txt", "image/*")
 * @returns Promise resolving to array of Files (filtered if accept provided)
 */
export const showFolderDialog = (accept?: string): Promise<File[]> => {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";

    // Enable directory selection
    input.webkitdirectory = true;
    input.multiple = true;

    input.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      const files = target.files;

      document.body.removeChild(input);

      if (files && files.length > 0) {
        let fileArray = Array.from(files);

        // User-space filtering if accept parameter provided
        if (accept) {
          fileArray = fileArray.filter((file) => checkMimeType(file, accept));

          if (fileArray.length === 0) {
            return reject(new Error("No files matched the accepted types"));
          }
        }

        resolve(fileArray);
      } else {
        reject(new Error("No folder selected"));
      }
    });

    input.addEventListener("cancel", () => {
      document.body.removeChild(input);
      reject(new Error("Folder dialog cancelled"));
    });

    document.body.appendChild(input);
    input.click();
  });
};

// ============ Path & MIME Utilities ============

/**
 * Build safe file paths from template literals with hash for uniqueness
 * @param strings - Template literal strings
 * @param values - Interpolated values
 * @returns Safe file path with cleaned prefix and non cryptographic hash suffix
 * @example
 * const filePath = path`uploads/${userName}/${fileName}.txt`;
 * // "uploads/john-doe-a3f2b1/my-file-c8d4e9.txt"
 */
export const path = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  const sanitize = (segment: string): string => {
    const cleaned = segment
      .toString()
      .replace(/[^\w.-]/g, "-")
      .replace(/^\.+/, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 20); // Limit length for readability

    // Create hash synchronously using a simple hash function
    let hashValue = 0;
    for (let i = 0; i < segment.length; i++) {
      hashValue = (hashValue << 5) - hashValue + segment.charCodeAt(i);
      hashValue = hashValue & hashValue;
    }
    const shortHash = Math.abs(hashValue).toString(36).slice(0, 6);

    return cleaned ? `${cleaned}-${shortHash}` : shortHash;
  };

  let result = "";
  strings.forEach((str, i) => {
    result += str;
    if (i < values.length) {
      const value = values[i];
      result += String(value).split("/").map(sanitize).filter(Boolean).join("/");
    }
  });

  return result
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
};

/**
 * Convert MIME types to file extensions for HTML input accept attribute
 * @param mimeTypes - Comma-separated MIME types (e.g., "image/*,application/pdf")
 * @returns HTML accept string with extensions and MIME types
 * @example
 * mimeTypesToAccept("image/*,application/pdf") // "image/*,.pdf"
 * mimeTypesToAccept("image/jpeg,image/png") // ".jpg,.jpeg,.png,image/jpeg,image/png"
 */
export const mimeTypesToAccept = (mimeTypes: string): string => {
  if (!mimeTypes) return "";

  const results = mimeTypes
    .split(",")
    .map((t) => t.trim())
    .flatMap((t) => {
      if (t.endsWith("/*")) return t;

      const ext = mime.getExtension(t);
      return ext ? [`.${ext}`, t] : t;
    });

  return [...new Set(results)].join(",");
};

/**
 * Check if a file or MIME type matches accepted types
 * @param fileOrType - File object or MIME type string to check
 * @param accept - Comma-separated accepted types (e.g., "image/*", ".pdf", "image/jpeg,image/png")
 * @returns True if the file/type is accepted, false otherwise
 * @example
 * checkMimeType(file, "image/*") // true for any image
 * checkMimeType(file, ".pdf") // true for PDF files
 * checkMimeType("application/pdf", "application/pdf") // true
 * checkMimeType(file, ".pdf,image/*") // true for PDFs or any image
 */
export const checkMimeType = (fileOrType: File | string, accept: string): boolean => {
  if (!accept) return true;

  const isFile = typeof fileOrType !== "string";
  const fileName = isFile ? fileOrType.name.toLowerCase() : "";
  const mimeType = (isFile ? fileOrType.type : fileOrType) || mime.getType(fileName) || "";

  return accept
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .some((p) => {
      if (p.startsWith(".")) {
        return fileName.endsWith(p) || mime.getType(p.slice(1)) === mimeType;
      }
      if (p.endsWith("/*")) {
        return mimeType.startsWith(p.slice(0, -1));
      }
      return mimeType === p;
    });
};

// ============ OPFS (Origin Private File System) ============

/**
 * OPFS wrapper with subfolder support.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
 */
export const OPFS = {
  /**
   * Navigate (recursively) to directory by path segments.
   * @see documentation https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle/getDirectoryHandle
   */
  getDirHandle: async (segments: string[], create: boolean = false): Promise<FileSystemDirectoryHandle> => {
    let dir = await navigator.storage.getDirectory();

    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }

    return dir;
  },

  /**
   * Delete file or directory recursively
   */
  delete: async (name: string): Promise<void> => {
    const segments = name.split("/").filter(Boolean);
    if (segments.length === 0) return;

    const fileName = segments.pop()!;
    const dir = await OPFS.getDirHandle(segments);

    await dir.removeEntry(fileName, { recursive: true });
  },

  /**
   * Write file (creates subdirectories if needed)
   */
  write: async (name: string, data: Uint8Array): Promise<void> => {
    const segments = name.split("/").filter(Boolean);
    const fileName = segments.pop()!;
    const dir = await OPFS.getDirHandle(segments, true);

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data));
    await writable.close();
  },

  /**
   * Read file from path
   */
  read: async (name: string): Promise<Uint8Array | undefined> => {
    try {
      const segments = name.split("/").filter(Boolean);
      const fileName = segments.pop()!;
      const dir = await OPFS.getDirHandle(segments);

      const fileHandle = await dir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return undefined;
    }
  },

  /**
   * List directory contents
   */
  ls: async (dirPath: string = ""): Promise<string[]> => {
    try {
      const segments = dirPath.split("/").filter(Boolean);
      const dir = await OPFS.getDirHandle(segments);

      const entries: string[] = [];
      for await (const entry of dir.values()) {
        entries.push(entry.name + (entry.kind === "directory" ? "/" : ""));
      }
      return entries.sort();
    } catch {
      return [];
    }
  },
};

export const files = {
  downloadFileFromContent,
  createZip,
  downloadAsZip,
  createDownloadLink,
  showFileDialog,
  showFolderDialog,
  path,
  mimeTypesToAccept,
  checkMimeType,
  OPFS,
} as const;
