import type { NotebookTemplate, TemplateContext } from "./types";

const readingDashboardScript = `const currentYear = String(new Date().getFullYear());
const booksNote = (await nb.search("#books"))[0];
const books = booksNote?.table("books")?.rows ?? [];
const bookNotes = await nb.search("#book");
const pages = [booksNote, ...bookNotes].filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
const queue = current.todo("reading")?.items ?? [];
const byStatus = books.reduce((acc, row) => {
  const key = row.Status || "Unknown";
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
const linkedBook = (row) => bookNotes.find((note) => note.title === row.Title) ?? row.Title;
const reading = books.filter((row) => row.Status === "Reading").map((row) => ({
  Book: linkedBook(row),
  Author: row.Author,
  Started: row.Started,
  Notes: row.Notes,
}));
const finishedThisYear = books.filter((row) => String(row.Finished ?? "").startsWith(currentYear));
const topRated = books
  .filter((row) => Number(row.Rating) > 0)
  .sort((a, b) => Number(b.Rating) - Number(a.Rating))
  .slice(0, 5)
  .map((row) => ({ Book: linkedBook(row), Rating: row.Rating, Status: row.Status }));

ui.render(
  ui.heading("Reading dashboard", 2),
  ui.row(
    ui.text(books.length + " books"),
    ui.text(finishedThisYear.length + " finished this year"),
    ui.text(queue.filter((item) => !item.done).length + " queued"),
  ),
  ui.table(reading, { emptyText: "No current reads." }),
  ui.chart("donut", {
    data: Object.entries(byStatus).map(([label, value]) => ({ label, value })),
    title: "Books by status",
    showLabels: true,
    height: 180,
  }),
  ui.table(topRated, { emptyText: "No ratings yet." }),
  ui.table(queue.map((item) => ({ Queue: item.content, Done: item.done ? "yes" : "open" })), {
    emptyText: "Queue is empty.",
  }),
  ui.heading("Reading pages", 3),
  ui.noteList(pages, { emptyText: "No reading pages yet." }),
  ui.button("Add queue item", async () => {
    const title = await ui.prompt.text("Book title", "", { title: "Add to reading queue", placeholder: "Four Thousand Weeks" });
    if (!title) return;
    await current.todo("reading")?.add(title);
    ui.toast("Added to queue", { variant: "success" });
  }, { icon: "ti ti-book-2" }),
);`;

const readingLibraryScript = `const bookNotes = (await nb.search("#book")).sort((a, b) => a.title.localeCompare(b.title));

ui.render(
  ui.heading("Book notes", 2),
  ui.table(bookNotes.map((note) => {
    const meta = note.data("book")?.value ?? {};
    return {
      Book: note,
      Author: meta.author ?? "",
      Status: meta.status ?? "",
      Rating: meta.rating ?? "",
      Quotes: note.list("quotes")?.items.length ?? 0,
    };
  }), { emptyText: "No book notes yet." }),
);`;

const bookContent = (
  title: string,
  author: string,
  status: string,
  rating: string,
  quotes: string[],
  notes: string[],
) => `# ${title}

#book

@book
:::data
title: ${title}
author: ${author}
status: ${status}
rating: ${rating}
:::

@quotes
${quotes.map((quote) => `- ${quote}`).join("\n")}

@notes
## Notes

${notes.map((note) => `- ${note}`).join("\n")}
`;

export const readingListTemplate: NotebookTemplate = {
  id: "reading-list",
  name: "Reading List",
  description: "A small reading app with a books table, queue, book notes, quotes, ratings, and dashboard charts.",
  icon: "ti ti-books",
  notebookName: "Reading List",
  notebookDescription: "Track books, current reads, quotes, and a queue without turning reading into project management.",
  scriptsEnabled: true,
  homepageNoteKey: "dashboard",
  notes: (ctx: TemplateContext) => [
    {
      key: "dashboard",
      title: "Reading Dashboard",
      content: `# Reading Dashboard

#reading

:::success
Use the books table for structured tracking and book notes for quotes and thoughts. The dashboard reads both.
:::

\`\`\`script
${readingDashboardScript}
\`\`\`

@reading
- [x] Borrow Braiding Sweetgrass from the library
- [ ] Add a nonfiction book about attention
- [ ] Pick one short evening novel
`,
    },
    {
      key: "books",
      title: "Books",
      content: (c) => `# Books

#books

@books
| Title | Author | Status | Rating | Started | Finished | Notes |
|---|---|---|---:|---|---|---|
| The Creative Act | Rick Rubin | Reading |  | ${ctx.now.getFullYear()}-05-01 |  | short daily sections |
| Braiding Sweetgrass | Robin Wall Kimmerer | Want |  |  |  | ecology and attention |
| Four Thousand Weeks | Oliver Burkeman | Done | 5 | ${ctx.now.getFullYear()}-04-01 | ${ctx.now.getFullYear()}-04-14 | useful limits |
| A Psalm for the Wild-Built | Becky Chambers | Done | 4 | ${ctx.now.getFullYear()}-03-11 | ${ctx.now.getFullYear()}-03-15 | calm fiction |
| The Art of Fermentation | Sandor Katz | Reference |  |  |  | dip into chapters |

\`\`\`script
${readingLibraryScript}
\`\`\`

:::info
Keep this table small. If a book needs real notes, create a page and link it from the title.
:::
`,
    },
    {
      key: "creative-act",
      title: "The Creative Act",
      content: bookContent(
        "The Creative Act",
        "Rick Rubin",
        "Reading",
        "",
        [
          "Attention is treated as a practice, not a mood.",
          "Useful reminder: collect broadly, edit later.",
          "Short sections make this easy to read in small sessions.",
        ],
        [
          "Good companion for notebook workflows because it separates capture from judgement.",
          "Try a weekly pass over raw notes instead of editing during capture.",
        ],
      ),
    },
    {
      key: "braiding-sweetgrass",
      title: "Braiding Sweetgrass",
      content: bookContent(
        "Braiding Sweetgrass",
        "Robin Wall Kimmerer",
        "Want",
        "",
        [
          "Read with the garden log open.",
          "Track plant names and practices that connect to local ecology.",
        ],
        [
          "Potential bridge between reading notes and the native hedge plan.",
          "Look for practical observations, not only beautiful passages.",
        ],
      ),
    },
  ],
};
