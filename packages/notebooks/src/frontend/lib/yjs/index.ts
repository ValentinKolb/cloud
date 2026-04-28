import { getNotebookPresenceColor, notebooksYjs } from "../../../lib/yjs";
import { createYjsProvider } from "./provider";
import type { YjsProviderOptions } from "./provider";

export { createYjsProvider };
export type { YjsProviderOptions };
export { getNotebookPresenceColor, notebooksYjs };

export const yjs = {
  createYjsProvider,
  getNotebookPresenceColor,
  notebooksYjs,
} as const;
