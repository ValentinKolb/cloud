import type { NotebookTemplate } from "./types";

const gardenDashboardScript = `const month = new Date().toLocaleString("en", { month: "long" });
const tasks = await kit.notes.search({ tags: ["garden"], limit: 100 });
const visible = tasks
  .filter((note) => note.title.includes(month) || (note.content ?? "").includes(month))
  .slice(0, 8);

kit.ui.card(
  kit.ui.heading(\`\${month} garden focus\`, 3),
  kit.ui.noteList(visible, { emptyText: "No month-specific garden notes yet." }),
).show();`;

export const gardenPlannerTemplate: NotebookTemplate = {
  id: "garden-planner",
  name: "Garden planner",
  description: "Plant catalog, seasonal sowing calendar, bed plans, harvest log, and monthly garden checklists.",
  icon: "ti ti-plant-2",
  notebookName: "Garden Planner",
  notebookDescription: "Plan what to plant, when to sow, where it grows, and what you harvest.",
  scriptsEnabled: true,
  homepageNoteKey: "dashboard",
  notes: () => [
    {
      key: "dashboard",
      title: "Garden Dashboard",
      content: (c) => `# Garden Dashboard

#garden

\`\`\`script
${gardenDashboardScript}
\`\`\`

## Work areas

- ${c.link("plant-catalog")}
- ${c.link("sowing-calendar")}
- ${c.link("beds")}
- ${c.link("harvest-log")}
- ${c.link("recipes")}

## Current priorities

- [ ] Check seedlings twice per week
- [ ] Update the harvest log after each harvest
- [ ] Move plants between "planned", "sown", "planted", and "harvested"
`,
    },
    {
      key: "plant-catalog",
      title: "Plant Catalog",
      content: `# Plant Catalog

#garden #plants

| Plant | Family | Indoor sow | Direct sow | Transplant | Spacing | Harvest | Companions | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| Tomato | Solanaceae | February-March | - | May | 50 cm | July-October | Basil, marigold | Needs support and steady watering |
| Basil | Lamiaceae | March-April | May | May-June | 25 cm | June-September | Tomato | Pinch tips for bushy growth |
| Lettuce | Asteraceae | February-August | March-August | March-September | 25 cm | April-October | Carrot, radish | Succession sow every 2 weeks |
| Carrot | Apiaceae | - | March-July | - | 5 cm | June-November | Onion, lettuce | Keep soil loose |
| Zucchini | Cucurbitaceae | April | May | May-June | 100 cm | July-September | Nasturtium | Heavy feeder |

## Template for new plants

| Plant | Family | Indoor sow | Direct sow | Transplant | Spacing | Harvest | Companions | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
|  |  |  |  |  |  |  |  |  |
`,
    },
    {
      key: "sowing-calendar",
      title: "Sowing Calendar",
      content: `# Sowing Calendar

#garden #calendar

| Month | Sow indoors | Direct sow | Transplant | Harvest | Notes |
|---|---|---|---|---|---|
| February | Tomato, lettuce | - | - | - | Start slowly; light matters |
| March | Basil, lettuce | Carrot, lettuce | - | - | Prepare beds |
| April | Zucchini | Carrot, lettuce | Lettuce | Lettuce | Harden off seedlings |
| May | Basil | Carrot, lettuce, zucchini | Tomato, basil, zucchini | Lettuce | Watch late frost |
| June | Lettuce | Carrot, lettuce | Basil | Lettuce, basil | Mulch beds |
| July | Lettuce | Carrot, lettuce | - | Tomato, zucchini, basil | Water consistently |
| August | Lettuce | Lettuce | - | Tomato, zucchini, carrot | Start fall planning |
| September | - | - | - | Tomato, carrot, basil | Save seeds |
| October | - | - | - | Carrot | Clear spent plants |
`,
    },
    {
      key: "beds",
      title: "Beds",
      content: `# Beds

#garden #beds

## Bed A - Sunny

| Position | Plant | Status | Notes |
|---|---|---|---|
| North | Tomato | planned | Add support |
| Edge | Basil | planned | Companion plant |
| South | Lettuce | planned | Succession sow |

## Bed B - Roots

| Position | Plant | Status | Notes |
|---|---|---|---|
| Rows 1-3 | Carrot | planned | Loose soil |
| Edge | Lettuce | planned | Shade roots |
`,
    },
    {
      key: "harvest-log",
      title: "Harvest Log",
      content: `# Harvest Log

#garden #harvest

| Date | Plant | Amount | Bed | Notes |
|---|---|---:|---|---|
|  |  |  |  |  |

## Totals

Use this note as the durable harvest record. Add quick notes after harvesting; summarize at the end of each month.
`,
    },
    { key: "recipes", title: "Recipes & Uses", content: "# Recipes & Uses\n\n#garden\n\n- Tomato + basil sauce\n- Zucchini fritters\n" },
  ],
};
