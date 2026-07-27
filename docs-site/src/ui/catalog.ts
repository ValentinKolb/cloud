import { uiLabDocs, type UiLabDocPage } from "../../../packages/ui-lab/src/frontend/docs/registry";
import { catalogContexts } from "./context";

export type UiCatalogEntry = {
  id: string;
  section: string;
  sectionTitle: string;
  order: number;
  page: UiLabDocPage;
  context: string;
};

const coreSections = uiLabDocs.filter((section) => section.id !== "ai");

export const uiCatalogEntries: UiCatalogEntry[] = coreSections.flatMap((section, sectionIndex) =>
  section.pages.map((page, pageIndex) => {
    const id = `${page.section}/${page.slug}`;
    const context = catalogContexts[id as keyof typeof catalogContexts];
    if (!context) throw new Error(`Missing explicit UI catalog context for ${id}`);

    return {
      id,
      section: section.id,
      sectionTitle: section.title,
      order: (sectionIndex + 1) * 100 + pageIndex,
      page,
      context,
    };
  }),
);

export const uiCatalogSections = coreSections.map((section) => ({
  id: section.id,
  title: section.title,
  count: section.pages.length,
}));
