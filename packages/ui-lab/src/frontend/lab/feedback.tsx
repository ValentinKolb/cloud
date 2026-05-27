/**
 * Feedback tab — info blocks, badges, chips, tags, status dots,
 * toasts, and the prompts (dialog) API.
 */

import { prompts, toast } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

const promptPeople = [
  { id: "vk", name: "Valentin Kolb", email: "valentin@example.test", team: "Platform" },
  { id: "mr", name: "Mira Roth", email: "mira@example.test", team: "Design Systems" },
  { id: "js", name: "Jonas Stein", email: "jonas@example.test", team: "Operations" },
  { id: "al", name: "Aylin Lee", email: "aylin@example.test", team: "Security" },
];

export const InfoBlocks = () => (
  <DemoCard
    id="info-blocks"
    chip={[
      { kind: "utility", name: "info-block-note" },
      { kind: "utility", name: "info-block-info" },
      { kind: "utility", name: "info-block-success" },
      { kind: "utility", name: "info-block-warning" },
      { kind: "utility", name: "info-block-danger" },
    ]}
    description="Stackable callouts for non-blocking messages. Each variant has a colour-coded background and border."
    code={`<div class="info-block-info">Pure informational note.</div>
<div class="info-block-success">Operation completed.</div>
<div class="info-block-warning">Heads up — review before you continue.</div>
<div class="info-block-danger">Destructive action ahead.</div>
<div class="info-block-note">A neutral note without colour weight.</div>`}
  >
    <div class="space-y-2">
      <div class="info-block-info">Pure informational note.</div>
      <div class="info-block-success">Operation completed.</div>
      <div class="info-block-warning">Heads up — review before you continue.</div>
      <div class="info-block-danger">Destructive action ahead.</div>
      <div class="info-block-note">A neutral note without colour weight.</div>
    </div>
  </DemoCard>
);

export const BadgesDemo = () => (
  <DemoCard
    id="badge"
    chip={{ kind: "utility", name: "badge" }}
    description="Compact label — pair with a `bg-*` and `text-*` colour pair to tone it."
    code={`<span class="badge bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">NEW</span>
<span class="badge bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">BETA</span>
<span class="badge bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">3</span>`}
  >
    <div class="flex items-center gap-2 flex-wrap">
      <span class="badge bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">NEW</span>
      <span class="badge bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">BETA</span>
      <span class="badge bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200">3</span>
      <span class="badge bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">v0.4</span>
    </div>
  </DemoCard>
);

export const ChipsDemo = () => (
  <DemoCard
    id="chip"
    chip={{ kind: "utility", name: "chip" }}
    description="Slightly more substantial than a badge — rounded pill with icon. Used for filter-toolbar tags."
    code={`<span class="chip"><i class="ti ti-tag" /><span>core</span></span>
<span class="chip"><i class="ti ti-user" /><span>assigned</span></span>
<span class="chip bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
  <i class="ti ti-check" />
  <span>verified</span>
</span>`}
  >
    <div class="flex items-center gap-2 flex-wrap">
      <span class="chip">
        <i class="ti ti-tag" />
        <span>core</span>
      </span>
      <span class="chip">
        <i class="ti ti-user" />
        <span>assigned</span>
      </span>
      <span class="chip bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
        <i class="ti ti-check" />
        <span>verified</span>
      </span>
    </div>
  </DemoCard>
);

export const TagsDemo = () => (
  <DemoCard
    id="tag"
    chip={{ kind: "utility", name: "tag" }}
    description="Coloured prose-tag. Pair with `bg-*` / `text-*` tints — the utility itself only sets the radius + padding + font."
    code={`<span class="tag bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">backend</span>
<span class="tag bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">ui</span>
<span class="tag bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">urgent</span>`}
  >
    <div class="flex items-center gap-2 flex-wrap">
      <span class="tag bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">backend</span>
      <span class="tag bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">ui</span>
      <span class="tag bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">urgent</span>
      <span class="tag bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">research</span>
    </div>
  </DemoCard>
);

export const StatusDotsDemo = () => (
  <DemoCard
    id="status-dot"
    chip={{ kind: "utility", name: "status-dot" }}
    description="Tiny health-state circle. Pair with a `bg-*` colour — the utility is shape-only."
    code={`<span class="status-dot bg-emerald-500" />  online
<span class="status-dot bg-amber-500" />     degraded
<span class="status-dot bg-red-500" />        offline
<span class="status-dot bg-zinc-400" />       unknown`}
  >
    <div class="flex items-center gap-4 text-sm">
      <span class="inline-flex items-center gap-2">
        <span class="status-dot bg-emerald-500" />
        online
      </span>
      <span class="inline-flex items-center gap-2">
        <span class="status-dot bg-amber-500" />
        degraded
      </span>
      <span class="inline-flex items-center gap-2">
        <span class="status-dot bg-red-500" />
        offline
      </span>
      <span class="inline-flex items-center gap-2">
        <span class="status-dot bg-zinc-400" />
        unknown
      </span>
    </div>
  </DemoCard>
);

export const ToastDemo = () => (
  <DemoCard
    id="toast"
    chip={{ kind: "component", name: "toast", from: FROM_UI }}
    description="Imperative transient notification — call from any event handler. Variants: default, success, error."
    code={`toast.success("Saved successfully");
toast.error("Could not connect");
toast("Plain message");`}
  >
    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="btn-primary btn-sm" onClick={() => toast.success("Saved successfully")}>
        toast.success
      </button>
      <button type="button" class="btn-danger btn-sm" onClick={() => toast.error("Could not connect")}>
        toast.error
      </button>
      <button type="button" class="btn-secondary btn-sm" onClick={() => toast("Plain message")}>
        toast
      </button>
    </div>
  </DemoCard>
);

export const PromptAlertDemo = () => (
  <DemoCard
    id="prompts-alert"
    chip={{ kind: "component", name: "prompts", from: FROM_UI }}
    variant="alert — single-OK dialog"
    code={`await prompts.alert("Backup completed in 1.4s", { icon: "ti ti-cloud-check" });`}
  >
    <button
      type="button"
      class="btn-primary btn-sm"
      onClick={() => void prompts.alert("Backup completed in 1.4s", { icon: "ti ti-cloud-check" })}
    >
      Open alert
    </button>
  </DemoCard>
);

export const PromptErrorDemo = () => (
  <DemoCard
    id="prompts-error"
    chip={{ kind: "component", name: "prompts.error", from: FROM_UI }}
    variant="error — blocking failure details"
    description="Use for errors that need a deliberate acknowledgement instead of a transient toast."
    code={`await prompts.error("CSV import failed in row 42: invalid email address.", {
  title: "Import failed",
  icon: "ti ti-file-alert",
  confirmText: "Review CSV",
});`}
  >
    <button
      type="button"
      class="btn-danger btn-sm"
      onClick={() =>
        void prompts.error("CSV import failed in row 42: invalid email address.", {
          title: "Import failed",
          icon: "ti ti-file-alert",
          confirmText: "Review CSV",
        })
      }
    >
      Open error
    </button>
  </DemoCard>
);

export const PromptConfirmDemo = () => {
  const [last, setLast] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="prompts-confirm"
      chip={{ kind: "component", name: "prompts", from: FROM_UI }}
      variant="confirm — yes/no question"
      code={`const ok = await prompts.confirm("Delete this item?", { variant: "danger" });`}
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="btn-danger btn-sm"
          onClick={async () => {
            const ok = await prompts.confirm("Delete this item?", { variant: "danger" });
            setLast(ok ? "confirmed" : "cancelled");
          }}
        >
          Open confirm
        </button>
        <span class="text-xs text-dimmed">{last() ?? "—"}</span>
      </div>
    </DemoCard>
  );
};

export const PromptSearchDemo = () => {
  const [selected, setSelected] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="prompts-search"
      chip={{ kind: "component", name: "prompts.search", from: FROM_UI }}
      variant="search — async picker dialog"
      description="Command-palette style picker. The resolver receives the current query and an AbortSignal, then returns labelled items."
      code={`const selected = await prompts.search(
  async ({ query, abortSignal }) => {
    const response = await api.users.search.$get({ query: { q: query } }, { init: { signal: abortSignal } });
    const users = await response.json();

    return users.map((user) => ({
      value: user,
      label: user.name,
      desc: user.email,
      icon: "ti ti-user",
    }));
  },
  {
    title: "Assign owner",
    icon: "ti ti-user-search",
    placeholder: "Search people...",
    minQueryLength: 1,
  },
);`}
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="btn-primary btn-sm"
          onClick={async () => {
            const item = await prompts.search<(typeof promptPeople)[number]>(
              async ({ query }) => {
                const needle = query.trim().toLowerCase();
                if (needle.length === 0) return [];
                await new Promise((resolve) => setTimeout(resolve, 120));
                return promptPeople
                  .filter((person) => `${person.name} ${person.email} ${person.team}`.toLowerCase().includes(needle))
                  .map((person) => ({
                    value: person,
                    label: person.name,
                    desc: `${person.team} · ${person.email}`,
                    icon: "ti ti-user",
                  }));
              },
              {
                title: "Assign owner",
                icon: "ti ti-user-search",
                placeholder: "Search people...",
                minQueryLength: 1,
                size: "small",
                noResultsText: "No matching people.",
              },
            );
            setSelected(item?.value ? `${item.value.name} (${item.value.team})` : "cancelled");
          }}
        >
          Open picker
        </button>
        <span class="text-xs text-dimmed">{selected() ?? "—"}</span>
      </div>
    </DemoCard>
  );
};

export const PromptFormDemo = () => {
  const [result, setResult] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="prompts-form"
      chip={{ kind: "component", name: "prompts", from: FROM_UI }}
      variant="form — declarative typed form dialog"
      description="Single API for typed multi-field forms. Validation built-in, returns a typed object (or null on cancel)."
      code={`const values = await prompts.form({
  title: "Add member",
  icon: "ti ti-user-plus",
  fields: {
    name: { type: "text", required: true, label: "Name" },
    role: { type: "select", label: "Role", options: [
      { id: "admin", label: "Admin" },
      { id: "user", label: "User" },
    ] },
    active: { type: "boolean", label: "Active", default: true },
  },
});`}
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="btn-primary btn-sm"
          onClick={async () => {
            const values = await prompts.form({
              title: "Add member",
              icon: "ti ti-user-plus",
              fields: {
                name: { type: "text", required: true, label: "Name" },
                role: {
                  type: "select",
                  label: "Role",
                  options: [
                    { id: "admin", label: "Admin" },
                    { id: "user", label: "User" },
                  ],
                },
                active: { type: "boolean", label: "Active", default: true },
              },
            });
            setResult(values ? JSON.stringify(values) : "cancelled");
          }}
        >
          Open form
        </button>
        <span class="text-xs text-dimmed font-mono truncate">{result() ?? "—"}</span>
      </div>
    </DemoCard>
  );
};

export const PromptWorkflowFormDemo = () => {
  const [result, setResult] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="prompts-workflow-form"
      chip={{ kind: "component", name: "prompts.form", from: FROM_UI }}
      variant="workflow form — validation, tags, date, boolean"
      description="A fuller form example for operational workflows: info text, multiline details, select options, due date, tags, and confirmation checkbox."
      code={`const request = await prompts.form({
  title: "Create review task",
  icon: "ti ti-clipboard-check",
  confirmText: "Create task",
  fields: {
    intro: { type: "info", content: "Create a task for the next admin review queue." },
    title: { type: "text", required: true, label: "Title", icon: "ti ti-heading" },
    details: { type: "text", multiline: true, lines: 4, label: "Details" },
    priority: {
      type: "select",
      label: "Priority",
      default: "normal",
      options: [
        { id: "low", label: "Low", icon: "ti ti-arrow-down" },
        { id: "normal", label: "Normal", icon: "ti ti-minus" },
        { id: "high", label: "High", icon: "ti ti-arrow-up" },
      ],
    },
    due: { type: "datetime", dateOnly: true, label: "Due date" },
    labels: { type: "tags", label: "Labels", default: ["ops"], maxTags: 4 },
    notify: { type: "boolean", label: "Notify reviewers", default: true },
  },
});`}
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="btn-primary btn-sm"
          onClick={async () => {
            const request = await prompts.form({
              title: "Create review task",
              icon: "ti ti-clipboard-check",
              confirmText: "Create task",
              fields: {
                intro: { type: "info", content: "Create a task for the next admin review queue." },
                title: { type: "text", required: true, label: "Title", icon: "ti ti-heading", default: "Review pending account requests" },
                details: { type: "text", multiline: true, lines: 4, label: "Details", placeholder: "What should reviewers check?" },
                priority: {
                  type: "select",
                  label: "Priority",
                  default: "normal",
                  options: [
                    { id: "low", label: "Low", icon: "ti ti-arrow-down" },
                    { id: "normal", label: "Normal", icon: "ti ti-minus" },
                    { id: "high", label: "High", icon: "ti ti-arrow-up" },
                  ],
                },
                due: { type: "datetime", dateOnly: true, label: "Due date" },
                labels: { type: "tags", label: "Labels", default: ["ops"], maxTags: 4 },
                notify: { type: "boolean", label: "Notify reviewers", default: true },
              },
            });
            setResult(request ? JSON.stringify(request) : "cancelled");
          }}
        >
          Open workflow form
        </button>
        <span class="min-w-0 truncate font-mono text-xs text-dimmed">{result() ?? "—"}</span>
      </div>
    </DemoCard>
  );
};

export const PromptCustomDialogDemo = () => {
  const [result, setResult] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="prompts-custom-dialog"
      chip={{ kind: "component", name: "prompts.dialog", from: FROM_UI }}
      variant="custom dialog — caller-owned actions"
      description="Use `prompts.dialog` when the default form/confirm APIs are too narrow but you still want shared overlay, focus, ESC, and stacking behavior."
      code={`const action = await prompts.dialog<"publish" | "draft">(
  (close) => (
    <div class="flex flex-col gap-3">
      <div class="info-block-warning">Publishing notifies all subscribers.</div>
      <div class="flex justify-end gap-2">
        <button class="btn-secondary btn-sm" onClick={() => close("draft")}>Save draft</button>
        <button class="btn-primary btn-sm" onClick={() => close("publish")}>Publish</button>
      </div>
    </div>
  ),
  { title: "Publish changes", icon: "ti ti-rocket" },
);`}
    >
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="btn-secondary btn-sm"
          onClick={async () => {
            const action = await prompts.dialog<"publish" | "draft">(
              (close) => (
                <div class="flex flex-col gap-3">
                  <div class="info-block-warning">Publishing notifies all subscribers and updates the dashboard widget immediately.</div>
                  <div class="rounded-lg bg-zinc-100 p-3 text-sm text-secondary dark:bg-zinc-900">
                    3 changes · 1 new section · 2 updated links
                  </div>
                  <div class="flex justify-end gap-2">
                    <button type="button" class="btn-secondary btn-sm" onClick={() => close("draft")}>
                      Save draft
                    </button>
                    <button type="button" class="btn-primary btn-sm" onClick={() => close("publish")}>
                      Publish
                    </button>
                  </div>
                </div>
              ),
              { title: "Publish changes", icon: "ti ti-rocket" },
            );
            setResult(action ?? "closed");
          }}
        >
          Open custom dialog
        </button>
        <span class="text-xs text-dimmed">{result() ?? "—"}</span>
      </div>
    </DemoCard>
  );
};

export const PromptSizesDemo = () => (
  <DemoCard
    id="prompts-sizes"
    chip={{ kind: "component", name: "prompts", from: FROM_UI }}
    variant="dialog sizes — small / medium / large"
    code={`await prompts.alert("Small payload", { size: "small" });
await prompts.alert("Medium payload", { size: "medium" });
await prompts.alert("Large payload", { size: "large" });`}
  >
    <div class="flex items-center gap-2 flex-wrap">
      <button type="button" class="btn-secondary btn-sm" onClick={() => void prompts.alert("Small dialog", { size: "small" })}>
        Small
      </button>
      <button type="button" class="btn-secondary btn-sm" onClick={() => void prompts.alert("Medium dialog (default)", { size: "medium" })}>
        Medium
      </button>
      <button
        type="button"
        class="btn-secondary btn-sm"
        onClick={() => void prompts.alert("Large dialog with more breathing room.", { size: "large" })}
      >
        Large
      </button>
    </div>
  </DemoCard>
);

export const PromptBareModalDemo = () => (
  <DemoCard
    id="prompts-bare"
    chip={{ kind: "component", name: "prompts.dialog", from: FROM_UI }}
    variant="bare surface — custom paper layout"
    description="Use surface: bare when the dialog should provide overlay, focus handling, and ESC behavior, but the content owns the visible papers."
    code={`await prompts.dialog(
  (close) => (
    <div class="flex flex-col gap-2">
      <section class="paper p-4">Custom header</section>
      <section class="paper p-4">Custom content</section>
    </div>
  ),
  { surface: "bare", header: false, size: "large" },
);`}
  >
    <button
      type="button"
      class="btn-secondary btn-sm"
      onClick={() =>
        void prompts.dialog(
          (close) => (
            <div class="flex max-h-[86vh] flex-col gap-2 overflow-y-auto pr-1">
              <section class="paper p-4">
                <div class="flex items-start gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-dimmed dark:bg-zinc-800">
                    <i class="ti ti-layout-cards text-lg" />
                  </span>
                  <div>
                    <h2 class="text-lg font-semibold">Bare modal</h2>
                    <p class="mt-1 text-sm text-secondary">No default panel chrome. Each visible surface is supplied by the caller.</p>
                  </div>
                  <button type="button" class="icon-btn ml-auto" onClick={() => close(undefined)} aria-label="Close">
                    <i class="ti ti-x" />
                  </button>
                </div>
              </section>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <section class="paper p-4">
                  <h3 class="text-sm font-semibold">Paper one</h3>
                  <p class="mt-1 text-xs text-dimmed">Good for picker grids, custom inspectors, or admin panels.</p>
                </section>
                <section class="paper p-4">
                  <h3 class="text-sm font-semibold">Paper two</h3>
                  <p class="mt-1 text-xs text-dimmed">The dialog still owns backdrop click, ESC, focus, and stacking.</p>
                </section>
              </div>
            </div>
          ),
          { surface: "bare", header: false, size: "large" },
        )
      }
    >
      Open bare modal
    </button>
  </DemoCard>
);

export const FeedbackTab = () => (
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    <InfoBlocks />
    <BadgesDemo />
    <ChipsDemo />
    <TagsDemo />
    <StatusDotsDemo />
    <ToastDemo />
    <PromptAlertDemo />
    <PromptErrorDemo />
    <PromptConfirmDemo />
    <PromptSearchDemo />
    <PromptFormDemo />
    <PromptWorkflowFormDemo />
    <PromptCustomDialogDemo />
    <PromptBareModalDemo />
    <PromptSizesDemo />
  </div>
);
