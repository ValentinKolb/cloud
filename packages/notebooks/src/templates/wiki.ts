import type { NotebookTemplate } from "./types";

const addFactScript = `kit.ui.card(
  kit.ui.heading("Capture fact", 3),
  kit.ui.text("Add a sourced fact to this wiki home. Move it into Facts when it becomes durable."),
  kit.ui.button("Add fact", async () => {
    const values = await kit.ui.prompt.form({
      title: "New fact",
      icon: "ti ti-bulb",
      submitText: "Add",
      fields: {
        claim: { type: "textarea", label: "Claim", required: true, rows: 3 },
        source: { type: "text", label: "Source", placeholder: "URL, book, paper, interview..." },
        confidence: { type: "select", label: "Confidence", options: ["low", "medium", "high"], default: "medium" },
      },
    });
    if (!values) return;
    await kit.note.appendContent(\`\\n## Fact — \${new Date().toLocaleDateString()}\\n\\n- Claim: \${values.claim}\\n- Source: \${values.source || "unknown"}\\n- Confidence: \${values.confidence}\\n- Status: #fact #triage\\n\`);
    kit.ui.toast("Fact captured", { variant: "success" });
  }, { icon: "ti ti-plus" }),
).show();`;

export const topicWikiTemplate: NotebookTemplate = {
  id: "topic-wiki",
  name: "Topic wiki",
  description: "A source-backed research wiki with facts, concepts, timeline, people, glossary, and open questions.",
  icon: "ti ti-world-search",
  notebookName: "Research Wiki",
  notebookDescription: "Source-backed notes for learning a topic deeply without losing evidence.",
  scriptsEnabled: true,
  homepageNoteKey: "home",
  notes: () => [
    {
      key: "home",
      title: "Wiki Home",
      content: (c) => `# Wiki Home

Example topic: **Urban Climate Adaptation**. Rename this note and replace the sample facts with your topic.

\`\`\`script
${addFactScript}
\`\`\`

## Navigation

- ${c.link("facts")}
- ${c.link("concepts")}
- ${c.link("timeline")}
- ${c.link("people")}
- ${c.link("sources")}
- ${c.link("open-questions")}
- ${c.link("glossary")}

## Working rules

- Facts need a source and confidence.
- Concepts should link to at least one fact or source.
- Questions stay open until a source answers them.
`,
    },
    {
      key: "facts",
      title: "Facts",
      content: (c) => `# Facts

#fact

## Urban heat islands

- Claim: Dense paved areas can stay significantly warmer than nearby vegetated areas.
- Evidence: ${c.link("sources.ipcc", "IPCC synthesis source")} and city heat mapping studies.
- Confidence: high
- Related: ${c.link("concepts.heat-island", "Urban heat island")}

## Tree canopy

- Claim: Shade and evapotranspiration make urban tree canopy a practical local cooling intervention.
- Evidence: municipal adaptation plans and peer-reviewed urban forestry studies.
- Confidence: high
- Related: ${c.link("concepts.tree-canopy", "Tree canopy")}

## Stormwater

- Claim: Permeable surfaces reduce runoff pressure during heavy rainfall.
- Evidence: green infrastructure manuals.
- Confidence: medium
`,
    },
    {
      key: "concepts",
      title: "Concepts",
      content: "# Concepts\n\nConcept notes should define terms and link evidence.\n",
      children: [
        {
          key: "concepts.heat-island",
          title: "Urban heat island",
          content: (c) => `# Urban heat island

#concept

Cities can retain more heat than surrounding areas because of material choices, geometry, traffic, and reduced vegetation.

Related evidence: ${c.link("facts")}
`,
        },
        {
          key: "concepts.tree-canopy",
          title: "Tree canopy",
          content: (c) => `# Tree canopy

#concept

Tree canopy is the layer of leaves and branches that shades streets and buildings.

Related evidence: ${c.link("facts")}
`,
        },
      ],
    },
    {
      key: "timeline",
      title: "Timeline",
      content: `# Timeline

| Date | Event | Source | Notes |
|---|---|---|---|
| 2015 | Paris Agreement | UNFCCC | Global climate policy context |
| 2021 | IPCC AR6 starts publishing | IPCC | Updated risk framing |
| 2024 | Local heat action plans expand | City reports | Adaptation becomes operational |
`,
    },
    {
      key: "people",
      title: "People & Organizations",
      content: `# People & Organizations

| Name | Role | Link | Notes |
|---|---|---|---|
| City planning office | Local implementation |  | Permits, zoning, public space |
| Public health department | Heat response |  | Vulnerable population planning |
| Neighborhood groups | Local feedback |  | Ground truth and adoption |
`,
    },
    {
      key: "sources",
      title: "Sources",
      content: "# Sources\n\nKeep source notes as children. Link facts back to the relevant source.\n",
      children: [
        {
          key: "sources.ipcc",
          title: "IPCC synthesis source",
          content: `# IPCC synthesis source

#source

## Citation

IPCC synthesis reports and assessment chapters relevant to cities, heat, and adaptation.

## Notes

- Use for high-level risk framing.
- Do not treat as a local implementation manual.
`,
        },
      ],
    },
    { key: "open-questions", title: "Open Questions", content: "# Open Questions\n\n#question\n\n- [ ] What interventions are cheapest per degree of local cooling?\n- [ ] Which neighborhoods are most exposed?\n" },
    { key: "glossary", title: "Glossary", content: "# Glossary\n\n| Term | Definition | Links |\n|---|---|---|\n| Adaptation | Adjustments that reduce climate risk |  |\n| Heat island | Warmer urban area compared with surroundings |  |\n" },
  ],
};
