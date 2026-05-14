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

const localDate = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const monthTitle = (date: Date) => `${pad2(date.getMonth() + 1)} ${monthNames[date.getMonth()]}`;

const shiftDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dailyStarter = (date: Date) => `# ${localDate(date)}

#daily

## Log

- 

## Tasks

- [ ] Review yesterday
- [ ] Pick one priority for today

## Notes


## Links

`;

const createTodayScript = `const pad2 = (value) => String(value).padStart(2, "0");
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const localDate = (date) => \`\${date.getFullYear()}-\${pad2(date.getMonth() + 1)}-\${pad2(date.getDate())}\`;
const monthTitle = (date) => \`\${pad2(date.getMonth() + 1)} \${monthNames[date.getMonth()]}\`;
const dayStarter = (date) => \`# \${localDate(date)}

#daily

## Log

- 

## Tasks

- [ ] Capture the day
- [ ] Plan tomorrow

## Notes


## Links

\`;

let notes = await kit.notes.list();
const findNote = (title, parentId) => notes.find((n) => n.title === title && n.parentId === parentId);
const remember = (note) => {
  notes = notes.filter((n) => n.id !== note.id).concat(note);
  return note;
};
const ensureNote = async (title, parent) => {
  const parentId = parent ? parent.id : null;
  const existing = findNote(title, parentId);
  if (existing) return existing;
  return remember(await kit.notes.create({ title, parentId: parent?.id }));
};
const ensureDay = async (title, parent, content) => {
  const existing = findNote(title, parent.id);
  if (existing) return existing;
  return remember(await kit.notes.create({ title, parentId: parent.id, content }));
};

kit.ui.card(
  kit.ui.heading("Today", 3),
  kit.ui.text("Create or open today's daily note. Year and month notes are created automatically when needed."),
  kit.ui.button("Open today's note", async () => {
    const now = new Date();
    const year = await ensureNote(String(now.getFullYear()), null);
    const month = await ensureNote(monthTitle(now), year);
    const day = await ensureDay(localDate(now), month, dayStarter(now));
    window.location.href = \`/app/notebooks/\${kit.note.notebook.id}/notes/\${day.id}\`;
  }, { variant: "primary", icon: "ti ti-calendar-plus" }),
).show();`;

export const dailyNotesTemplate: NotebookTemplate = {
  id: "daily-notes",
  name: "Daily notes",
  description: "A year/month/day journal with an automatic today-note button, inbox, reviews, and idea capture.",
  icon: "ti ti-calendar-stats",
  notebookName: "Daily Notes",
  notebookDescription: "Journal, inbox, reviews, and lightweight Zettelkasten notes.",
  scriptsEnabled: true,
  homepageNoteKey: "home",
  notes: (ctx: TemplateContext) => {
    const year = ctx.now.getFullYear();
    const samples = [shiftDays(ctx.now, -1), ctx.now];
    return [
      {
        key: "home",
        title: "Home",
        content: (c) => `# Daily Notes

Use this as the command center for daily capture and review.

## Quick actions

\`\`\`script
${createTodayScript}
\`\`\`

## Core areas

- ${c.link("inbox")}
- ${c.link("year.current", String(year))}
- ${c.link("weekly-review")}
- ${c.link("ideas")}
- ${c.link("people")}
- ${c.link("reading-log")}

## Daily rhythm

- Capture rough notes in the daily note.
- Move durable ideas into ${c.link("ideas")}.
- Review open tasks in ${c.link("weekly-review")}.
`,
      },
      {
        key: "inbox",
        title: "Inbox",
        content: `# Inbox

Fast capture for thoughts that do not have a home yet.

- [ ] Process this inbox during the weekly review
`,
      },
      {
        key: "year.current",
        title: String(year),
        content: `# ${year}

Year overview. Each month is a child note; daily notes live below their month.

## Focus

- 

## Themes

- Health:
- Work:
- Learning:
`,
        children: monthNames.map((name, index) => {
          const monthDate = new Date(year, index, 1);
          const monthSamples = samples.filter((sample) => sample.getFullYear() === year && sample.getMonth() === index);
          return {
            key: `month.${index + 1}`,
            title: monthTitle(monthDate),
            content: `# ${monthTitle(monthDate)}

## Monthly focus

- 

## Review

- Wins:
- Lessons:
- Carry forward:
`,
            children: monthSamples.map((sample) => ({
              key: `day.${localDate(sample)}`,
              title: localDate(sample),
              content: dailyStarter(sample),
            })),
          };
        }),
      },
      {
        key: "weekly-review",
        title: "Weekly Review",
        content: `# Weekly Review

## Checklist

- [ ] Review the last seven daily notes
- [ ] Move durable ideas to Ideas
- [ ] Close or reschedule open tasks
- [ ] Choose next week's focus

## Notes

`,
      },
      { key: "ideas", title: "Ideas", content: "# Ideas\n\n#idea\n\n- " },
      { key: "people", title: "People", content: "# People\n\nKeep lightweight notes on people, meetings, and follow-ups.\n" },
      { key: "reading-log", title: "Reading Log", content: "# Reading Log\n\n| Date | Title | Notes |\n|---|---|---|\n" },
    ];
  },
};
