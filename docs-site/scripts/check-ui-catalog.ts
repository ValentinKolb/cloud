import { uiLabDocs } from "../../packages/ui-lab/src/frontend/docs/registry";
import { uiCatalogEntries } from "../src/ui/catalog";
import { catalogContexts } from "../src/ui/context";
import { demoSectionLoaders } from "../src/ui/demo-sections";

const expectedIds = uiLabDocs
  .filter((section) => section.id !== "ai")
  .flatMap((section) => section.pages.map((page) => `${page.section}/${page.slug}`))
  .sort();
const catalogIds = uiCatalogEntries.map((entry) => entry.id).sort();
const contextIds = Object.keys(catalogContexts).sort();

const duplicates = catalogIds.filter((id, index) => catalogIds.indexOf(id) !== index);
const missingPages = expectedIds.filter((id) => !catalogIds.includes(id));
const unknownPages = catalogIds.filter((id) => !expectedIds.includes(id));
const missingContext = expectedIds.filter((id) => !contextIds.includes(id));
const staleContext = contextIds.filter((id) => !expectedIds.includes(id));
const incompleteContext = uiCatalogEntries
  .filter(
    (entry) =>
      !entry.context.startsWith("# ") ||
      !entry.context.includes("## Use ") ||
      !entry.context.includes("## Import") ||
      !entry.context.includes("## Accessibility") ||
      !entry.context.includes("## Runtime") ||
      !entry.context.includes("## Example"),
  )
  .map((entry) => entry.id);
const agentOnlyHeadings = uiCatalogEntries
  .filter((entry) => entry.context.includes("## For agents"))
  .map((entry) => entry.id);
const fallbackContext = uiCatalogEntries
  .filter((entry) =>
    [
      "The preview below covers",
      "Each card contains the exact TSX",
      "The preview below uses the current repository source",
      "Loading repository examples",
    ].some((phrase) => entry.context.includes(phrase)),
  )
  .map((entry) => entry.id);
const deprecatedPages = ["input/date-time", "layout/dock-workspace"];
const undocumentedDeprecations = deprecatedPages.filter(
  (id) => !uiCatalogEntries.find((entry) => entry.id === id)?.context.includes("> **Deprecated:**"),
);
const demoIds = (
  await Promise.all(
    Object.entries(demoSectionLoaders).map(async ([section, load]) =>
      Object.keys((await load()).default).map((slug) => `${section}/${slug}`),
    ),
  )
)
  .flat()
  .sort();
const missingDemos = expectedIds.filter((id) => !demoIds.includes(id));
const unknownDemos = demoIds.filter((id) => !expectedIds.includes(id));

const uiCatalogPageSource = await Bun.file(new URL("../src/ui/UiCatalogPage.tsx", import.meta.url)).text();
const islandFiles = {
  input: "InputCatalogDemo.island",
  actions: "ActionsCatalogDemo.island",
  layout: "LayoutCatalogDemo.island",
  surfaces: "SurfacesCatalogDemo.island",
  feedback: "FeedbackCatalogDemo.island",
  content: "ContentCatalogDemo.island",
  widgets: "WidgetsCatalogDemo.island",
} as const;
const missingSsrSections = Object.entries(islandFiles)
  .filter(([, island]) => !uiCatalogPageSource.includes(`./${island}`))
  .map(([section]) => section);
const clientOnlyCatalogDemo = uiCatalogPageSource.includes(".client");

const failures = [
  ["Duplicate catalog pages", duplicates],
  ["UI Lab pages missing from the Fibel catalog", missingPages],
  ["Unknown Fibel catalog pages", unknownPages],
  ["Pages without explicit Markdown context", missingContext],
  ["Markdown context without a page", staleContext],
  ["Pages with incomplete Markdown context", incompleteContext],
  ["Pages with agent-only headings", agentOnlyHeadings],
  ["Pages using generated fallback copy", fallbackContext],
  ["Deprecated pages without a callout", undocumentedDeprecations],
  ["Pages without a live demo renderer", missingDemos],
  ["Live demo renderers without a page", unknownDemos],
  ["Sections without an SSR island", missingSsrSections],
] as const;

const failed = failures.filter(([, values]) => values.length > 0);
if (failed.length > 0 || clientOnlyCatalogDemo) {
  console.error("UI catalog coverage check failed.");
  for (const [label, values] of failed) {
    console.error(`\n${label}:`);
    for (const value of values) console.error(`- ${value}`);
  }
  if (clientOnlyCatalogDemo) console.error("\nThe catalog page still imports a client-only demo.");
  process.exit(1);
}

const smokeBaseUrl = process.env.CLOUD_UI_CATALOG_URL?.replace(/\/$/, "");
if (smokeBaseUrl) {
  const smokeFailures: string[] = [];
  const queue = [...uiCatalogEntries];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) return;

      const pageUrl = `${smokeBaseUrl}/ui/en/${entry.id}`;
      const pageResponse = await fetch(pageUrl);
      const html = await pageResponse.text();
      const island = html.match(/<solid-island\b[^>]*>([\s\S]*?)<\/solid-island>/);
      if (!pageResponse.ok) smokeFailures.push(`${entry.id}: page returned ${pageResponse.status}`);
      else if (!island || island[1].trim().length === 0) smokeFailures.push(`${entry.id}: empty initial island HTML`);
      else if (html.includes("<solid-client")) smokeFailures.push(`${entry.id}: client-only demo wrapper`);

      const rawResponse = await fetch(`${pageUrl}.md`);
      const markdown = await rawResponse.text();
      if (!rawResponse.ok) smokeFailures.push(`${entry.id}: raw Markdown returned ${rawResponse.status}`);
      else if (markdown.trim() !== entry.context.trim()) smokeFailures.push(`${entry.id}: raw Markdown differs from canonical context`);
    }
  });
  await Promise.all(workers);

  if (smokeFailures.length > 0) {
    console.error("UI catalog HTTP smoke failed.");
    for (const failure of smokeFailures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`UI catalog HTTP smoke passed (${uiCatalogEntries.length} SSR pages and raw Markdown routes).`);
}

console.log(
  `UI catalog coverage check passed (${catalogIds.length} pages across ${new Set(uiCatalogEntries.map((entry) => entry.section)).size} sections).`,
);
process.exit(0);
