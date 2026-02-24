/**
 * SpaceContext - Provides shared space data to child island components
 *
 * This context is used WITHIN island components to reduce prop drilling
 * to nested helper components. Each island that needs shared space data
 * should wrap its content with SpaceProvider.
 *
 * Provides:
 * - spaceId, columns, tags (space metadata)
 * - currentUserId (for user-specific actions)
 * - baseUrl (for links that preserve filters)
 */
import { createContext, useContext, type JSX } from "solid-js";
import type { SpaceColumn, SpaceTag } from "@/spaces/contracts";

export type SpaceContextValue = {
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  currentUserId: string;
  /** Base URL for item links (preserves current filters) */
  baseUrl: string;
};

const SpaceCtx = createContext<SpaceContextValue>();

export const SpaceProvider = (props: { value: SpaceContextValue; children: JSX.Element }) => (
  <SpaceCtx.Provider value={props.value}>{props.children}</SpaceCtx.Provider>
);

export const useSpace = (): SpaceContextValue => {
  const ctx = useContext(SpaceCtx);
  if (!ctx) throw new Error("useSpace must be used within SpaceProvider");
  return ctx;
};
