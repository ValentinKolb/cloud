import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import type { CalendarView } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import { venueService } from "../../service";
import VenueWorkspace from "../_components/VenueWorkspace.island";

const calendarViews: CalendarView[] = ["week", "month"];

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

  const legacySectionId = url.searchParams.get("section");
  const legacyView = url.searchParams.get("view");
  if (legacySectionId) {
    url.searchParams.delete("section");
    url.searchParams.delete("view");
    return c.redirect(`/app/venue/${venue.id}/public-sections/${legacySectionId}${url.search}`);
  }
  if (legacyView === "my-shifts" || legacyView === "feedback" || legacyView === "shifts") {
    url.searchParams.delete("view");
    return c.redirect(`${viewPath(venue.id, legacyView)}${url.search}`);
  }

  const pathView = c.req.param("view");
  const initialSectionId = c.req.param("sectionId") ?? null;
  if (!pathView && !initialSectionId) return c.redirect(`${viewPath(venue.id, "shifts")}${url.search}`);
  const initialView = pathView === "my-shifts" || pathView === "feedback" || pathView === "shifts" ? pathView : "shifts";
  if (pathView && initialView === "shifts" && pathView !== "shifts") return c.redirect(viewPath(venue.id, "shifts"));
  const calendarViewParam = url.searchParams.get("cv") as CalendarView | null;
  const initialCalendarView = calendarViewParam && calendarViews.includes(calendarViewParam) ? calendarViewParam : "week";
  const initialCalendarDate = parseCalendarDate(url.searchParams.get("cd"));
  const slots =
    initialView === "shifts" ? slotWindow(initialCalendarView, initialCalendarDate) : { startDate: initialCalendarDate, days: 14 };
  const [dashboard, icalToken, accessEntries] = await Promise.all([
    venueService.dashboard(venue, user, {
      slotStartDate: slots.startDate,
      slotDays: slots.days,
      includeFeedbackEntries: initialView === "feedback",
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
        initialView={initialView}
        initialSectionId={initialSectionId}
        initialCalendarView={initialCalendarView}
        initialCalendarDate={initialCalendarDate}
      />
    </Layout>
  );
});
