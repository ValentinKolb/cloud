import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocCode, DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { For } from "solid-js";

type Step = {
  title: string;
  text: string;
};

const spacesSearchHighlight = highlight.compile(
  [
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"/ },
    { kind: "keyword", match: /#[A-Za-z0-9_-]+/ },
    { kind: "placeholder", match: /@\w+|<[^>\n]+>/ },
    { kind: "identifier", match: /[A-Za-z_][A-Za-z0-9_.-]*/ },
  ],
  { classPrefix: "doc-token-" },
);

const SearchSnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={spacesSearchHighlight} copy />
);

const StepList = (props: { items: Step[] }) => (
  <ol class="space-y-3">
    <For each={props.items}>
      {(item, index) => (
        <li class="grid grid-cols-[1.75rem_1fr] gap-3">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            {index() + 1}
          </span>
          <span>
            <span class="font-semibold text-primary">{item.title}</span>
            <span class="mt-0.5 block text-dimmed">{item.text}</span>
          </span>
        </li>
      )}
    </For>
  </ol>
);

const StartTab = () => (
  <DocPage>
    <DocLead>
      Spaces is for shared work that needs tasks, events, lists, assignees, comments, and lightweight planning. It keeps day-to-day work in
      one place without forcing every team into a database model.
    </DocLead>

    <DocSection title="Mental model" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "Space",
            icon: "ti-layout-sidebar",
            text: "One work area for a team, project, household, class, or recurring process.",
          },
          {
            title: "Item",
            icon: "ti-list-details",
            text: "The basic unit of work. An item is either a task with a deadline or an event with a schedule.",
          },
          {
            title: "Task",
            icon: "ti-checkbox",
            text: "Work with status, priority, assignees, deadline, tags, description, and comments.",
          },
          {
            title: "Event",
            icon: "ti-calendar-event",
            text: "A scheduled item shown in calendar views and optional calendar exports.",
          },
          {
            title: "View",
            icon: "ti-filter",
            text: "The current way to see the same items as list, table, Kanban, or calendar.",
          },
          {
            title: "Tags",
            icon: "ti-tags",
            text: "Lightweight labels for grouping work across assignees, deadlines, schedules, and views.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <StepList
        items={[
          {
            title: "Create a space",
            text: "Name it after the shared work area, not a single task. Examples: Product Launch, Office Move, Weekly Planning.",
          },
          {
            title: "Add real items",
            text: "Create a few tasks or events before tuning views. Real work shows which statuses, tags, and assignees matter.",
          },
          {
            title: "Choose views",
            text: "Use list or table for scanning, Kanban for status flow, and calendar for scheduled work.",
          },
          {
            title: "Share with the right people",
            text: "Invite users or groups once the structure is clear enough that they can act without extra explanation.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="When Spaces fits">
      Use Spaces when people need a clear shared operating surface. Use Grids when records need typed fields, relations, forms, dashboards,
      formulas, exports, or automations.
    </DocNote>
  </DocPage>
);

const ViewsTab = () => (
  <DocPage>
    <DocLead>
      Views let the same work appear in the shape that fits the current job. The view should reduce scanning effort, not hide important
      complexity.
    </DocLead>

    <DocSection title="View modes">
      <DocRows
        items={[
          {
            title: "List",
            icon: "ti-list",
            text: "Best for quick triage, personal work queues, and short operational lists.",
          },
          {
            title: "Table",
            icon: "ti-table",
            text: "Best when people compare assignees, deadlines, status, priority, and tags across many items.",
          },
          {
            title: "Kanban",
            icon: "ti-layout-kanban",
            text: "Best when status flow matters and people need to see work moving from left to right.",
          },
          {
            title: "Calendar",
            icon: "ti-calendar",
            text: "Best for events, deadlines, planning windows, and work that is primarily time-based.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Filter with intent">
      <DocRows
        items={[
          {
            title: "Search",
            icon: "ti-search",
            text: "Use search when you remember a word in the title, notes, or visible item metadata.",
          },
          {
            title: "Chips",
            icon: "ti-adjustments",
            text: "Use filter chips for explicit state such as type, status, assignee, priority, deadline, tags, Kanban column, sort, or grouping.",
          },
          {
            title: "URL state",
            icon: "ti-link",
            text: "Search and filters live in the URL, so shared links and reloads keep the same view.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Global search examples">
      <div class="space-y-3">
        <SearchSnippet title="Find task work" code="#task launch checklist" />
        <SearchSnippet title="Find events" code="#event planning" />
        <SearchSnippet title="Find urgent todos" code="#todo urgent" />
      </div>
    </DocSection>
  </DocPage>
);

const WorkflowTab = () => (
  <DocPage>
    <DocLead>
      Spaces works best when each item has a clear next action. Keep item titles short, put context in notes, and use status or dates to
      make queues obvious.
    </DocLead>

    <DocSection title="Good item structure">
      <DocRows
        items={[
          {
            title: "Title",
            icon: "ti-heading",
            text: "Use a direct action or noun phrase. The title should be readable in a list without opening the item.",
          },
          {
            title: "Assignees",
            icon: "ti-user",
            text: "Assign people when the item needs follow-up. Leave it unassigned when it belongs in a shared queue.",
          },
          {
            title: "Status",
            icon: "ti-progress",
            text: "Use status to show workflow state. Kanban views depend on this being consistent.",
          },
          {
            title: "Due date or event time",
            icon: "ti-calendar-time",
            text: "Use a deadline for tasks and a schedule for events when timing changes what people should do next.",
          },
          {
            title: "Tags",
            icon: "ti-tags",
            text: "Use tags for themes that cut across assignees and status, such as frontend, legal, blocked, or meeting.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Daily workflow">
      <StepList
        items={[
          {
            title: "Open the right view",
            text: "Start from list, table, Kanban, calendar, or the filter state that matches the current work.",
          },
          {
            title: "Update status first",
            text: "Status tells everyone what changed before they open the item.",
          },
          {
            title: "Add context in notes or comments",
            text: "Use comments for discussion. Use notes for current instructions or durable context.",
          },
          {
            title: "Close finished work",
            text: "Move completed items out of active views so open lists stay useful.",
          },
        ]}
      />
    </DocSection>
  </DocPage>
);

const SharingTab = () => (
  <DocPage>
    <DocLead>
      Spaces are collaborative surfaces. Permissions should match the people who are allowed to read, update, or administer the shared work.
    </DocLead>

    <DocSection title="Access and settings">
      <DocRows
        items={[
          {
            title: "Read",
            icon: "ti-eye",
            text: "Lets a user see the space and its items.",
          },
          {
            title: "Write",
            icon: "ti-pencil",
            text: "Lets a user create and update items, comments, status, dates, and assignments.",
          },
          {
            title: "Admin",
            icon: "ti-tool",
            text: "Lets a user change space metadata, access, tags, statuses, calendar export, and deletion settings.",
          },
          {
            title: "Calendar export",
            icon: "ti-calendar-export",
            text: (
              <>
                Use calendar export when people need scheduled work in an external calendar. Treat export URLs like read access to event
                details.
              </>
            ),
          },
        ]}
      />
    </DocSection>

    <DocNote title="Overview help">
      The Spaces overview shows the same help because users may open the help menu before selecting a space.
    </DocNote>
  </DocPage>
);

export default function SpacesLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="spaces-start"
        title="Getting Started"
        icon="ti ti-layout-sidebar"
        description="Core concepts and first setup path."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="spaces-views"
        title="Views & Filters"
        icon="ti ti-filter"
        description="List, table, Kanban, calendar, search, and filter state."
        order={110}
      >
        <ViewsTab />
      </Layout.Help>
      <Layout.Help
        id="spaces-workflow"
        title="Workflow"
        icon="ti ti-route"
        description="How to structure items and keep active work readable."
        order={120}
      >
        <WorkflowTab />
      </Layout.Help>
      <Layout.Help
        id="spaces-sharing"
        title="Sharing & Settings"
        icon="ti ti-lock"
        description="Access levels, settings, and calendar exports."
        order={130}
      >
        <SharingTab />
      </Layout.Help>
    </>
  );
}
