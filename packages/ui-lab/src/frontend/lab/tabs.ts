import type { JSX } from "solid-js";

/**
 * The lab is structured as a flat list of thematic tabs. Each tab has
 * an id (used in the URL), a label (rendered in the bar), an optional
 * short description, and a render function that produces all of its
 * DemoCards. Tabs are defined per-file in `./inputs.tsx`, `./surfaces.tsx`,
 * etc., and aggregated into `TABS` by the orchestrator.
 */
export type Tab = {
  id: string;
  label: string;
  description?: string;
  render: () => JSX.Element;
};

export const DEFAULT_TAB_ID = "inputs";
