import { getNotebookPresenceColor, notebooksYjs } from "../../../lib/yjs";
import type { YjsProviderOptions } from "./provider";
import { createYjsProvider } from "./provider";

export type { YjsProviderOptions };
export { createYjsProvider, getNotebookPresenceColor, notebooksYjs };

export const yjs = {
  createYjsProvider,
  getNotebookPresenceColor,
  notebooksYjs,
} as const;
