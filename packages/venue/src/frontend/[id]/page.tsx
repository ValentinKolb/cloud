import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import type { CalendarView } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import { venueService } from "../../service";
import VenueWorkspace from "../_components/VenueWorkspace.island";

const calendarViews: CalendarView[] = ["week", "month"];
const feedbackDaysOptions = [7, 14, 30] as const;
type FeedbackDays = (typeof feedbackDaysOptions)[number];

const parseCalendarDate = (value: string | null): string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date().toISOString().slice(0, 10);
  return value;
};

const shiftDate = (date: string, days: number): string => {
  const [year = "1970", month = "1", day = "1"] = date.split("-");
  const next = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days, 12));
  return next.toISOString().slice(0, 10);
};

const slotWindow = (view: CalendarView, date: string): { startDate: string; days: number } => {
  if (view === "month") return { startDate: shiftDate(date, -7), days: 45 };
  return { startDate: shiftDate(date, -7), days: 14 };
};

const viewPath = (id: string, view: "shifts" | "my-shifts" | "feedback") => `/app/venue/${id}/${view}`;
const parseFeedbackDays = (value: string | null): FeedbackDays => {
  const parsed = Number(value);
  return feedbackDaysOptions.includes(parsed as FeedbackDays) ? (parsed as FeedbackDays) : 30;
};

type ResolvedView = {
  initialView: "shifts" | "my-shifts" | "feedback";
  initialSectionId: string | null;
  redirectTo?: string;
};

const legacyRedirect = (url: URL, venueId: string): string | null => {
  const legacySectionId = url.searchParams.get("section");
  const legacyView = url.searchParams.get("view");
  if (legacySectionId) {
    url.searchParams.delete("section");
    url.searchParams.delete("view");
    return `/app/venue/${venueId}/public-sections/${legacySectionId}${url.search}`;
  }
  if (legacyView === "my-shifts" || legacyView === "feedback" || legacyView === "shifts") {
    url.searchParams.delete("view");
    return `${viewPath(venueId, legacyView)}${url.search}`;
  }
  return null;
};

const resolveView = (venueId: string, pathView: string | undefined, sectionId: string | undefined, search: string): ResolvedView => {
  const initialSectionId = sectionId ?? null;
  if (!pathView && !initialSectionId)
    return { initialView: "shifts", initialSectionId, redirectTo: `${viewPath(venueId, "shifts")}${search}` };
  if (pathView === "my-shifts" || pathView === "feedback" || pathView === "shifts") return { initialView: pathView, initialSectionId };
  if (pathView) return { initialView: "shifts", initialSectionId, redirectTo: viewPath(venueId, "shifts") };
  return { initialView: "shifts", initialSectionId };
};

export default ssr<AuthContext>(async (c) => {
  const id = c.req.param("id");
  if (!id) return c.redirect("/app/venue");
  const url = new URL(c.req.raw.url);
  const user = c.get("user");
  const venue = await venueService.venues.get(id, user);

  if (!venue) {
    return () => (
      <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Venues", href: "/app/venue" }, { title: "Not found" }]} fullWidth>
        <div class="paper m-4 p-6 text-sm text-dimmed">Venue not found or not accessible.</div>
      </Layout>
    );
  }

  const access = await venueService.access.require(venue.id, user, "read");
  if (!access.ok) return c.redirect("/app/venue");

  const legacyTarget = legacyRedirect(url, venue.id);
  if (legacyTarget) return c.redirect(legacyTarget);

  const pathView = c.req.param("view");
  const resolved = resolveView(venue.id, pathView, c.req.param("sectionId"), url.search);
  if (resolved.redirectTo) return c.redirect(resolved.redirectTo);
  const calendarViewParam = url.searchParams.get("cv") as CalendarView | null;
  const initialCalendarView = calendarViewParam && calendarViews.includes(calendarViewParam) ? calendarViewParam : "week";
  const initialCalendarDate = parseCalendarDate(url.searchParams.get("cd"));
  const initialFeedbackDays = parseFeedbackDays(url.searchParams.get("days"));
  const initialFeedbackSearch = (url.searchParams.get("search") ?? "").trim();
  const slots =
    resolved.initialView === "shifts" ? slotWindow(initialCalendarView, initialCalendarDate) : { startDate: initialCalendarDate, days: 14 };
  const [dashboard, icalToken, accessEntries] = await Promise.all([
    venueService.dashboard(venue, user, {
      slotStartDate: slots.startDate,
      slotDays: slots.days,
      includeFeedbackEntries: resolved.initialView === "feedback",
      feedbackDays: initialFeedbackDays,
      feedbackSearch: initialFeedbackSearch || undefined,
    }),
    venueService.ical.getOrCreateToken(user.id),
    venue.permission === "admin" ? venueService.access.list(venue.id) : Promise.resolve([]),
  ]);

  return () => (
    <Layout
      c={c}
      title={[{ title: "Start", href: "/" }, { title: "Venues", href: "/app/venue" }, { title: venue.name }]}
      fullWidth
      fullPage
    >
      <VenueWorkspace
        dashboard={dashboard}
        userId={user.id}
        icalToken={icalToken}
        accessEntries={accessEntries}
        initialView={resolved.initialView}
        initialSectionId={resolved.initialSectionId}
        initialCalendarView={initialCalendarView}
        initialCalendarDate={initialCalendarDate}
        initialFeedbackDays={initialFeedbackDays}
        initialFeedbackSearch={initialFeedbackSearch}
      />
    </Layout>
  );
});
