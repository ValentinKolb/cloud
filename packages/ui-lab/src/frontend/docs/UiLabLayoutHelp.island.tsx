import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function UiLabLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="ui-lab-start"
        title="Start"
        icon="ti ti-palette"
        description="Component showcases, usage examples, navigation, search, and shared documentation primitives."
        order={100}
      >
        <DocPage>
          <DocLead>
            UI Lab is the shared Cloud component showcase. Use it to inspect supported UI primitives, compare states, and copy the code
            shape used by existing Cloud apps.
          </DocLead>

          <DocSection title="Overview" eyebrow="Start here">
            <DocConceptGrid
              items={[
                {
                  title: "Showcase page",
                  icon: "ti-file-description",
                  text: "A focused page for one component family, such as TextInput, AppWorkspace, DataTable, DocCode, or dashboard widgets.",
                },
                {
                  title: "Demo card",
                  icon: "ti-layout-card",
                  text: "The repeated unit on each page. It shows the component, a short description, a package chip, and a TSX example.",
                },
                {
                  title: "Sidebar sections",
                  icon: "ti-layout-sidebar",
                  text: "Components are grouped by AI, Inputs, Actions, Layout, Surfaces, Feedback, Content, and Widgets.",
                },
                {
                  title: "Search",
                  icon: "ti-search",
                  text: "Use the UI Lab search shortcut or sidebar button to find components, aliases, exports, tags, and demo ids.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Common paths">
            <DocRows
              items={[
                {
                  title: "Choose a primitive",
                  icon: "ti-components",
                  text: "Start with the sidebar category that matches the surface you are building: form input, table, layout shell, feedback state, or content display.",
                },
                {
                  title: "Check interaction states",
                  icon: "ti-click",
                  text: "Use the demos to inspect hover, active, loading, empty, error, selected, and dense states before adding app-specific styling.",
                },
                {
                  title: "Copy the code shape",
                  icon: "ti-copy",
                  text: "Use the TSX block as the implementation outline, then replace demo data with app data and mutations.",
                },
                {
                  title: "Match app docs",
                  icon: "ti-file-description",
                  text: "Use Docs Components for global help, technical references, syntax-highlighted examples, and concise app documentation.",
                },
              ]}
            />
          </DocSection>
        </DocPage>
      </Layout.Help>

      <Layout.Help
        id="ui-lab-reference"
        title="Reference"
        icon="ti ti-book"
        description="How UI Lab pages map to exported Cloud UI primitives and implementation decisions."
        order={110}
      >
        <DocPage>
          <DocLead>
            UI Lab is documentation by executable examples. The live component and the adjacent code block should stay aligned when a
            shared primitive changes.
          </DocLead>

          <DocSection title="Page groups">
            <DocRows
              items={[
                {
                  title: "Inputs and actions",
                  icon: "ti-forms",
                  text: "Covers text, markdown, autocomplete, number, date, select, file, boolean, button, menu, and segmented-control patterns.",
                },
                {
                  title: "Layout and surfaces",
                  icon: "ti-layout",
                  text: "Covers AppWorkspace, Panes, settings surfaces, dialogs, access controls, pagination, papers, placeholders, cards, avatars, stats, and calendars.",
                },
                {
                  title: "Feedback and content",
                  icon: "ti-message-circle",
                  text: "Covers info blocks, badges, prompts, toasts, charts, data tables, code, structured data, media previews, templates, docs, and markdown.",
                },
                {
                  title: "Widgets",
                  icon: "ti-layout-dashboard",
                  text: "Shows endpoint-driven WidgetResponse examples for dashboard cards and home-screen widgets.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Maintenance rules">
            <DocRows
              items={[
                {
                  title: "Keep examples current",
                  icon: "ti-refresh",
                  text: "When a shared primitive changes, update the live demo and its TSX example in the same change.",
                },
                {
                  title: "Prefer Cloud primitives",
                  icon: "ti-tool",
                  text: "Use shared components before creating app-local styling for common controls, tables, dialogs, cards, docs, and layout shells.",
                },
                {
                  title: "Document decisions in place",
                  icon: "ti-notes",
                  text: "Add notes to the relevant showcase when a component is deprecated, replaced, or intended only for compatibility.",
                },
              ]}
            />
          </DocSection>

          <DocNote title="Visibility" variant="info">
            UI Lab is a component showcase. If a deployment should not expose it, the app container should not be started.
          </DocNote>
        </DocPage>
      </Layout.Help>
    </>
  );
}
