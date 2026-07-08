import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function FaqLayoutHelp() {
  return (
    <Layout.Help
      id="faq-start"
      title="Start"
      icon="ti ti-help-circle"
      description="Public FAQ entries, audiences, Markdown answers, and admin maintenance."
      order={100}
    >
      <DocPage>
        <DocLead>
          FAQ publishes short help entries at `/faq` and lets admins maintain the questions, answers, and audiences behind them.
        </DocLead>

        <DocSection title="Overview" eyebrow="Start here">
          <DocConceptGrid
            items={[
              {
                title: "Entry",
                icon: "ti-message-question",
                text: "One question with one Markdown answer.",
              },
              {
                title: "Audience",
                icon: "ti-users",
                text: "Entries can target logged-out visitors, guest accounts, full users, or a combination of those groups.",
              },
              {
                title: "Public page",
                icon: "ti-world",
                text: "`/faq` shows only entries whose audience matches the current visitor.",
              },
              {
                title: "Admin page",
                icon: "ti-shield",
                text: "`/admin/faq` is admin-only and lists every entry with create, edit, and delete actions.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Admin workflow">
          <DocRows
            items={[
              {
                title: "Create an entry",
                icon: "ti-plus",
                text: "Use New Entry, write the question and Markdown answer, then pick at least one audience.",
              },
              {
                title: "Edit safely",
                icon: "ti-pencil",
                text: "Editing keeps the entry in place and updates only the question, answer, or audiences you save.",
              },
              {
                title: "Delete old content",
                icon: "ti-trash",
                text: "Delete removes the entry from both the admin list and the public FAQ.",
              },
            ]}
          />
        </DocSection>

        <DocNote title="Audience filtering" variant="info">
          Logged-out visitors see anonymous entries. Guest and full-user accounts see entries for their own audience.
        </DocNote>
      </DocPage>
    </Layout.Help>
  );
}
