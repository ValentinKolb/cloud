import { createYjsProvider } from "./provider";
import type { YjsProviderOptions } from "./provider";

export { createYjsProvider };
export type { YjsProviderOptions };

export const yjs = {
  createYjsProvider,
} as const;
