import type { DemoSection } from "./types";

export const demoSectionLoaders: Record<string, () => Promise<{ default: DemoSection }>> = {
  input: () => import("./input"),
  actions: () => import("./actions"),
  layout: () => import("./layout"),
  surfaces: () => import("./surfaces"),
  feedback: () => import("./feedback"),
  content: () => import("./content"),
  widgets: () => import("./widgets"),
};
