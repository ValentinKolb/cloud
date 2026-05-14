import type { NotebookTemplate } from "./types";

const projectActionsScript = `kit.ui.card(
  kit.ui.heading("Project actions", 3),
  kit.ui.row(
    kit.ui.button("New meeting note", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const notes = await kit.notes.list();
      const meetings = notes.find((n) => n.title === "Meetings" && n.parentId === null);
      if (!meetings) return kit.ui.toast("Meetings note not found", { variant: "error" });
      const title = \`\${today} Meeting\`;
      const existing = notes.find((n) => n.title === title && n.parentId === meetings.id);
      const note = existing ?? await kit.notes.create({
        title,
        parentId: meetings.id,
        content: \`# \${title}\\n\\n#meeting\\n\\n## Agenda\\n\\n- \\n\\n## Notes\\n\\n\\n## Actions\\n\\n- [ ] \\n\`,
      });
      window.location.href = \`/app/notebooks/\${kit.note.notebook.id}/notes/\${note.id}\`;
    }, { icon: "ti ti-calendar-plus" }),
    kit.ui.button("New decision", async () => {
      const notes = await kit.notes.list();
      const decisions = notes.find((n) => n.title === "Decision Log" && n.parentId === null);
      if (!decisions) return kit.ui.toast("Decision Log note not found", { variant: "error" });
      const count = notes.filter((n) => n.parentId === decisions.id).length + 1;
      const title = \`ADR-\${String(count).padStart(3, "0")} New decision\`;
      const note = await kit.notes.create({
        title,
        parentId: decisions.id,
        content: \`# \${title}\\n\\n#decision\\n\\n## Status\\n\\nProposed\\n\\n## Context\\n\\n\\n## Decision\\n\\n\\n## Consequences\\n\\n- \\n\`,
      });
      window.location.href = \`/app/notebooks/\${kit.note.notebook.id}/notes/\${note.id}\`;
    }, { icon: "ti ti-git-branch" }),
  ),
).show();`;

export const projectHubTemplate: NotebookTemplate = {
  id: "project-hub",
  name: "Project hub",
  description: "Project home, roadmap, meetings, decisions, tasks, risks, architecture notes, and release notes.",
  icon: "ti ti-briefcase",
  notebookName: "Project Hub",
  notebookDescription: "A practical operating notebook for a project team.",
  scriptsEnabled: true,
  homepageNoteKey: "home",
  notes: () => [
    {
      key: "home",
      title: "Project Home",
      content: (c) => `# Project Home

\`\`\`script
${projectActionsScript}
\`\`\`

## Navigation

- ${c.link("roadmap")}
- ${c.link("meetings")}
- ${c.link("decision-log")}
- ${c.link("tasks")}
- ${c.link("risks")}
- ${c.link("architecture")}
- ${c.link("release-notes")}

## Current focus

- Goal:
- Owner:
- Target date:

## Health

| Area | Status | Notes |
|---|---|---|
| Scope | green |  |
| Delivery | yellow |  |
| Risk | green |  |
`,
    },
    {
      key: "roadmap",
      title: "Roadmap",
      content: `# Roadmap

| Milestone | Outcome | Status | Target |
|---|---|---|---|
| Discovery | Problem and constraints clear | done |  |
| Prototype | End-to-end path works | active |  |
| Beta | Real user feedback | planned |  |
| Launch | Operational rollout | planned |  |
`,
    },
    {
      key: "meetings",
      title: "Meetings",
      content: "# Meetings\n\nMeeting notes live as children. Use the Project Home action to create the next one.\n",
      children: [
        {
          key: "meeting.kickoff",
          title: "Kickoff Meeting",
          content: `# Kickoff Meeting

#meeting

## Agenda

- Scope
- Roles
- Risks

## Notes

- Define success criteria before implementation.

## Actions

- [ ] Confirm owners
- [ ] Schedule first review
`,
        },
      ],
    },
    {
      key: "decision-log",
      title: "Decision Log",
      content: "# Decision Log\n\nArchitecture and product decisions live as ADR child notes.\n",
      children: [
        {
          key: "adr.001",
          title: "ADR-001 Keep decisions small",
          content: `# ADR-001 Keep decisions small

#decision

## Status

Accepted

## Context

Large decisions are hard to review and easy to misremember.

## Decision

Record decisions as short notes with context, choice, and consequences.

## Consequences

- Easier review
- More links between work and rationale
`,
        },
      ],
    },
    {
      key: "tasks",
      title: "Tasks",
      content: `# Tasks

#todo

| Task | Owner | Status | Due | Link |
|---|---|---|---|---|
| Confirm scope |  | active |  |  |
| Create first prototype |  | planned |  |  |
| Review risks |  | planned |  |  |

## Loose tasks

- [ ] 
`,
    },
    {
      key: "risks",
      title: "Risks",
      content: `# Risks

#risk

| Risk | Impact | Probability | Mitigation | Owner |
|---|---|---|---|---|
| Scope creep | high | medium | Keep roadmap reviewed weekly |  |
| Missing stakeholder feedback | medium | medium | Schedule recurring review |  |
| Integration unknowns | high | low | Spike early |  |
`,
    },
    { key: "architecture", title: "Architecture Notes", content: "# Architecture Notes\n\nUse child notes for diagrams, constraints, and technical tradeoffs.\n" },
    { key: "release-notes", title: "Release Notes", content: "# Release Notes\n\n## Next release\n\n- Added:\n- Changed:\n- Fixed:\n" },
  ],
};
