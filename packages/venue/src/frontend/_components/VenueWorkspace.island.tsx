import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { markdown } from "@valentinkolb/cloud/shared";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import {
  AppWorkspace,
  Calendar,
  type CalendarEvent,
  type CalendarView,
  Chart,
  CheckboxCardInput,
  ColorInput,
  DataTable,
  type DataTableColumn,
  DatePicker,
  DateRangePicker,
  type DateRangeValue,
  dialogCore,
  FilterChip,
  type FilterChipSection,
  IconInput,
  ImageInput,
  MarkdownView,
  PanelDialog,
  PermissionEditor,
  panelDialogOptions,
  prompts,
  type ResourceApiKey,
  ResourceApiKeys,
  SegmentedControl,
  SelectInput,
  SettingsModal,
  StatCell,
  StatGrid,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { cookies, img } from "@valentinkolb/stdlib/browser";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  DateOverride,
  DateOverrideInput,
  FeedbackEntry,
  OpeningRule,
  OpeningRuleInput,
  PublicSection,
  PublicSectionInput,
  ShiftAssignment,
  ShiftTemplate,
  ShiftTemplateInput,
  UpcomingSlot,
  Venue,
  VenueDashboard,
} from "../../contracts";

type Props = {
  dashboard: VenueDashboard;
  userId: string;
  icalToken: string;
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  initialView: VenueView;
  initialSectionId?: string | null;
  initialCalendarView: CalendarView;
  initialCalendarDate: string;
  initialFeedbackDays: FeedbackRange;
  initialFeedbackSearch: string;
};

type VenueView = "shifts" | "my-shifts" | "feedback";
type FeedbackRange = 7 | 14 | 30;
type FeedbackBucket = VenueDashboard["feedback"]["buckets"][number];

const views: Array<{ id: VenueView; label: string; icon: string }> = [
  { id: "shifts", label: "Shifts", icon: "ti ti-calendar-event" },
  { id: "my-shifts", label: "My shifts", icon: "ti ti-user-check" },
  { id: "feedback", label: "Feedback", icon: "ti ti-message-star" },
];
const feedbackRangeOptions: FilterChipSection[] = [
  {
    options: [
      { value: "7", label: "Last 7 days", icon: "ti ti-calendar-week" },
      { value: "14", label: "Last 14 days", icon: "ti ti-calendar" },
      { value: "30", label: "Last 30 days", icon: "ti ti-calendar-month" },
    ],
  },
];

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekdayOptions = weekdays.map((label, id) => ({ id: String(id), label }));
const timeZoneDateConfig = (timeZone: string) => ({ timeZone, weekStartsOn: 1 as const });
const DAY_MS = 86_400_000;
const defaultShiftRange = (): DateRangeValue => ({
  start: new Date(Date.now() + 60 * 60_000).toISOString(),
  end: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
});
const todayDateKey = (): string => new Date().toISOString().slice(0, 10);
const MAX_BANNER_LONGEST_SIDE = 1600;
const DOUBLE_CLICK_CONFIRM_COOKIE = "venue_skip_shift_double_click_confirm";

const readError = async (res: Response, fallback: string): Promise<string> => {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

const canWrite = (venue: Venue): boolean => venue.permission === "write" || venue.permission === "admin";
const canAdmin = (venue: Venue): boolean => venue.permission === "admin";
const isSlotActive = (slot: UpcomingSlot): boolean => new Date(slot.endsAt) >= new Date();
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", timeZone });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en", { day: "2-digit", month: "short" });
const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
const withinLastDays = (isoOrDateKey: string, days: number): boolean => {
  const date = isoOrDateKey.length === 10 ? new Date(`${isoOrDateKey}T12:00:00Z`) : new Date(isoOrDateKey);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() >= Date.now() - (days - 1) * DAY_MS;
};
const feedbackBucketCount = (buckets: FeedbackBucket[]): number => buckets.reduce((sum, bucket) => sum + bucket.count, 0);
const feedbackBucketAverage = (buckets: FeedbackBucket[]): number | null => {
  const count = feedbackBucketCount(buckets);
  if (count === 0) return null;
  const weighted = buckets.reduce((sum, bucket) => sum + (bucket.averageRating ?? 0) * bucket.count, 0);
  return Math.round((weighted / count) * 10) / 10;
};
const parseDateKey = (value: string): Date => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};
const sortOpeningRules = (rules: OpeningRule[]) =>
  [...rules].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
const sortOverrides = (entries: DateOverride[]) => [...entries].sort((a, b) => a.date.localeCompare(b.date));
const sortShiftTemplates = (templates: ShiftTemplate[]) =>
  [...templates].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
const bannerTransform = async (file: File): Promise<string> => {
  const data = await img.create(file);
  const longest = Math.max(data.width, data.height);
  const scale = Math.min(1, MAX_BANNER_LONGEST_SIDE / longest);
  const next = scale < 1 ? await img.resize(Math.round(data.width * scale), Math.round(data.height * scale), "fill")(data) : data;
  return img.toBase64("webp", 0.85)(next);
};

function ProgressBar(props: { slot: UpcomingSlot; compact?: boolean }) {
  const total = () => props.slot.maxPeople ?? Math.max(props.slot.minPeople, props.slot.assignedCount, 1);
  const pct = () => Math.min(100, Math.round((props.slot.assignedCount / total()) * 100));
  return (
    <div>
      <Show when={!props.compact}>
        <div class="mb-1 flex items-center justify-between text-[11px] text-dimmed">
          <span>
            {props.slot.assignedCount}/{props.slot.maxPeople ?? props.slot.minPeople} staffed
          </span>
          <span>{props.slot.missingPeople > 0 ? `${props.slot.missingPeople} missing` : "covered"}</span>
        </div>
      </Show>
      <div class={`${props.compact ? "h-1" : "h-1.5"} overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800`}>
        <div
          class={`h-full rounded-full ${props.slot.missingPeople > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct()}%` }}
        />
      </div>
    </div>
  );
}

function ScheduleActionButton(props: { label: string; icon: string; tone: "edit" | "delete"; loading?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      class={`inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent transition-colors ${
        props.tone === "edit"
          ? "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          : "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
      }`}
      title={props.label}
      aria-label={props.label}
      disabled={props.loading}
      onClick={props.onClick}
    >
      <i class={props.loading ? "ti ti-loader-2 animate-spin" : props.icon} />
    </button>
  );
}

function DialogFrame(props: {
  title: string;
  subtitle?: string;
  icon: string;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  children: JSX.Element;
}) {
  return (
    <PanelDialog>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelDialog.Header title={props.title} subtitle={props.subtitle} icon={props.icon} close={props.onCancel} />
        <PanelDialog.Body>{props.children}</PanelDialog.Body>
        <PanelDialog.Footer>
          <div />
          <div class="flex justify-end gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={props.onCancel}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={props.onSubmit}>
              {props.submitLabel}
            </button>
          </div>
        </PanelDialog.Footer>
      </div>
    </PanelDialog>
  );
}

function OpeningRuleDialog(props: { close: (value: OpeningRuleInput | null) => void; initial?: OpeningRule }) {
  const [weekday, setWeekday] = createSignal(String(props.initial?.weekday ?? 1));
  const [startTime, setStartTime] = createSignal(props.initial?.startTime ?? "09:00");
  const [endTime, setEndTime] = createSignal(props.initial?.endTime ?? "17:00");
  const [note, setNote] = createSignal(props.initial?.note ?? "");

  const submit = () => {
    if (!startTime().trim() || !endTime().trim()) {
      prompts.error("Start and end time are required.");
      return;
    }
    props.close({
      weekday: Number(weekday()),
      startTime: startTime().trim(),
      endTime: endTime().trim(),
      note: note().trim() || null,
    });
  };

  return (
    <DialogFrame
      title={props.initial ? "Edit opening hours" : "Add opening hours"}
      icon="ti ti-clock"
      submitLabel={props.initial ? "Save" : "Add"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <SelectInput label="Weekday" value={weekday} onChange={setWeekday} options={weekdayOptions} />
        <div class="grid gap-3 sm:grid-cols-2">
          <TextInput label="Start" value={startTime} onInput={setStartTime} placeholder="09:00" inputMode="numeric" required />
          <TextInput label="End" value={endTime} onInput={setEndTime} placeholder="17:00" inputMode="numeric" required />
        </div>
        <TextInput label="Note" value={note} onInput={setNote} placeholder="Optional" />
      </div>
    </DialogFrame>
  );
}

function ClosedDayDialog(props: { close: (value: DateOverrideInput | null) => void; timeZone: string; initial?: DateOverride }) {
  const [date, setDate] = createSignal<string | null>(props.initial?.date ?? todayDateKey());
  const [note, setNote] = createSignal(props.initial?.note ?? "Holiday");

  const submit = () => {
    if (!date()) {
      prompts.error("Pick a date.");
      return;
    }
    props.close({ date: date()!, kind: "closed", note: note().trim() || "Holiday" });
  };

  return (
    <DialogFrame
      title={props.initial ? "Edit closed day" : "Add closed day"}
      icon="ti ti-calendar-x"
      submitLabel={props.initial ? "Save" : "Add"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <DatePicker label="Date" value={date} onChange={setDate} dateConfig={timeZoneDateConfig(props.timeZone)} required />
        <TextInput label="Note" value={note} onInput={setNote} placeholder="Public holiday" />
      </div>
    </DialogFrame>
  );
}

type ShiftTemplateDraft = {
  title: string;
  weekday: string;
  startTime: string;
  endTime: string;
  minPeople: string;
  maxPeople: string;
  active: boolean;
};

const buildShiftTemplateInput = (
  draft: ShiftTemplateDraft,
): { input: ShiftTemplateInput; error: null } | { input: null; error: string } => {
  const min = Number(draft.minPeople.trim() || "1");
  const maxRaw = draft.maxPeople.trim();
  const max = maxRaw ? Number(maxRaw) : null;
  if (!draft.title.trim() || !draft.startTime.trim() || !draft.endTime.trim() || Number.isNaN(min) || (maxRaw && Number.isNaN(max))) {
    return { input: null, error: "Title, times, and staffing numbers are required." };
  }
  if (min < 0 || (max !== null && max < 0)) return { input: null, error: "Staffing numbers cannot be negative." };
  if (max !== null && max < min) return { input: null, error: "Max people must be greater than or equal to target people." };
  return {
    input: {
      title: draft.title.trim(),
      weekday: Number(draft.weekday),
      startTime: draft.startTime.trim(),
      endTime: draft.endTime.trim(),
      minPeople: min,
      maxPeople: max,
      active: draft.active,
    },
    error: null,
  };
};

function ShiftTemplateDialog(props: { close: (value: ShiftTemplateInput | null) => void; initial?: ShiftTemplate }) {
  const [title, setTitle] = createSignal(props.initial?.title ?? "");
  const [weekday, setWeekday] = createSignal(String(props.initial?.weekday ?? 1));
  const [startTime, setStartTime] = createSignal(props.initial?.startTime ?? "09:00");
  const [endTime, setEndTime] = createSignal(props.initial?.endTime ?? "13:00");
  const [minPeople, setMinPeople] = createSignal(String(props.initial?.minPeople ?? 1));
  const [maxPeople, setMaxPeople] = createSignal(props.initial?.maxPeople == null ? "" : String(props.initial.maxPeople));

  const submit = () => {
    const result = buildShiftTemplateInput({
      title: title(),
      weekday: weekday(),
      startTime: startTime(),
      endTime: endTime(),
      minPeople: minPeople(),
      maxPeople: maxPeople(),
      active: props.initial?.active ?? true,
    });
    if (result.error) {
      prompts.error(result.error);
      return;
    }
    props.close(result.input);
  };

  return (
    <DialogFrame
      title={props.initial ? "Edit shift" : "Add shift"}
      icon="ti ti-calendar-plus"
      submitLabel={props.initial ? "Save" : "Add"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <TextInput label="Title" value={title} onInput={setTitle} placeholder="Morning shift" required />
        <SelectInput label="Weekday" value={weekday} onChange={setWeekday} options={weekdayOptions} />
        <div class="grid gap-3 sm:grid-cols-2">
          <TextInput label="Start" value={startTime} onInput={setStartTime} placeholder="09:00" inputMode="numeric" required />
          <TextInput label="End" value={endTime} onInput={setEndTime} placeholder="13:00" inputMode="numeric" required />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <TextInput label="Target people" value={minPeople} onInput={setMinPeople} inputMode="numeric" required />
          <TextInput label="Max people" value={maxPeople} onInput={setMaxPeople} inputMode="numeric" placeholder="Optional" />
        </div>
      </div>
    </DialogFrame>
  );
}

type MenuItemDraft = {
  id: string;
  name: string;
  description: string;
  info: string;
  price: string;
  image: string | null;
};

type LinkDraft = {
  id: string;
  label: string;
  href: string;
};

const sectionKindIcon = (kind: PublicSection["kind"]): string => {
  if (kind === "menu") return "ti ti-tools-kitchen-2";
  if (kind === "notice") return "ti ti-speakerphone";
  if (kind === "links") return "ti ti-link";
  return "ti ti-markdown";
};

const sectionText = (section: PublicSection, key: "markdown" | "text"): string => {
  const value = section.content[key];
  return typeof value === "string" ? value : "";
};

const readMenuItems = (section: PublicSection | null): MenuItemDraft[] => {
  const items = Array.isArray(section?.content.items) ? section.content.items : [];
  return items
    .map((raw, index) => {
      const item = raw as Record<string, unknown>;
      return {
        id: String(index + 1),
        name: String(item.name ?? ""),
        description: String(item.description ?? ""),
        info: String(item.info ?? item.allergens ?? ""),
        price: String(item.price ?? ""),
        image: typeof item.image === "string" ? item.image : null,
      };
    })
    .filter((item) => item.name || item.description || item.info || item.price || item.image);
};

const readLinks = (section: PublicSection | null): LinkDraft[] => {
  const links = Array.isArray(section?.content.links) ? section.content.links : [];
  return links
    .map((raw, index) => {
      const link = raw as Record<string, unknown>;
      return {
        id: String(index + 1),
        label: String(link.label ?? ""),
        href: String(link.href ?? ""),
      };
    })
    .filter((link) => link.label || link.href);
};

function PublicSectionDialog(props: {
  close: (value: PublicSectionInput | null) => void;
  nextPosition: number;
  initial?: PublicSection;
  title?: string;
  submitLabel?: string;
}) {
  let nextItemId = 1;
  const newItem = (): MenuItemDraft => ({ id: String(nextItemId++), name: "", description: "", info: "", price: "", image: null });
  let nextLinkId = 1;
  const newLink = (): LinkDraft => ({ id: String(nextLinkId++), label: "", href: "" });
  const initialItems = readMenuItems(props.initial ?? null);
  const initialLinks = readLinks(props.initial ?? null);
  nextItemId = initialItems.length + 1;
  nextLinkId = initialLinks.length + 1;
  const [kind, setKind] = createSignal<PublicSection["kind"]>(props.initial?.kind ?? "markdown");
  const [title, setTitle] = createSignal(props.initial?.title ?? "");
  const [contentText, setContentText] = createSignal(
    props.initial ? sectionText(props.initial, props.initial.kind === "markdown" ? "markdown" : "text") : "",
  );
  const [items, setItems] = createSignal<MenuItemDraft[]>(initialItems.length > 0 ? initialItems : [newItem()]);
  const [links, setLinks] = createSignal<LinkDraft[]>(initialLinks.length > 0 ? initialLinks : [newLink()]);

  const updateItem = (id: string, patch: Partial<MenuItemDraft>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const updateLink = (id: string, patch: Partial<LinkDraft>) => {
    setLinks((current) => current.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  };

  const addItem = () => setItems((current) => [...current, newItem()]);
  const removeItem = (id: string) => setItems((current) => (current.length > 1 ? current.filter((item) => item.id !== id) : current));
  const addLink = () => setLinks((current) => [...current, newLink()]);
  const removeLink = (id: string) => setLinks((current) => (current.length > 1 ? current.filter((link) => link.id !== id) : current));

  const submit = () => {
    if (!title().trim()) {
      prompts.error("Title is required.");
      return;
    }

    const content =
      kind() === "menu"
        ? {
            items: items()
              .map((item) => ({
                name: item.name.trim(),
                description: item.description.trim(),
                info: item.info.trim(),
                price: item.price.trim(),
                image: item.image || null,
              }))
              .filter((item) => item.name),
          }
        : kind() === "links"
          ? {
              links: links()
                .map((link) => ({ label: link.label.trim(), href: link.href.trim() }))
                .filter((link) => link.label && link.href),
            }
          : { markdown: contentText(), text: contentText() };

    if (kind() === "menu" && Array.isArray(content.items) && content.items.length === 0) {
      prompts.error("Add at least one menu item.");
      return;
    }
    if (kind() === "links" && Array.isArray(content.links) && content.links.length === 0) {
      prompts.error("Add at least one link.");
      return;
    }

    props.close({
      kind: kind(),
      title: title().trim(),
      content,
      enabled: true,
      position: props.nextPosition,
    });
  };

  return (
    <DialogFrame
      title={props.title ?? "Add public section"}
      icon={sectionKindIcon(kind())}
      submitLabel={props.submitLabel ?? "Add section"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <Show
          when={!props.initial}
          fallback={
            <div class="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-secondary dark:bg-zinc-900">
              <i class={sectionKindIcon(kind())} />
              <span>
                {kind()[0]?.toUpperCase()}
                {kind().slice(1)} section
              </span>
            </div>
          }
        >
          <SegmentedControl
            value={kind}
            onChange={setKind}
            options={[
              { value: "markdown", label: "Markdown", icon: "ti ti-markdown" },
              { value: "menu", label: "Menu", icon: "ti ti-tools-kitchen-2" },
              { value: "notice", label: "Notice", icon: "ti ti-speakerphone" },
              { value: "links", label: "Links", icon: "ti ti-link" },
            ]}
          />
        </Show>
        <TextInput label="Title" description="Shown as the section heading on the public page." value={title} onInput={setTitle} required />
        <Show
          when={kind() === "menu"}
          fallback={
            <Show
              when={kind() === "links"}
              fallback={
                <TextInput
                  label="Content"
                  description="Text visitors see in this section."
                  value={contentText}
                  onInput={setContentText}
                  multiline
                  markdown={kind() === "markdown"}
                  lines={8}
                />
              }
            >
              <div class="grid gap-2">
                <For each={links()}>
                  {(link, index) => (
                    <div class="paper p-3">
                      <div class="mb-3 flex items-center justify-between gap-2">
                        <p class="text-xs font-semibold uppercase tracking-wide text-dimmed">Link {index() + 1}</p>
                        <button type="button" class="btn-secondary btn-sm px-2 py-1 text-xs" onClick={() => removeLink(link.id)}>
                          <i class="ti ti-trash" /> Remove
                        </button>
                      </div>
                      <div class="grid gap-3 sm:grid-cols-2">
                        <TextInput
                          label="Label"
                          description="Visible text for this link."
                          value={() => link.label}
                          onInput={(value) => updateLink(link.id, { label: value })}
                          required
                        />
                        <TextInput
                          label="URL"
                          description="Destination opened when visitors click."
                          value={() => link.href}
                          onInput={(value) => updateLink(link.id, { href: value })}
                          placeholder="https://example.com"
                          required
                        />
                      </div>
                    </div>
                  )}
                </For>
                <button type="button" class="btn-secondary btn-sm justify-center" onClick={addLink}>
                  <i class="ti ti-plus" /> Add link
                </button>
              </div>
            </Show>
          }
        >
          <div class="grid gap-2">
            <For each={items()}>
              {(item, index) => (
                <div class="paper p-3">
                  <div class="mb-3 flex items-center justify-between gap-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-dimmed">Item {index() + 1}</p>
                    <button type="button" class="btn-secondary btn-sm px-2 py-1 text-xs" onClick={() => removeItem(item.id)}>
                      <i class="ti ti-trash" /> Remove
                    </button>
                  </div>
                  <div class="grid gap-3">
                    <ImageInput
                      label="Image"
                      description="Optional square image for this menu item."
                      value={() => item.image}
                      onChange={(value) => updateItem(item.id, { image: value })}
                      variant="small"
                    />
                    <div class="grid gap-3 sm:grid-cols-2">
                      <TextInput
                        label="Name"
                        description="Main label for this item."
                        value={() => item.name}
                        onInput={(value) => updateItem(item.id, { name: value })}
                        required
                      />
                      <TextInput
                        label="Price"
                        description="Optional visible price or price range."
                        value={() => item.price}
                        onInput={(value) => updateItem(item.id, { price: value })}
                      />
                    </div>
                    <TextInput
                      label="Description"
                      description="Short explanation shown below the name."
                      value={() => item.description}
                      onInput={(value) => updateItem(item.id, { description: value })}
                      multiline
                      lines={2}
                    />
                    <TextInput
                      label="Allergens / info"
                      description="Optional allergens or dietary notes."
                      value={() => item.info}
                      onInput={(value) => updateItem(item.id, { info: value })}
                      placeholder="Contains nuts"
                    />
                  </div>
                </div>
              )}
            </For>
            <button type="button" class="btn-secondary btn-sm justify-center" onClick={addItem}>
              <i class="ti ti-plus" /> Add menu item
            </button>
          </div>
        </Show>
      </div>
    </DialogFrame>
  );
}

function SignupDialog(props: { dashboard: VenueDashboard; close: (changed: boolean) => void }) {
  const defaultMode = props.dashboard.venue.signupMode === "free" ? "free" : "shifts";
  const [mode, setMode] = createSignal<"shifts" | "free">(defaultMode);
  const [freeRange, setFreeRange] = createSignal<DateRangeValue>(defaultShiftRange());
  const [note, setNote] = createSignal("");

  const signup = mutation.create<void, { slot: UpcomingSlot; weeks?: number }>({
    mutation: async ({ slot, weeks }) => {
      const target = apiClient.venues[":id"].templates[":templateId"];
      const res = weeks
        ? await target["signup-weeks"].$post({
            param: { id: props.dashboard.venue.id, templateId: slot.template.id },
            json: { date: slot.date, weeks },
          })
        : await target.signup.$post({
            param: { id: props.dashboard.venue.id, templateId: slot.template.id },
            json: { date: slot.date },
          });
      if (!res.ok) throw new Error(await readError(res, "Failed to sign up."));
    },
    onSuccess: () => {
      toast.success("Shift added");
      props.close(true);
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const freeSignup = mutation.create<void, void>({
    mutation: async () => {
      const range = freeRange();
      if (!range.start || !range.end) throw new Error("Pick a start and end time.");
      const res = await apiClient.venues[":id"]["free-signup"].$post({
        param: { id: props.dashboard.venue.id },
        json: { startsAt: range.start, endsAt: range.end, note: note().trim() || null },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to sign up."));
    },
    onSuccess: () => {
      toast.success("Shift added");
      props.close(true);
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <PanelDialog>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelDialog.Header
          title="Sign up for a shift"
          subtitle={props.dashboard.venue.name}
          icon="ti ti-user-plus"
          close={() => props.close(false)}
        />
        <PanelDialog.Body>
          <Show when={props.dashboard.venue.signupMode === "both"}>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={[
                { value: "shifts", label: "Shift slots", icon: "ti ti-calendar-event" },
                { value: "free", label: "Free time", icon: "ti ti-clock-plus" },
              ]}
            />
          </Show>
          <Show
            when={mode() === "shifts"}
            fallback={
              <div class="grid gap-3">
                <DateRangePicker
                  label="Time"
                  value={freeRange}
                  onChange={setFreeRange}
                  withTime
                  dateConfig={timeZoneDateConfig(props.dashboard.venue.timezone)}
                  durationPresets={[
                    { label: "2h", minutes: 120 },
                    { label: "4h", minutes: 240 },
                    { label: "8h", minutes: 480 },
                  ]}
                />
                <TextInput label="Note" value={note} onInput={setNote} multiline lines={3} />
                <button
                  type="button"
                  class="btn-primary btn-sm justify-center"
                  disabled={freeSignup.loading()}
                  onClick={() => freeSignup.mutate()}
                >
                  <i class={freeSignup.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
                  Add free shift
                </button>
              </div>
            }
          >
            <div class="flex flex-col gap-2">
              <For each={props.dashboard.slots.filter(isSlotActive).slice(0, 16)}>
                {(slot) => (
                  <div class="paper p-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="font-medium text-primary">{slot.template.title}</p>
                        <p class="text-xs text-dimmed">
                          {fmt(slot.startsAt)} · {slot.template.startTime}-{slot.template.endTime}
                        </p>
                      </div>
                      <span
                        class={`tag ${slot.full ? "bg-zinc-100 text-dimmed dark:bg-zinc-800" : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"}`}
                      >
                        {slot.full ? "Full" : "Open"}
                      </span>
                    </div>
                    <div class="mt-3">
                      <ProgressBar slot={slot} />
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="btn-primary btn-sm"
                        disabled={slot.full || !isSlotActive(slot) || signup.loading()}
                        onClick={() => signup.mutate({ slot })}
                      >
                        Join
                      </button>
                      <button
                        type="button"
                        class="btn-secondary btn-sm"
                        disabled={slot.full || !isSlotActive(slot) || signup.loading()}
                        onClick={() => signup.mutate({ slot, weeks: 4 })}
                      >
                        Join next 4 weeks
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <div />
          <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(false)}>
            Close
          </button>
        </PanelDialog.Footer>
      </div>
    </PanelDialog>
  );
}

function ConfirmShiftSignupDialog(props: { slot: UpcomingSlot; timezone: string; close: (confirmed: boolean) => void }) {
  const [skipConfirm, setSkipConfirm] = createSignal(false);
  const confirm = () => {
    if (skipConfirm()) cookies.writeJsonCookie(DOUBLE_CLICK_CONFIRM_COOKIE, true);
    props.close(true);
  };
  return (
    <div class="grid gap-4">
      <div class="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
        <p class="font-semibold text-primary">{props.slot.template.title}</p>
        <p class="mt-1 text-dimmed">
          {fmt(props.slot.startsAt)} · {fmtTime(props.slot.startsAt, props.timezone)}-{fmtTime(props.slot.endsAt, props.timezone)}
        </p>
        <div class="mt-3">
          <ProgressBar slot={props.slot} />
        </div>
      </div>
      <CheckboxCardInput
        label="Don't show this confirmation again"
        description="Future calendar double-clicks will join shifts directly."
        icon="ti ti-click"
        value={skipConfirm}
        onChange={setSkipConfirm}
        variant="input"
      />
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(false)}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={confirm}>
          Join shift
        </button>
      </div>
    </div>
  );
}

function SettingsDialog(props: {
  dashboard: VenueDashboard;
  accessEntries: AccessEntry[];
  apiKeys: ResourceApiKey[];
  icalToken: string;
  close: () => void;
}) {
  const venue = props.dashboard.venue;
  const [name, setName] = createSignal(venue.name);
  const [icon, setIcon] = createSignal(venue.icon || "ti ti-building-carousel");
  const [slug, setSlug] = createSignal(venue.slug);
  const [description, setDescription] = createSignal(venue.description ?? "");
  const [accentColor, setAccentColor] = createSignal(venue.accentColor);
  const [feedbackEnabled, setFeedbackEnabled] = createSignal(venue.feedbackEnabled);
  const [logo, setLogo] = createSignal(venue.logoBase64);
  const [banner, setBanner] = createSignal(venue.bannerBase64);
  const [openingRules, setOpeningRules] = createSignal<OpeningRule[]>(props.dashboard.openingRules);
  const [overrides, setOverrides] = createSignal<DateOverride[]>(props.dashboard.overrides);
  const [shiftTemplates, setShiftTemplates] = createSignal<ShiftTemplate[]>(props.dashboard.templates);

  const save = mutation.create<void, void>({
    mutation: async () => {
      const res = await apiClient.venues[":id"].$patch({
        param: { id: venue.id },
        json: {
          name: name(),
          icon: icon(),
          slug: slug(),
          description: description().trim() || null,
          timezone: venue.timezone,
          openMode: venue.openMode,
          signupMode: venue.signupMode,
          publicEnabled: venue.publicEnabled,
          feedbackEnabled: feedbackEnabled(),
          accentColor: accentColor(),
          logoBase64: logo(),
          bannerBase64: banner(),
        },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to save venue."));
    },
    onSuccess: () => {
      toast.success("Venue saved");
      props.close();
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const createOpening = mutation.create<OpeningRule | null, void>({
    mutation: async () => {
      const input = await dialogCore.open<OpeningRuleInput | null>((close) => <OpeningRuleDialog close={close} />, panelDialogOptions);
      if (!input) return null;
      const res = await apiClient.venues[":id"]["opening-rules"].$post({
        param: { id: venue.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add opening hours."));
      return await res.json();
    },
    onSuccess: (created) => {
      if (!created) return;
      setOpeningRules((current) => sortOpeningRules([...current, created]));
      toast.success("Opening hours added");
    },
    onError: (err) => prompts.error(err.message),
  });

  const editOpening = mutation.create<OpeningRule | null, OpeningRule>({
    mutation: async (rule) => {
      const input = await dialogCore.open<OpeningRuleInput | null>(
        (close) => <OpeningRuleDialog close={close} initial={rule} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"]["opening-rules"][":resourceId"].$patch({
        param: { id: venue.id, resourceId: rule.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update opening hours."));
      return await res.json();
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setOpeningRules((current) => sortOpeningRules(current.map((entry) => (entry.id === updated.id ? updated : entry))));
      toast.success("Opening hours updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteOpening = mutation.create<void, OpeningRule>({
    mutation: async (rule) => {
      const confirmed = await prompts.confirm(`Delete opening hours for ${weekdays[rule.weekday]} ${rule.startTime}-${rule.endTime}?`, {
        title: "Delete opening hours",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      const res = await apiClient.venues[":id"]["opening-rules"][":resourceId"].$delete({
        param: { id: venue.id, resourceId: rule.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete opening hours."));
      setOpeningRules((current) => current.filter((entry) => entry.id !== rule.id));
      toast.success("Opening hours deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  const addHoliday = mutation.create<DateOverride | null, void>({
    mutation: async () => {
      const input = await dialogCore.open<DateOverrideInput | null>(
        (close) => <ClosedDayDialog close={close} timeZone={venue.timezone} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"].overrides.$post({
        param: { id: venue.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add closed day."));
      return await res.json();
    },
    onSuccess: (created) => {
      if (!created) return;
      setOverrides((current) => sortOverrides([...current.filter((entry) => entry.date !== created.date), created]));
      toast.success("Closed day added");
    },
    onError: (err) => prompts.error(err.message),
  });

  const editHoliday = mutation.create<DateOverride | null, DateOverride>({
    mutation: async (entry) => {
      const input = await dialogCore.open<DateOverrideInput | null>(
        (close) => <ClosedDayDialog close={close} timeZone={venue.timezone} initial={entry} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"].overrides[":resourceId"].$patch({
        param: { id: venue.id, resourceId: entry.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update closed day."));
      return await res.json();
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setOverrides((current) => sortOverrides(current.map((entry) => (entry.id === updated.id ? updated : entry))));
      toast.success("Closed day updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteHoliday = mutation.create<void, DateOverride>({
    mutation: async (entry) => {
      const confirmed = await prompts.confirm(`Delete closed day "${entry.date}"?`, {
        title: "Delete closed day",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      const res = await apiClient.venues[":id"].overrides[":resourceId"].$delete({
        param: { id: venue.id, resourceId: entry.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete closed day."));
      setOverrides((current) => current.filter((candidate) => candidate.id !== entry.id));
      toast.success("Closed day deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  const createShift = mutation.create<ShiftTemplate | null, void>({
    mutation: async () => {
      const input = await dialogCore.open<ShiftTemplateInput | null>((close) => <ShiftTemplateDialog close={close} />, panelDialogOptions);
      if (!input) return null;
      const res = await apiClient.venues[":id"].templates.$post({
        param: { id: venue.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add shift."));
      return await res.json();
    },
    onSuccess: (created) => {
      if (!created) return;
      setShiftTemplates((current) => sortShiftTemplates([...current, created]));
      toast.success("Shift added");
    },
    onError: (err) => prompts.error(err.message),
  });

  const editShift = mutation.create<ShiftTemplate | null, ShiftTemplate>({
    mutation: async (shift) => {
      const input = await dialogCore.open<ShiftTemplateInput | null>(
        (close) => <ShiftTemplateDialog close={close} initial={shift} />,
        panelDialogOptions,
      );
      if (!input) return null;
      const res = await apiClient.venues[":id"].templates[":resourceId"].$patch({
        param: { id: venue.id, resourceId: shift.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update shift."));
      return await res.json();
    },
    onSuccess: (updated) => {
      if (!updated) return;
      setShiftTemplates((current) => sortShiftTemplates(current.map((entry) => (entry.id === updated.id ? updated : entry))));
      toast.success("Shift updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteShift = mutation.create<void, ShiftTemplate>({
    mutation: async (shift) => {
      const confirmed = await prompts.confirm(`Delete shift "${shift.title}"?`, {
        title: "Delete shift",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      const res = await apiClient.venues[":id"].templates[":resourceId"].$delete({
        param: { id: venue.id, resourceId: shift.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete shift."));
      setShiftTemplates((current) => current.filter((entry) => entry.id !== shift.id));
      toast.success("Shift deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
      <SettingsModal title="Venue settings" subtitle={venue.name} icon={icon()} onClose={props.close} closeLabel="Close settings">
        <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Name, public page branding, and feedback.">
          <div class="grid gap-3">
            <TextInput label="Name" description="Shown in the app and on the public page." value={name} onInput={setName} required />
            <TextInput label="Slug" description="Used in the public page URL." value={slug} onInput={setSlug} required />
            <TextInput
              label="Description"
              description="Short public summary shown below the venue name."
              value={description}
              onInput={setDescription}
              multiline
              lines={3}
            />
            <div class="grid gap-3 md:grid-cols-2">
              <IconInput
                label="Icon"
                description="Used as fallback logo and venue symbol."
                value={icon}
                onChange={setIcon}
                clearable={false}
              />
              <ColorInput label="Theme color" description="Used for public page accents." value={accentColor} onChange={setAccentColor} />
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <ImageInput
                label="Logo"
                description="Optional image shown next to the venue name."
                value={logo}
                onChange={setLogo}
                variant="small"
              />
              <ImageInput
                label="Banner image"
                description="Optional wide image for the public page header."
                value={banner}
                onChange={setBanner}
                variant="small"
                transform={bannerTransform}
              />
            </div>
            <CheckboxCardInput
              label="Feedback activated"
              description="Allow visitors to leave anonymous ratings and comments on the public page."
              icon="ti ti-message-star"
              value={feedbackEnabled}
              onChange={setFeedbackEnabled}
              variant="input"
            />
            <div class="flex justify-end gap-2 pt-2">
              <button type="button" class="btn-primary btn-sm" disabled={save.loading()} onClick={() => save.mutate()}>
                Save
              </button>
            </div>
          </div>
        </SettingsModal.Tab>

        {canAdmin(venue) && (
          <SettingsModal.Tab id="access" title="Access" icon="ti ti-shield" description="Permission changes save immediately.">
            <div class="grid gap-5">
              <PermissionEditor
                initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
                canEdit
                allowedLevels={[
                  { level: "read", label: "Read" },
                  { level: "write", label: "Staff" },
                  { level: "admin", label: "Admin" },
                ]}
                grantAccess={async (principal: Principal, permission: Exclude<PermissionLevel, "none">): Promise<AccessEntry> => {
                  const response = await apiClient.venues[":id"].access.$post({
                    param: { id: venue.id },
                    json: { principal, permission },
                  });
                  if (!response.ok) throw new Error(await readError(response, "Failed to grant access."));
                  return await response.json();
                }}
                updateAccess={async (accessId, permission) => {
                  const response = await apiClient.venues[":id"].access[":accessId"].$patch({
                    param: { id: venue.id, accessId },
                    json: { permission },
                  });
                  if (!response.ok) throw new Error(await readError(response, "Failed to update access."));
                }}
                revokeAccess={async (accessId) => {
                  const response = await apiClient.venues[":id"].access[":accessId"].$delete({ param: { id: venue.id, accessId } });
                  if (!response.ok) throw new Error(await readError(response, "Failed to revoke access."));
                }}
              />
              <div class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <ResourceApiKeys
                  title="API keys"
                  description="Resource-bound keys for integrations that need access to this venue."
                  initialKeys={props.apiKeys}
                  createKey={async (input) => {
                    const response = await apiClient.venues[":id"]["api-keys"].$post({
                      param: { id: venue.id },
                      json: input,
                    });
                    if (!response.ok) throw new Error(await readError(response, "Failed to create API key."));
                    return (await response.json()) as { credential: ResourceApiKey; token: string };
                  }}
                  revokeKey={async (credentialId) => {
                    const response = await apiClient.venues[":id"]["api-keys"][":credentialId"].$delete({
                      param: { id: venue.id, credentialId },
                    });
                    if (!response.ok) throw new Error(await readError(response, "Failed to revoke API key."));
                  }}
                />
              </div>
            </div>
          </SettingsModal.Tab>
        )}

        <SettingsModal.Tab
          id="schedule"
          title="Schedule"
          icon="ti ti-calendar-time"
          description="Regular hours, closed days, and staffing targets."
        >
          <div class="grid gap-5">
            <section>
              <div class="mb-3 flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-primary">Regular hours</h4>
                <Show when={canAdmin(venue)}>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    disabled={createOpening.loading()}
                    onClick={() => createOpening.mutate()}
                  >
                    <i class={createOpening.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For each={openingRules()} fallback={<p class="text-sm text-dimmed">No regular hours.</p>}>
                  {(rule) => (
                    <div class="paper p-3 text-sm">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-primary">{weekdays[rule.weekday]}</p>
                          <p class="text-dimmed">
                            {rule.startTime}-{rule.endTime}
                            {rule.note ? ` · ${rule.note}` : ""}
                          </p>
                        </div>
                        <Show when={canAdmin(venue)}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit opening hours"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={editOpening.loading()}
                              onClick={() => editOpening.mutate(rule)}
                            />
                            <ScheduleActionButton
                              label="Delete opening hours"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={deleteOpening.loading()}
                              onClick={() => deleteOpening.mutate(rule)}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-primary">Closed days</h4>
                <Show when={canAdmin(venue)}>
                  <button type="button" class="btn-secondary btn-sm" disabled={addHoliday.loading()} onClick={() => addHoliday.mutate()}>
                    <i class={addHoliday.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For each={overrides()} fallback={<p class="text-sm text-dimmed">No closed days.</p>}>
                  {(entry) => (
                    <div class="paper p-3 text-sm">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-primary">{entry.date}</p>
                          <p class="text-dimmed">
                            {entry.kind}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </p>
                        </div>
                        <Show when={canAdmin(venue)}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit closed day"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={editHoliday.loading()}
                              onClick={() => editHoliday.mutate(entry)}
                            />
                            <ScheduleActionButton
                              label="Delete closed day"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={deleteHoliday.loading()}
                              onClick={() => deleteHoliday.mutate(entry)}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center justify-between gap-2">
                <h4 class="text-sm font-semibold text-primary">Shifts</h4>
                <Show when={canAdmin(venue)}>
                  <button type="button" class="btn-secondary btn-sm" disabled={createShift.loading()} onClick={() => createShift.mutate()}>
                    <i class={createShift.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} /> Add
                  </button>
                </Show>
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <For each={shiftTemplates()} fallback={<p class="text-sm text-dimmed">No shifts configured.</p>}>
                  {(shift) => (
                    <div class="paper p-3 text-sm">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-primary">{shift.title}</p>
                          <p class="text-dimmed">
                            {weekdays[shift.weekday]} · {shift.startTime}-{shift.endTime}
                          </p>
                          <p class="mt-2 text-xs text-dimmed">
                            Target {shift.minPeople}
                            {shift.maxPeople ? ` · max ${shift.maxPeople}` : ""}
                          </p>
                        </div>
                        <Show when={canAdmin(venue)}>
                          <div class="flex shrink-0 gap-1">
                            <ScheduleActionButton
                              label="Edit shift"
                              icon="ti ti-pencil"
                              tone="edit"
                              loading={editShift.loading()}
                              onClick={() => editShift.mutate(shift)}
                            />
                            <ScheduleActionButton
                              label="Delete shift"
                              icon="ti ti-trash"
                              tone="delete"
                              loading={deleteShift.loading()}
                              onClick={() => deleteShift.mutate(shift)}
                            />
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </div>
        </SettingsModal.Tab>

        <SettingsModal.Tab id="links" title="Links" icon="ti ti-link" description="Public page and personal calendar subscription.">
          <div class="flex flex-wrap gap-2">
            <a class="btn-secondary btn-sm" href={`/app/venue/public/${venue.slug}`} target="_blank" rel="noreferrer">
              <i class="ti ti-external-link" />
              Public page
            </a>
            <a class="btn-secondary btn-sm" href={`/api/venue/calendar/${props.icalToken}.ics`}>
              <i class="ti ti-calendar-down" />
              iCal
            </a>
          </div>
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  );
}

function PublicSectionPreview(props: { section: PublicSection }) {
  const items = () => (Array.isArray(props.section.content.items) ? props.section.content.items : []);
  const links = () => (Array.isArray(props.section.content.links) ? props.section.content.links : []);

  return (
    <div class="grid gap-3">
      <Show when={props.section.kind === "markdown"}>
        <MarkdownView html={markdown.renderSync(sectionText(props.section, "markdown"))} class="text-sm" smallHeadings />
      </Show>
      <Show when={props.section.kind === "notice"}>
        <div class="info-block-warning">
          {sectionText(props.section, "text") || sectionText(props.section, "markdown") || "No notice text yet."}
        </div>
      </Show>
      <Show when={props.section.kind === "links"}>
        <div class="grid gap-2">
          <For each={links()} fallback={<p class="text-sm text-dimmed">{sectionText(props.section, "text") || "No links yet."}</p>}>
            {(raw) => {
              const link = raw as Record<string, unknown>;
              return (
                <a class="paper flex items-center gap-3 p-3 no-underline hover:paper-highlighted" href={String(link.href ?? "#")}>
                  <i class="ti ti-link text-dimmed" />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">{String(link.label ?? link.href ?? "Link")}</span>
                  <i class="ti ti-external-link text-dimmed" />
                </a>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={props.section.kind === "menu"}>
        <div class="grid gap-2">
          <For each={items()} fallback={<p class="text-sm text-dimmed">No menu items yet.</p>}>
            {(raw) => {
              const item = raw as Record<string, unknown>;
              const image = typeof item.image === "string" ? item.image : "";
              return (
                <div class="paper p-3 text-sm">
                  <div class="flex items-start justify-between gap-3">
                    <Show when={image}>
                      <img src={image} alt="" class="h-14 w-14 shrink-0 rounded-lg object-cover" />
                    </Show>
                    <div class="min-w-0">
                      <p class="font-medium text-primary">{String(item.name ?? "Item")}</p>
                      <Show when={item.description}>
                        <p class="text-xs text-dimmed">{String(item.description)}</p>
                      </Show>
                      <Show when={item.info || item.allergens}>
                        <p class="mt-1 text-xs text-dimmed">({String(item.info ?? item.allergens)})</p>
                      </Show>
                    </div>
                    <span class="shrink-0 text-sm font-semibold text-primary">{String(item.price ?? "")}</span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function VenueWorkspace(props: Props) {
  const venue = () => props.dashboard.venue;
  const [view] = createSignal<VenueView>(props.initialView);
  const [selectedSectionId, setSelectedSectionId] = createSignal(props.initialSectionId ?? null);
  const [calendarView] = createSignal<CalendarView>(props.initialCalendarView);
  const [calendarDate] = createSignal(parseDateKey(props.initialCalendarDate));
  const viewHref = (next: VenueView) => `/app/venue/${venue().id}/${next}`;
  const feedbackRangeDays = createMemo(() => props.initialFeedbackDays);
  const feedbackSearchAction = createMemo(() => {
    const url = new URL(viewHref("feedback"), "http://venue.local");
    if (props.initialFeedbackDays !== 30) url.searchParams.set("days", String(props.initialFeedbackDays));
    return `${url.pathname}${url.search}`;
  });
  const feedbackFilterUrl = (days: FeedbackRange) => {
    const url = new URL(viewHref("feedback"), "http://venue.local");
    if (days !== 30) url.searchParams.set("days", String(days));
    if (props.initialFeedbackSearch) url.searchParams.set("search", props.initialFeedbackSearch);
    return `${url.pathname}${url.search}`;
  };
  const setFeedbackDays = (value: string[]) => {
    const next = Number(value[0] ?? 30);
    navigateTo(feedbackFilterUrl(next === 7 || next === 14 ? next : 30));
  };
  const feedbackBucketsForDays = (days: number) => props.dashboard.feedback.buckets.filter((bucket) => withinLastDays(bucket.date, days));
  const feedbackThirtyDayBuckets = createMemo(() => feedbackBucketsForDays(30));
  const feedbackThirtyDayCount = createMemo(() => feedbackBucketCount(feedbackThirtyDayBuckets()));
  const feedbackThirtyDayAverage = createMemo(() => feedbackBucketAverage(feedbackThirtyDayBuckets()));
  const feedbackBuckets = createMemo(() => feedbackBucketsForDays(feedbackRangeDays()));
  const feedbackChartLabels = createMemo(() => feedbackBuckets().map((bucket) => fmtDate(bucket.date)));
  const feedbackChartData = createMemo(() =>
    feedbackBuckets()
      .map((bucket, index) => ({ bucket, index }))
      .filter(({ bucket }) => bucket.averageRating !== null)
      .map(({ bucket, index }) => ({ x: index + 1, y: bucket.averageRating ?? 0 })),
  );
  const filteredFeedbackEntries = createMemo(() =>
    props.dashboard.feedbackEntries.filter((entry) => withinLastDays(entry.createdAt, feedbackRangeDays())),
  );
  const openRegistrationCount = createMemo(() => props.dashboard.slots.reduce((sum, slot) => sum + slot.missingPeople, 0));
  const feedbackColumns: DataTableColumn<FeedbackEntry>[] = [
    { id: "rating", header: "Rating", value: (entry) => entry.rating, cellClass: "w-px" },
    { id: "comment", header: "Comment", value: (entry) => entry.comment, cellClass: "min-w-64" },
    { id: "created", header: "Submitted", value: (entry) => entry.createdAt, headerClass: "w-px", cellClass: "w-px whitespace-nowrap" },
  ];
  const selectedSection = createMemo(() => props.dashboard.sections.find((section) => section.id === selectedSectionId()) ?? null);
  const slotByKey = createMemo(() => new Map(props.dashboard.slots.map((slot) => [slot.key, slot])));
  const shiftEvents = createMemo<CalendarEvent[]>(() =>
    props.dashboard.slots.map((slot) => ({
      id: slot.key,
      title: slot.template.title,
      start: slot.startsAt,
      end: slot.endsAt,
      color: !isSlotActive(slot) || slot.full ? "zinc" : slot.missingPeople > 0 ? "amber" : "emerald",
      meta: slot.assignments.map((entry) => entry.userDisplayName).join(", ") || "No one yet",
      description: `${slot.assignedCount}/${slot.minPeople}${slot.maxPeople ? ` · max ${slot.maxPeople}` : ""}`,
    })),
  );
  const sectionHref = (section: PublicSection) => `/app/venue/${venue().id}/public-sections/${section.id}`;
  const calendarHref = (nextView: CalendarView, nextDate: Date) => {
    const normalizedView = nextView === "month" ? "month" : "week";
    const url = new URL(viewHref("shifts"), "http://venue.local");
    url.searchParams.set("cv", normalizedView);
    url.searchParams.set("cd", dateKey(nextDate));
    return `${url.pathname}?${url.searchParams.toString()}`;
  };

  const openSignup = async () => {
    await dialogCore.open<boolean>((close) => <SignupDialog dashboard={props.dashboard} close={close} />, panelDialogOptions);
  };

  const calendarSignup = mutation.create<void, UpcomingSlot>({
    mutation: async (slot) => {
      if (slot.full) throw new Error("This shift is already full.");
      if (!isSlotActive(slot)) throw new Error("This shift has already ended.");
      const res = await apiClient.venues[":id"].templates[":templateId"].signup.$post({
        param: { id: venue().id, templateId: slot.template.id },
        json: { date: slot.date },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to sign up."));
    },
    onSuccess: () => {
      toast.success("Shift added");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const signupFromCalendar = async (slot: UpcomingSlot) => {
    if (slot.full) {
      prompts.error("This shift is already full.");
      return;
    }
    if (!isSlotActive(slot)) {
      prompts.error("This shift has already ended.");
      return;
    }
    const skipConfirm = cookies.readJsonCookie(DOUBLE_CLICK_CONFIRM_COOKIE, false);
    const confirmed = skipConfirm
      ? true
      : await prompts.dialog<boolean>((close) => <ConfirmShiftSignupDialog slot={slot} timezone={venue().timezone} close={close} />, {
          title: "Join this shift?",
          icon: "ti ti-user-plus",
          size: "small",
        });
    if (confirmed) calendarSignup.mutate(slot);
  };

  const openSettings = async () => {
    await prompts.dialog<void>(
      (close) => (
        <SettingsDialog
          dashboard={props.dashboard}
          accessEntries={props.accessEntries}
          apiKeys={props.apiKeys}
          icalToken={props.icalToken}
          close={close}
        />
      ),
      {
        surface: "bare",
        header: false,
        size: "large",
      },
    );
  };

  const addSection = mutation.create<void, void>({
    mutation: async () => {
      const input = await dialogCore.open<PublicSectionInput | null>(
        (close) => <PublicSectionDialog close={close} nextPosition={props.dashboard.sections.length + 1} />,
        panelDialogOptions,
      );
      if (!input) return;
      const res = await apiClient.venues[":id"].sections.$post({
        param: { id: venue().id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to add public section."));
    },
    onSuccess: () => {
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const editSection = mutation.create<void, PublicSection>({
    mutation: async (section) => {
      const input = await dialogCore.open<PublicSectionInput | null>(
        (close) => (
          <PublicSectionDialog
            close={close}
            initial={section}
            nextPosition={section.position}
            title="Edit public section"
            submitLabel="Save section"
          />
        ),
        panelDialogOptions,
      );
      if (!input) return;
      const res = await apiClient.venues[":id"].sections[":resourceId"].$patch({
        param: { id: venue().id, resourceId: section.id },
        json: input,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update public section."));
    },
    onSuccess: () => {
      toast.success("Section updated");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const duplicateSection = mutation.create<void, PublicSection>({
    mutation: async (section) => {
      const res = await apiClient.venues[":id"].sections.$post({
        param: { id: venue().id },
        json: {
          kind: section.kind,
          title: `${section.title} copy`,
          content: section.content,
          enabled: section.enabled,
          position: props.dashboard.sections.length + 1,
        },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to duplicate public section."));
    },
    onSuccess: () => {
      toast.success("Section duplicated");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteSection = mutation.create<boolean, PublicSection>({
    mutation: async (section) => {
      const confirmed = await prompts.confirm(`Delete "${section.title}"?`, {
        title: "Delete public section",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return false;
      const res = await apiClient.venues[":id"].sections[":resourceId"].$delete({
        param: { id: venue().id, resourceId: section.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete public section."));
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Section deleted");
      setSelectedSectionId(null);
      window.history.replaceState({}, "", viewHref("shifts"));
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const cancelAssignment = mutation.create<void, ShiftAssignment>({
    mutation: async (assignment) => {
      const confirmed = await prompts.confirm(`Cancel shift for ${assignment.userDisplayName} at ${fmt(assignment.startsAt)}?`, {
        title: "Cancel shift",
        variant: "danger",
        confirmText: "Cancel shift",
      });
      if (!confirmed) return;
      const res = await apiClient.venues[":id"].assignments[":assignmentId"].$delete({
        param: { id: venue().id, assignmentId: assignment.id },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to cancel shift."));
      toast.success("Shift cancelled");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <AppWorkspace>
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader
          title={venue().name}
          icon={venue().icon || "ti ti-building-carousel"}
          action={
            <button
              type="button"
              onClick={openSettings}
              class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
              title="Settings"
              aria-label={`Settings for ${venue().name}`}
            >
              <i class="ti ti-settings text-xs" />
            </button>
          }
        />

        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems scrollPreserveKey={`venue-sidebar-mobile-${venue().id}`}>
            <Show when={canWrite(venue())}>
              <AppWorkspace.SidebarItem icon="ti ti-user-plus" tone="success" onClick={openSignup}>
                Sign up
              </AppWorkspace.SidebarItem>
            </Show>
            <AppWorkspace.SidebarItem href="/app/venue" navigation="document" icon="ti ti-layout-grid">
              All venues
            </AppWorkspace.SidebarItem>
            <For each={views}>
              {(item) => (
                <AppWorkspace.SidebarItem
                  href={viewHref(item.id)}
                  navigation="document"
                  icon={item.icon}
                  active={!selectedSectionId() && view() === item.id}
                >
                  {item.label}
                </AppWorkspace.SidebarItem>
              )}
            </For>
            <Show when={canAdmin(venue())}>
              <AppWorkspace.SidebarItem icon="ti ti-plus" tone="success" onClick={() => addSection.mutate()}>
                Add public section
              </AppWorkspace.SidebarItem>
            </Show>
            <For each={props.dashboard.sections}>
              {(section) => (
                <AppWorkspace.SidebarItem
                  href={sectionHref(section)}
                  navigation="document"
                  icon={sectionKindIcon(section.kind)}
                  active={selectedSectionId() === section.id}
                >
                  {section.title}
                </AppWorkspace.SidebarItem>
              )}
            </For>
            <a href={`/app/venue/public/${venue().slug}`} target="_blank" rel="noreferrer" class="sidebar-item-mobile">
              <i class="ti ti-external-link" />
              <span class="min-w-0 flex-1 truncate text-left">Public page</span>
            </a>
          </AppWorkspace.SidebarMobileItems>
        </AppWorkspace.SidebarMobile>

        <AppWorkspace.SidebarDesktop>
          <div class="flex flex-col gap-3">
            <AppWorkspace.SidebarSection title="Actions">
              <AppWorkspace.SidebarIconGrid columns={3}>
                <Show when={canWrite(venue())}>
                  <AppWorkspace.SidebarIconAction icon="ti ti-user-plus" label="Sign up for a shift" tone="success" onClick={openSignup} />
                </Show>
                <AppWorkspace.SidebarIconAction href="/app/venue" navigation="document" icon="ti ti-layout-grid" label="All venues" />
                <a
                  href={`/app/venue/public/${venue().slug}`}
                  target="_blank"
                  rel="noreferrer"
                  class="sidebar-icon-action"
                  title="Public page"
                  aria-label="Public page"
                >
                  <i class="ti ti-external-link text-base" />
                </a>
              </AppWorkspace.SidebarIconGrid>
            </AppWorkspace.SidebarSection>

            <AppWorkspace.SidebarSection title="Navigation">
              <For each={views}>
                {(item) => (
                  <AppWorkspace.SidebarItem
                    href={viewHref(item.id)}
                    navigation="document"
                    icon={item.icon}
                    active={!selectedSectionId() && view() === item.id}
                  >
                    {item.label}
                  </AppWorkspace.SidebarItem>
                )}
              </For>
            </AppWorkspace.SidebarSection>
          </div>

          <AppWorkspace.SidebarBody scrollPreserveKey={`venue-sidebar-${venue().id}`}>
            <AppWorkspace.SidebarSection title="Public sections">
              <Show when={canAdmin(venue())}>
                <AppWorkspace.SidebarItem icon="ti ti-plus" tone="success" onClick={() => addSection.mutate()}>
                  Add public section
                </AppWorkspace.SidebarItem>
              </Show>
              <For each={props.dashboard.sections} fallback={<p class="px-2 text-xs text-dimmed">No sections yet.</p>}>
                {(section) => (
                  <AppWorkspace.SidebarItem
                    href={sectionHref(section)}
                    navigation="document"
                    icon={sectionKindIcon(section.kind)}
                    active={selectedSectionId() === section.id}
                  >
                    {section.title}
                  </AppWorkspace.SidebarItem>
                )}
              </For>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Main>
        <div class="flex-1 min-h-0 overflow-y-auto" data-scroll-preserve={`venue-main-${venue().id}`} style="scrollbar-gutter: stable">
          <div class="flex flex-col gap-2">
            <StatGrid columns={3} class="shrink-0">
              <StatCell
                label="Customer satisfaction"
                value={feedbackThirtyDayAverage() === null ? "-" : `${feedbackThirtyDayAverage()!.toFixed(1)}/5`}
                sub={`${feedbackThirtyDayCount()} rating${feedbackThirtyDayCount() === 1 ? "" : "s"} · Last 30 days`}
                accent={{
                  tone: feedbackThirtyDayAverage() !== null && feedbackThirtyDayAverage()! >= 4 ? "emerald" : "amber",
                  icon: "ti ti-star",
                }}
              />
              <StatCell
                label="Open registrations"
                value={openRegistrationCount()}
                sub="still needed in visible shift window"
                accent={{
                  tone: openRegistrationCount() > 0 ? "amber" : "emerald",
                  icon: openRegistrationCount() > 0 ? "ti ti-user-plus" : "ti ti-check",
                }}
              />
              <StatCell
                label="My shifts"
                value={props.dashboard.myShiftCount}
                sub={`${props.dashboard.myUpcomingShifts.length} upcoming assignment${
                  props.dashboard.myUpcomingShifts.length === 1 ? "" : "s"
                }`}
                accent={{ tone: "blue", icon: "ti ti-user-check" }}
              />
            </StatGrid>

            <Show when={selectedSection()}>
              {(section) => (
                <section class="paper p-4">
                  <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                      <div class="mb-2 flex items-center gap-2">
                        <i class={`${sectionKindIcon(section().kind)} text-dimmed`} />
                        <span class="tag">{section().kind}</span>
                        <Show when={!section().enabled}>
                          <span class="tag bg-zinc-100 text-dimmed dark:bg-zinc-800">Hidden</span>
                        </Show>
                      </div>
                      <h2 class="text-lg font-semibold text-primary">{section().title}</h2>
                      <p class="text-xs text-dimmed">Preview of this public section.</p>
                    </div>
                    <Show when={canAdmin(venue())}>
                      <div class="flex flex-wrap gap-2">
                        <button
                          type="button"
                          class="btn-secondary btn-sm"
                          disabled={editSection.loading()}
                          onClick={() => editSection.mutate(section())}
                        >
                          <i class={editSection.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-pencil"} /> Edit
                        </button>
                        <button
                          type="button"
                          class="btn-secondary btn-sm"
                          disabled={duplicateSection.loading()}
                          onClick={() => duplicateSection.mutate(section())}
                        >
                          <i class={duplicateSection.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-copy"} /> Duplicate
                        </button>
                        <button
                          type="button"
                          class="btn-danger btn-sm"
                          disabled={deleteSection.loading()}
                          onClick={() => deleteSection.mutate(section())}
                        >
                          <i class={deleteSection.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} /> Delete
                        </button>
                      </div>
                    </Show>
                  </div>
                  <PublicSectionPreview section={section()} />
                </section>
              )}
            </Show>

            <Show when={!selectedSection() && view() === "shifts"}>
              <section class="paper flex min-h-[42rem] flex-col p-4">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <h2 class="section-label mb-0">Shifts</h2>
                  <Show when={canWrite(venue())}>
                    <button type="button" class="btn-primary btn-sm" onClick={openSignup}>
                      <i class="ti ti-user-plus" /> Sign up
                    </button>
                  </Show>
                </div>
                <div class="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-100 dark:border-zinc-800">
                  <Calendar
                    class="h-full"
                    date={calendarDate()}
                    view={calendarView()}
                    views={["week", "month"]}
                    events={shiftEvents()}
                    dateConfig={timeZoneDateConfig(venue().timezone)}
                    hideAllDay
                    startHour={7}
                    endHour={23}
                    visibleStartHour={8}
                    visibleEndHour={20}
                    getViewHref={(nextView) => calendarHref(nextView, calendarDate())}
                    getDateHref={(nextDate, nextView) => calendarHref(nextView, nextDate)}
                    onEventDoubleClick={(event) => {
                      const slot = slotByKey().get(event.id);
                      if (slot) void signupFromCalendar(slot);
                    }}
                    renderEvent={(event, context) => {
                      const slot = slotByKey().get(event.id);
                      const slotProgress = !context.compact ? slot : undefined;
                      const slotAttendees = context.durationHours >= 1.5 ? slot : undefined;
                      const ended = slot ? !isSlotActive(slot) : false;
                      return (
                        <div class="flex min-h-0 min-w-0 flex-col gap-1">
                          <span class="block truncate text-[11px] font-semibold">{event.title}</span>
                          <span class="block truncate text-[10px] opacity-75">
                            {fmtTime(context.start.toISOString(), venue().timezone)}-{fmtTime(context.end.toISOString(), venue().timezone)}
                          </span>
                          <Show
                            when={ended}
                            fallback={<Show when={slotProgress}>{(currentSlot) => <ProgressBar slot={currentSlot()} compact />}</Show>}
                          >
                            <span class="block truncate text-[10px] font-semibold opacity-75">Ended</span>
                          </Show>
                          <Show when={slotAttendees}>
                            {(currentSlot) => (
                              <span class="block truncate text-[10px] opacity-75">
                                {currentSlot()
                                  .assignments.map((entry) => entry.userDisplayName)
                                  .join(", ") || "No one yet"}
                              </span>
                            )}
                          </Show>
                        </div>
                      );
                    }}
                  />
                </div>
              </section>
            </Show>

            <Show when={!selectedSection() && view() === "my-shifts"}>
              <section class="paper p-4">
                <h2 class="section-label">My shifts</h2>
                <Show when={props.dashboard.myUpcomingShifts.length > 0} fallback={<p class="text-sm text-dimmed">No upcoming shifts.</p>}>
                  <div class="grid gap-2">
                    <For each={props.dashboard.myUpcomingShifts}>
                      {(shift) => (
                        <div class="paper flex items-center justify-between gap-3 p-3 text-sm">
                          <div class="min-w-0">
                            <p class="font-medium text-primary">{fmt(shift.startsAt)}</p>
                            <p class="text-xs text-dimmed">{shift.note || "Shift"}</p>
                          </div>
                          <button
                            type="button"
                            class="btn-danger btn-sm"
                            disabled={cancelAssignment.loading()}
                            onClick={() => cancelAssignment.mutate(shift)}
                          >
                            <i class={cancelAssignment.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-x"} /> Cancel
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </Show>

            <Show when={!selectedSection() && view() === "feedback"}>
              <section class="flex flex-col gap-3 px-1 py-2">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <h2 class="section-label mb-1">Feedback</h2>
                    <p class="text-sm text-dimmed">Average customer rating over the last {feedbackRangeDays()} days.</p>
                  </div>
                </div>

                <div class="h-64 rounded-xl px-1 py-2 text-dimmed">
                  <Chart
                    kind="line"
                    class="h-full min-h-0"
                    series={[{ label: "Average rating", data: feedbackChartData() }]}
                    xAxis={{ format: (value) => feedbackChartLabels()[Math.max(0, Math.round(value) - 1)] ?? "" }}
                    yAxis={{ format: (value) => `${value}/5` }}
                    smooth
                  />
                </div>

                <div class="flex items-stretch gap-2">
                  <div class="min-w-0 flex-1">
                    <SearchBar
                      action={feedbackSearchAction()}
                      value={props.initialFeedbackSearch}
                      placeholder="Search comments..."
                      ariaLabel="Search feedback comments"
                    />
                  </div>
                  <FilterChip
                    label={`Last ${feedbackRangeDays()} days`}
                    icon="ti ti-calendar"
                    options={feedbackRangeOptions}
                    value={[String(feedbackRangeDays())]}
                    onChange={setFeedbackDays}
                    isActive={feedbackRangeDays() !== 30}
                    defaultValue={["30"]}
                    position="bottom-right"
                  />
                </div>

                <div class="paper overflow-hidden">
                  <DataTable
                    rows={filteredFeedbackEntries()}
                    columns={feedbackColumns}
                    getRowId={(entry) => entry.id}
                    hoverRows
                    highlightColumns={false}
                    class="overflow-x-auto"
                    empty={`No feedback in the last ${feedbackRangeDays()} days.`}
                    renderCell={({ row: entry, col, value, render }) => {
                      if (col.id === "rating") {
                        return (
                          <span class="inline-flex items-center gap-0.5 whitespace-nowrap text-amber-500 dark:text-amber-400">
                            <For each={[1, 2, 3, 4, 5]}>
                              {(star) => (
                                <i class={`ti ti-star text-sm ${star <= entry.rating ? "" : "text-zinc-300 dark:text-zinc-600"}`} />
                              )}
                            </For>
                          </span>
                        );
                      }
                      if (col.id === "comment") {
                        return <span class={entry.comment ? "text-primary" : "italic text-dimmed"}>{entry.comment || "No comment"}</span>;
                      }
                      if (col.id === "created") return fmt(entry.createdAt);
                      return render(value);
                    }}
                  />
                </div>
              </section>
            </Show>
          </div>
        </div>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
