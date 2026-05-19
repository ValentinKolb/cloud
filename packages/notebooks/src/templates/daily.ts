import type { NotebookTemplate, TemplateContext } from "./types";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad2 = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const monthTitle = (date: Date) => `${pad2(date.getMonth() + 1)} ${monthNames[date.getMonth()]}`;

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dailyYearScript = `const year = Number(current.data("year")?.value.year ?? current.title);
const monthNotes = (await nb.search("#month"))
  .filter((note) => Number(note.data("month")?.value.year) === year)
  .sort((a, b) => Number(a.data("month")?.value.month ?? 0) - Number(b.data("month")?.value.month ?? 0));
const dailyNotes = (await nb.search("#daily")).filter((note) => String(note.data("mood")?.value.date ?? "").startsWith(String(year) + "-"));

ui.render(
  ui.heading("Months", 2),
  ui.table(monthNotes.map((note) => {
    const month = String(note.data("month")?.value.month ?? "").padStart(2, "0");
    return {
      Month: note,
      Days: dailyNotes.filter((day) => String(day.data("mood")?.value.date ?? "").startsWith(String(year) + "-" + month + "-")).length,
    };
  }), { emptyText: "No month notes yet." }),
);`;

const dailyMonthScript = `const pad2 = (value) => String(value).padStart(2, "0");
const meta = current.data("month")?.value ?? {};
const year = Number(meta.year ?? new Date().getFullYear());
const month = Number(meta.month ?? new Date().getMonth() + 1);
const prefix = String(year) + "-" + pad2(month) + "-";
const days = (await nb.search("#daily"))
  .filter((note) => String(note.data("mood")?.value.date ?? note.title).startsWith(prefix))
  .sort((a, b) => a.title.localeCompare(b.title));

ui.render(
  ui.heading("Days", 2),
  ui.table(days.map((note) => {
    const mood = note.data("mood")?.value ?? {};
    return {
      Day: note,
      Mood: mood.mood ?? "",
      Energy: mood.energy ?? "",
      Habits: note.todo("habits")?.items ?? [],
      Tasks: note.todo("tasks")?.items ?? [],
    };
  }), { emptyText: "No daily notes in this month yet." }),
);`;

const dailyDashboardScript = `const pad2 = (value) => String(value).padStart(2, "0");
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const localDate = (date) => date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
const monthTitle = (date) => pad2(date.getMonth() + 1) + " " + monthNames[date.getMonth()];
const yearScript = ${JSON.stringify(dailyYearScript)};
const monthScript = ${JSON.stringify(dailyMonthScript)};
const yearStarter = (date) => [
  "# " + date.getFullYear(),
  "",
  "#year",
  "",
  "@year",
  ":::data",
  "year: " + date.getFullYear(),
  ":::",
  "",
  "\`\`\`script",
  yearScript,
  "\`\`\`",
].join("\\n");
const monthStarter = (date) => [
  "# " + monthTitle(date),
  "",
  "#month",
  "",
  "@month",
  ":::data",
  "year: " + date.getFullYear(),
  "month: " + (date.getMonth() + 1),
  ":::",
  "",
  "## Monthly focus",
  "",
  "- Wins:",
  "- Lessons:",
  "- Carry forward:",
  "",
  "\`\`\`script",
  monthScript,
  "\`\`\`",
].join("\\n");
const dayStarter = (date) => [
  "# " + localDate(date),
  "",
  "#daily #journal",
  "",
  "@mood",
  ":::data",
  "date: " + localDate(date),
  "mood: 4",
  "energy: 3",
  "sleep: 7",
  ":::",
  "",
  "@habits",
  "- [ ] Morning walk",
  "- [ ] Deep work block",
  "- [ ] Read for 20 minutes",
  "",
  "@tasks",
  "- [ ] Pick one priority",
  "- [ ] Process captures",
  "- [ ] Write shutdown note",
  "",
  "@notes",
  "## Notes",
  "",
  "- Add short notes here",
].join("\\n");

let allNotes = await nb.list();
const remember = (note) => {
  allNotes = allNotes.filter((item) => item.id !== note.id).concat(note);
  return note;
};
const findNote = (title, parentId) => allNotes.find((note) => note.title === title && note.parentId === parentId);
const ensureNote = async (title, parent, content) => {
  const parentId = parent?.id ?? null;
  const existing = findNote(title, parentId);
  if (existing) return existing;
  return remember(await nb.create({ title, parentId: parent?.id, content }));
};

const dailyNotes = (await nb.search("#daily")).sort((a, b) => a.title.localeCompare(b.title));
const latest = dailyNotes.slice(-7);
const inboxNote = (await nb.search("#inbox"))[0];
const inboxItems = inboxNote?.todo("inbox")?.items ?? [];
const rows = latest.map((note) => {
  const mood = note.data("mood")?.value ?? {};
  return {
    Day: note,
    Mood: mood.mood ?? "",
    Energy: mood.energy ?? "",
    Sleep: mood.sleep ?? "",
    Habits: note.todo("habits")?.items ?? [],
    Tasks: note.todo("tasks")?.items ?? [],
  };
});

ui.render(
  ui.heading("Daily dashboard", 2),
  ui.table(rows, { emptyText: "No daily notes yet." }),
  ui.chart("bar", {
    data: latest.map((note) => {
      const mood = note.data("mood")?.value ?? {};
      return { label: note.title.slice(5), value: Number(mood.energy ?? 0) };
    }),
    title: "Energy in latest daily notes",
    showValues: true,
    height: 180,
  }),
  ui.table(inboxItems.map((item) => ({ Capture: item.content, Done: item.done ? "yes" : "open" })), {
    emptyText: "Inbox is clear.",
  }),
  ui.button("Open today's note", async () => {
    const now = new Date();
    const year = await ensureNote(String(now.getFullYear()), null, yearStarter(now));
    const month = await ensureNote(monthTitle(now), year, monthStarter(now));
    const day = await ensureNote(localDate(now), month, dayStarter(now));
    window.location.href = "/app/notebooks/" + current.notebook.id + "/notes/" + day.id;
  }, { variant: "primary", icon: "ti ti-calendar-plus" }),
  ui.button("Make weekly review", async () => {
    const doneTasks = latest.flatMap((note) => note.todo("tasks")?.items ?? []).filter((item) => item.done).length;
    const openTasks = latest.flatMap((note) => note.todo("tasks")?.items ?? []).filter((item) => !item.done).length;
    const avgEnergy = latest.length
      ? Math.round(latest.reduce((sum, note) => sum + Number(note.data("mood")?.value.energy ?? 0), 0) / latest.length)
      : 0;
    await current.section("review")?.append(
      "\\n## Review " + new Date().toISOString().slice(0, 10) +
        "\\n\\n- Notes reviewed: " + latest.length +
        "\\n- Done tasks: " + doneTasks +
        "\\n- Open tasks: " + openTasks +
        "\\n- Average energy: " + avgEnergy +
        "\\n- Carry forward: " + inboxItems.filter((item) => !item.done).slice(0, 3).map((item) => item.content).join("; ") +
        "\\n",
    );
    ui.toast("Review added below", { variant: "success" });
  }, { icon: "ti ti-clipboard-check" }),
);`;

const dayContent = (date: Date, mood: number, energy: number, sleep: number, doneHabits: number, doneTasks: number) => {
  const habits = ["Morning walk", "Deep work block", "Read for 20 minutes"];
  const tasks = ["Pick one priority", "Process captures", "Write shutdown note"];
  return `# ${localDate(date)}

#daily #journal

@mood
:::data
date: ${localDate(date)}
mood: ${mood}
energy: ${energy}
sleep: ${sleep}
:::

@habits
${habits.map((item, index) => `- [${index < doneHabits ? "x" : " "}] ${item}`).join("\n")}

@tasks
${tasks.map((item, index) => `- [${index < doneTasks ? "x" : " "}] ${item}`).join("\n")}

@notes
## Notes

- Keep the note short enough to write every day.
- Mark tasks and habits; the dashboard reads them automatically.
`;
};

export const dailyNotesTemplate: NotebookTemplate = {
  id: "daily-notes",
  name: "Daily Journal",
  description: "A lightweight daily journal with dynamic day creation, inbox triage, habits, tasks, and weekly review.",
  icon: "ti ti-calendar-stats",
  notebookName: "Daily Journal",
  notebookDescription: "Daily notes, inbox, and a script dashboard that reads real mood, habits, and tasks.",
  scriptsEnabled: true,
  homepageNoteKey: "home",
  notes: (ctx: TemplateContext) => {
    const today = ctx.now;
    const yesterday = shiftDays(ctx.now, -1);
    const year = today.getFullYear();
    const month = monthTitle(today);
    return [
      {
        key: "home",
        title: "Home",
        content: (c) => `# Daily Journal

:::success
Start here. The dashboard reads your daily notes and the button creates the right year, month, and day note when needed.
:::

\`\`\`script
${dailyDashboardScript}
\`\`\`

@review
## Review

- Use the weekly review button after a few daily notes.

## Maintenance rule

Do not maintain day or month indexes by hand. The month and year notes generate their tables from the daily note data.
`,
      },
      {
        key: "inbox",
        title: "Inbox",
        content: `# Inbox

#inbox

@inbox
- [ ] Order replacement notebook sleeves before the current batch runs out
- [ ] Draft a short note about the native hedge idea for the garden
- [x] Ask Anna whether Friday still works for coffee
- [ ] Look up one book on deliberate practice
- [ ] Turn the recipe pantry matcher into a reusable script idea

@triage
| Capture | Action | Status |
|---|---|---|
| Native hedge idea | Move to garden planner | next review |
| Coffee with Anna | Calendar | scheduled |
| Deliberate practice book | Research | waiting |

:::info
Inbox entries should be cheap. Review decides what survives.
:::
`,
      },
      {
        key: "year.current",
        title: String(year),
        content: `# ${year}

#year

@year
:::data
year: ${year}
:::

@yearFocus
:::data
health: steady sleep and walking
work: fewer active projects
learning: gardens, cooking, knowledge systems
relationships: warmer check-ins
:::

## Year notes

- Keep the structure useful, not perfect.
- Add month notes only when you need them.

\`\`\`script
${dailyYearScript}
\`\`\`
`,
        children: [
          {
            key: "month.current",
            title: month,
            content: `# ${month}

#month

@month
:::data
year: ${year}
month: ${today.getMonth() + 1}
:::

## Monthly focus

- Wins:
- Lessons:
- Carry forward:

\`\`\`script
${dailyMonthScript}
\`\`\`
`,
            children: [
              {
                key: "day.yesterday",
                title: localDate(yesterday),
                content: dayContent(yesterday, 4, 3, 7, 2, 2),
              },
              {
                key: "day.today",
                title: localDate(today),
                content: dayContent(today, 3, 4, 6.5, 1, 1),
              },
            ],
          },
        ],
      },
    ];
  },
};
