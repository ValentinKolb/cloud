# File browser

`FileBrowserPanel` combines `FileTree` and `FileView` over a `FileSource`. The source owns file paths, content, capabilities, authorization, and transport; the components own browsing and editing UI.

## Use the file browser

Use `FileBrowserPanel` for a complete tree-and-preview workspace. Use `openFileBrowser` when files are a secondary dialog flow.

Use `FileTree` or `FileView` directly only when the page needs a different composition.

## Import

```tsx
import {
  FileBrowserPanel,
  openFileBrowser,
  type FileSource,
} from "@valentinkolb/cloud/ui";
```

## FileSource ownership

Every source implements `list()` and `read(path)`. Optional methods enable matching controls:

```ts
type FileSource = {
  list(): Promise<FileTreeEntry[]>;
  read(path: string): Promise<FileViewContent>;
  write?(path: string, content: string, encoding?: "utf8" | "base64"): Promise<void>;
  remove?(path: string): Promise<void>;
  rename?(from: string, to: string): Promise<void>;
  upload?(dirPath: string, files: File[]): Promise<void>;
  downloadHref?(path: string): string | null;
  isReadOnly?(path: string): boolean;
};
```

Method presence controls affordances; it is not authorization. Every source operation must enforce access on the server.

Set `readOnly` on the panel to hide all mutations even when the source implements them. Use `isReadOnly` for protected paths within an otherwise writable source.

## Selection and refresh

`initialPath` selects a file after the first listing. `onSelectedPathChange` lets the host mirror selection into URL state. `refreshKey` triggers a new listing when external state changes.

The tree derives folders from flat paths and also accepts explicit folder entries for empty directories.

`FileView` chooses a built-in renderer from path, media type, and encoding. Markdown, text, JSON, delimited text, images, PDF, audio, and video have dedicated previews. App-specific renderers registered through `registerFileViewRenderer` run before the built-ins.

## Accessibility

`FileTree` exposes tree and tree-item roles. Arrow keys move through visible entries, Enter selects or expands, and F2 starts rename when that action is available.

Native media controls and labeled preview actions remain available in `FileView`. Do not rely on drag and drop as the only way to move a file.

## Runtime

The browser is an interactive Solid surface. Listing, selection, editing, mutations, previews, dialogs, and uploads require hydration.

Keep the panel at a stable height so the tree and preview scroll internally. The component refetches after its own successful writes.

## Example

Here, `projectFiles` is the owning application's typed API adapter:

```tsx
const source: FileSource = {
  list: () => projectFiles.list(),
  read: (path) => projectFiles.read({ path }),
  write: (path, content, encoding) =>
    projectFiles.write({ path, content, encoding }),
  remove: (path) => projectFiles.remove({ path }),
  downloadHref: (path) =>
    `/api/project/files/download?path=${encodeURIComponent(path)}`,
};

<FileBrowserPanel
  source={source}
  initialPath="/README.md"
  class="h-[32rem]"
/>
```
