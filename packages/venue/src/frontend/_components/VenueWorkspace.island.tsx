import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import {
  AppWorkspace,
  Calendar,
  type CalendarEvent,
  type CalendarView,
  Chart,
  DataTable,
  type DataTableColumn,
  Dropdown,
  dialogCore,
  FilterChip,
  Placeholder,
  panelDialogOptions,
  prompts,
  StatCell,
  StatGrid,
  toast,
} from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { cookies } from "@valentinkolb/stdlib/browser";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { FeedbackEntry, PublicSection, PublicSectionInput, ShiftAssignment, UpcomingSlot } from "../../contracts";
import { DOUBLE_CLICK_CONFIRM_COOKIE, feedbackRangeOptions, views } from "./venue-workspace/constants";
import { openVenuePublicDisplayDialog } from "./venue-workspace/public-display";
import { PublicSectionDialog, PublicSectionPreview, sectionKindIcon } from "./venue-workspace/public-sections";
import { ProgressBar } from "./venue-workspace/schedule";
import { SettingsDialog } from "./venue-workspace/settings";
import { ConfirmShiftSignupDialog, SignupDialog } from "./venue-workspace/signup";
import type { FeedbackRange, VenueView, VenueWorkspaceProps } from "./venue-workspace/types";
import {
  canAdmin,
  canWrite,
  dateKey,
  feedbackBucketAverage,
  feedbackBucketCount,
  fmt,
  fmtDate,
  fmtTime,
  isSlotActive,
  parseDateKey,
  readError,
  timeZoneDateConfig,
  withinLastDays,
} from "./venue-workspace/utils";

function ViewHeader(props: { title: string; description: string; action?: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-2 px-1 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-base font-semibold text-primary">{props.title}</h1>
        <p class="text-xs text-dimmed">{props.description}</p>
      </div>
      <Show when={props.action}>
        <div class="flex shrink-0 flex-wrap gap-2">{props.action}</div>
      </Show>
    </div>
  );
}

const permissionLabel = (permission: VenueWorkspaceProps["dashboard"]["venue"]["permission"]): string => {
  if (permission === "admin") return "Admin";
  if (permission === "write") return "Staff";
  return "Viewer";
};

export default function VenueWorkspace(props: VenueWorkspaceProps) {
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
  const feedbackBuckets = createMemo(() => feedbackBucketsForDays(feedbackRangeDays()));
  const feedbackRangeCount = createMemo(() => feedbackBucketCount(feedbackBuckets()));
  const feedbackRangeAverage = createMemo(() => feedbackBucketAverage(feedbackBuckets()));
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
  const activeSlots = createMemo(() => props.dashboard.slots.filter(isSlotActive));
  const openRegistrationCount = createMemo(() => activeSlots().reduce((sum, slot) => sum + slot.missingPeople, 0));
  const feedbackCommentCount = createMemo(() => filteredFeedbackEntries().filter((entry) => Boolean(entry.comment?.trim())).length);
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
  const collapsedPublicContentMenu = () => [
    {
      sectionLabel: "Public content",
      items: [
        ...(canAdmin(venue()) ? [{ icon: "ti ti-plus", label: "Add public section", action: () => addSection.mutate() }] : []),
        ...props.dashboard.sections.map((section) => ({
          icon: sectionKindIcon(section.kind),
          label: section.title,
          href: sectionHref(section),
        })),
      ],
    },
  ];
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
  const openPublicPage = () => openVenuePublicDisplayDialog(venue().slug);

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
      <AppWorkspace.Sidebar collapsible>
        <AppWorkspace.SidebarHeader
          title={venue().name}
          subtitle={permissionLabel(venue().permission)}
          icon={venue().icon || "ti ti-building-carousel"}
          iconStyle={`background-color: color-mix(in srgb, ${venue().accentColor} 12%, var(--ui-surface)); color: ${
            venue().accentColor
          }; box-shadow: inset 0 0 0 1px color-mix(in srgb, ${venue().accentColor} 22%, transparent)`}
          iconViewTransitionName={`venue-color-${venue().id}`}
          titleViewTransitionName={`venue-name-${venue().id}`}
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
            <AppWorkspace.SidebarItem icon="ti ti-device-tv" onClick={openPublicPage}>
              Public page
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
            <AppWorkspace.SidebarItem icon="ti ti-settings" onClick={openSettings}>
              Venue settings
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarMobileItems>
        </AppWorkspace.SidebarMobile>

        <AppWorkspace.SidebarDesktop>
          <div class="flex flex-col gap-3">
            <AppWorkspace.SidebarIconGrid columns={canWrite(venue()) ? 3 : 2} sidebarMode="expanded">
              <Show when={canWrite(venue())}>
                <AppWorkspace.SidebarIconAction icon="ti ti-user-plus" label="Sign up for a shift" tone="success" onClick={openSignup} />
              </Show>
              <AppWorkspace.SidebarIconAction icon="ti ti-device-tv" label="Public page" onClick={openPublicPage} />
              <AppWorkspace.SidebarIconAction href="/app/venue" navigation="document" icon="ti ti-layout-grid" label="All venues" />
            </AppWorkspace.SidebarIconGrid>

            <AppWorkspace.SidebarSection title="Workspace" sidebarMode="expanded">
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

          <AppWorkspace.SidebarIconGrid sidebarMode="collapsed">
            <Show when={canWrite(venue())}>
              <AppWorkspace.SidebarIconAction icon="ti ti-user-plus" label="Sign up for a shift" tone="success" onClick={openSignup} />
            </Show>
            <AppWorkspace.SidebarIconAction icon="ti ti-device-tv" label="Public page" onClick={openPublicPage} />
            <AppWorkspace.SidebarIconAction href="/app/venue" navigation="document" icon="ti ti-layout-grid" label="All venues" />
            <For each={views}>
              {(item) => (
                <AppWorkspace.SidebarIconAction
                  href={viewHref(item.id)}
                  navigation="document"
                  icon={item.icon}
                  label={item.label}
                  active={!selectedSectionId() && view() === item.id}
                />
              )}
            </For>
            <Show when={canAdmin(venue()) || props.dashboard.sections.length > 0}>
              <Dropdown
                trigger={
                  <AppWorkspace.SidebarIconAction icon="ti ti-layout-list" label="Public content" active={Boolean(selectedSectionId())} />
                }
                elements={collapsedPublicContentMenu()}
                position="right-start"
                width="w-64"
                triggerClass="flex w-full"
                openOnHover
              />
            </Show>
          </AppWorkspace.SidebarIconGrid>

          <AppWorkspace.SidebarBody scrollPreserveKey={`venue-sidebar-${venue().id}`} sidebarMode="expanded">
            <AppWorkspace.SidebarSection title="Public content">
              <Show when={canAdmin(venue())}>
                <AppWorkspace.SidebarItem icon="ti ti-plus" tone="success" onClick={() => addSection.mutate()}>
                  Add public section
                </AppWorkspace.SidebarItem>
              </Show>
              <For
                each={props.dashboard.sections}
                fallback={
                  <Placeholder align="left" class="px-2 py-2">
                    No sections yet.
                  </Placeholder>
                }
              >
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

          <AppWorkspace.SidebarFooter sidebarMode="expanded">
            <AppWorkspace.SidebarItem icon="ti ti-settings" onClick={openSettings}>
              Venue settings
            </AppWorkspace.SidebarItem>
          </AppWorkspace.SidebarFooter>
          <AppWorkspace.SidebarFooter sidebarMode="collapsed">
            <AppWorkspace.SidebarIconGrid>
              <AppWorkspace.SidebarIconAction icon="ti ti-settings" label="Venue settings" onClick={openSettings} />
            </AppWorkspace.SidebarIconGrid>
          </AppWorkspace.SidebarFooter>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Content>
        <AppWorkspace.Main class="p-[var(--ui-space-shell)]">
        <div class="flex-1 min-h-0 overflow-y-auto" data-scroll-preserve={`venue-main-${venue().id}`} style="scrollbar-gutter: stable">
          <div class="flex flex-col gap-2">
            <Show when={selectedSection()}>
              {(section) => (
                <>
                  <ViewHeader
                    title={section().title}
                    description="Preview this section as it appears on the public venue page."
                    action={
                      <>
                        <button type="button" class="btn-secondary btn-sm" onClick={openPublicPage}>
                          <i class="ti ti-device-tv" /> Public page
                        </button>
                        <Show when={canAdmin(venue())}>
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
                            class="btn-secondary btn-sm px-2"
                            disabled={duplicateSection.loading()}
                            onClick={() => duplicateSection.mutate(section())}
                            title="Duplicate section"
                            aria-label="Duplicate section"
                          >
                            <i class={duplicateSection.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-copy"} />
                          </button>
                          <button
                            type="button"
                            class="btn-danger btn-sm px-2"
                            disabled={deleteSection.loading()}
                            onClick={() => deleteSection.mutate(section())}
                            title="Delete section"
                            aria-label="Delete section"
                          >
                            <i class={deleteSection.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
                          </button>
                        </Show>
                      </>
                    }
                  />
                  <div class="flex items-center gap-2 px-1">
                    <i class={`${sectionKindIcon(section().kind)} text-dimmed`} />
                    <span class="tag">{section().kind}</span>
                    <Show when={!section().enabled}>
                      <span class="tag bg-zinc-100 text-dimmed dark:bg-zinc-800">Hidden</span>
                    </Show>
                  </div>
                  <section class="paper p-4">
                    <PublicSectionPreview section={section()} />
                  </section>
                </>
              )}
            </Show>

            <Show when={!selectedSection() && view() === "shifts"}>
              <>
                <ViewHeader
                  title="Schedule"
                  description="See staffing coverage and join an available shift."
                  action={
                    <Show when={canWrite(venue())}>
                      <button type="button" class="btn-primary btn-sm" onClick={openSignup}>
                        <i class="ti ti-user-plus" /> Sign up
                      </button>
                    </Show>
                  }
                />
                <StatGrid columns={3} size="sm" class="shrink-0">
                  <StatCell
                    label="Open spots"
                    value={openRegistrationCount()}
                    sub="people still needed in this window"
                    accent={{
                      tone: openRegistrationCount() > 0 ? "amber" : "emerald",
                      icon: openRegistrationCount() > 0 ? "ti ti-user-plus" : "ti ti-check",
                    }}
                  />
                  <StatCell
                    label="Upcoming shifts"
                    value={activeSlots().length}
                    sub="visible in the current calendar window"
                    accent={{ tone: "blue", icon: "ti ti-calendar-event" }}
                  />
                  <StatCell
                    label="My upcoming"
                    value={props.dashboard.myUpcomingShifts.length}
                    sub={`${props.dashboard.myShiftCount} assignment${props.dashboard.myShiftCount === 1 ? "" : "s"} in total`}
                    accent={{ tone: "blue", icon: "ti ti-user-check" }}
                  />
                </StatGrid>
                <Calendar
                  class="min-h-[42rem] flex-1"
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
              </>
            </Show>

            <Show when={!selectedSection() && view() === "my-shifts"}>
              <>
                <ViewHeader
                  title="My shifts"
                  description="Review your upcoming assignments or subscribe to them in your calendar."
                  action={
                    <>
                      <a class="btn-secondary btn-sm" href={`/api/venue/calendar/${props.icalToken}.ics`}>
                        <i class="ti ti-calendar-down" /> iCal
                      </a>
                      <Show when={canWrite(venue())}>
                        <button type="button" class="btn-primary btn-sm" onClick={openSignup}>
                          <i class="ti ti-user-plus" /> Sign up
                        </button>
                      </Show>
                    </>
                  }
                />
                <section class="paper p-2">
                  <Show
                    when={props.dashboard.myUpcomingShifts.length > 0}
                    fallback={
                      <Placeholder align="left" class="px-2 py-6">
                        You have no upcoming shifts.
                      </Placeholder>
                    }
                  >
                    <div class="grid gap-1">
                      <For each={props.dashboard.myUpcomingShifts}>
                        {(shift) => (
                          <div class="flex items-center justify-between gap-3 rounded-lg px-3 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
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
              </>
            </Show>

            <Show when={!selectedSection() && view() === "feedback"}>
              <section class="flex flex-col gap-2">
                <ViewHeader
                  title="Feedback"
                  description={`Visitor ratings and comments from the last ${feedbackRangeDays()} days.`}
                  action={
                    <Show when={venue().feedbackEnabled}>
                      <a href={`/app/venue/public/${venue().slug}/feedback`} target="_blank" rel="noreferrer" class="btn-secondary btn-sm">
                        <i class="ti ti-external-link" /> Feedback page
                      </a>
                    </Show>
                  }
                />

                <StatGrid columns={3} size="sm" class="shrink-0">
                  <StatCell
                    label="Average rating"
                    value={feedbackRangeAverage() === null ? "-" : `${feedbackRangeAverage()!.toFixed(1)}/5`}
                    sub={`over the last ${feedbackRangeDays()} days`}
                    accent={{
                      tone: feedbackRangeAverage() !== null && feedbackRangeAverage()! >= 4 ? "emerald" : "amber",
                      icon: "ti ti-star",
                    }}
                  />
                  <StatCell
                    label="Ratings"
                    value={feedbackRangeCount()}
                    sub={`received in the last ${feedbackRangeDays()} days`}
                    accent={{ tone: "blue", icon: "ti ti-message-star" }}
                  />
                  <StatCell
                    label="Comments"
                    value={feedbackCommentCount()}
                    sub="ratings with written feedback"
                    accent={{ tone: "blue", icon: "ti ti-message" }}
                  />
                </StatGrid>

                <div class="paper h-64 p-3 text-dimmed">
                  <Chart
                    kind="line"
                    class="h-full min-h-0"
                    series={[{ label: "Average rating", data: feedbackChartData() }]}
                    xAxis={{ format: (value) => feedbackChartLabels()[Math.max(0, Math.round(value) - 1)] ?? "" }}
                    yAxis={{ format: (value) => `${value}/5` }}
                    smooth
                  />
                </div>

                <div class="flex items-stretch gap-2 px-1">
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
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
