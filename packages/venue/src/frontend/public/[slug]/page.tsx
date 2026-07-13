import { coreSettings } from "@valentinkolb/cloud/services";
import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { qr } from "@valentinkolb/stdlib/qr";
import { ssr } from "../../../config";
import type { PublicOpening, PublicSection, PublicStatus } from "../../../contracts";
import { venueService } from "../../../service";
import PublicFeedbackForm from "../../_components/PublicFeedbackForm.island";
import {
  buildPublicVenueFeedbackUrl,
  buildPublicVenueUrl,
  parseVenuePublicDisplayHeight,
  resolveVenuePublicOrigin,
} from "../../public-runtime";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const sectionText = (section: PublicSection, key: string): string => {
  const value = section.content[key];
  return typeof value === "string" ? value : "";
};

const groupedOpeningHours = (
  rules: Array<{ weekday: number; startTime: string; endTime: string; note: string | null }>,
): Array<{ weekday: number; windows: string }> =>
  weekdays
    .map((_, weekday) => {
      const windows = rules
        .filter((rule) => rule.weekday === weekday)
        .map((rule) => `${rule.startTime}-${rule.endTime}${rule.note ? ` (${rule.note})` : ""}`);
      return { weekday, windows: windows.join(" & ") };
    })
    .filter((entry) => entry.windows);

function PublicSectionView(props: { section: PublicSection }) {
  const section = props.section;
  if (section.kind === "markdown") {
    return (
      <section class="rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-black/5">
        <h2 class="mb-3 text-base font-semibold text-zinc-950">{section.title}</h2>
        <MarkdownView
          html={markdown.renderSync(sectionText(section, "markdown"))}
          class="!text-zinc-700 [&_a]:!text-blue-700 [&_blockquote]:!text-zinc-700 [&_code]:!text-zinc-950 [&_h1]:!text-zinc-950 [&_h2]:!text-zinc-950 [&_h3]:!text-zinc-950 [&_h4]:!text-zinc-950 [&_h5]:!text-zinc-950 [&_h6]:!text-zinc-950 [&_li]:!text-zinc-700 [&_p]:!text-zinc-700 [&_strong]:!text-zinc-950"
        />
      </section>
    );
  }
  if (section.kind === "menu") {
    const items = Array.isArray(section.content.items) ? section.content.items : [];
    return (
      <section class="rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-black/5">
        <h2 class="mb-3 text-base font-semibold text-zinc-950">{section.title}</h2>
        <div class="flex flex-col gap-3">
          {items.map((raw) => {
            const item = raw as Record<string, unknown>;
            const image = typeof item.image === "string" ? item.image : "";
            return (
              <div class="border-b border-zinc-200 pb-3 last:border-0 last:pb-0">
                <div class="flex items-start justify-between gap-3">
                  {image ? <img src={image} alt="" class="h-16 w-16 shrink-0 rounded-xl object-cover" /> : null}
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-zinc-950">{String(item.name ?? "Item")}</p>
                    {item.description ? <p class="mt-1 text-sm text-zinc-600">{String(item.description)}</p> : null}
                    {item.info || item.allergens ? <p class="mt-1 text-xs text-zinc-500">({String(item.info ?? item.allergens)})</p> : null}
                  </div>
                  {item.price ? <span class="shrink-0 text-sm font-semibold text-zinc-800">{String(item.price)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }
  if (section.kind === "links") {
    const links = Array.isArray(section.content.links) ? section.content.links : [];
    return (
      <section class="rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-black/5">
        <h2 class="mb-3 text-base font-semibold text-zinc-950">{section.title}</h2>
        <div class="flex flex-col gap-2">
          {links.length > 0 ? (
            links.map((raw) => {
              const link = raw as Record<string, unknown>;
              const href = String(link.href ?? "#");
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  class="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-950 no-underline transition-colors hover:bg-zinc-100"
                >
                  <i class="ti ti-link text-zinc-500" />
                  <span class="min-w-0 flex-1 truncate">{String(link.label ?? href)}</span>
                  <i class="ti ti-external-link text-zinc-400" />
                </a>
              );
            })
          ) : (
            <p class="text-sm text-zinc-700">{sectionText(section, "text")}</p>
          )}
        </div>
      </section>
    );
  }
  return (
    <section class="rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-black/5">
      <h2 class="mb-2 text-base font-semibold text-zinc-950">{section.title}</h2>
      <p class="text-sm text-zinc-700">{sectionText(section, "text") || sectionText(section, "markdown")}</p>
    </section>
  );
}

const formatOpeningDate = (opening: PublicOpening, timezone: string): string =>
  new Intl.DateTimeFormat("en", { timeZone: timezone, weekday: "short", day: "2-digit", month: "short" }).format(
    new Date(opening.startsAt),
  );

const formatOpeningTime = (opening: PublicOpening, timezone: string): string => {
  const formatter = new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${formatter.format(new Date(opening.startsAt))}-${formatter.format(new Date(opening.endsAt))}`;
};

function VenueIdentity(props: { status: PublicStatus; compact?: boolean }) {
  const status = props.status;
  return (
    <div class="flex min-w-0 items-center gap-4">
      {status.venue.logoBase64 ? (
        <img
          src={status.venue.logoBase64}
          alt=""
          class={`${props.compact ? "size-14" : "size-16"} shrink-0 rounded-2xl bg-white object-contain p-2 shadow-lg`}
        />
      ) : (
        <span
          class={`${props.compact ? "size-14 text-2xl" : "size-16 text-3xl"} flex shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20`}
          style={{ color: status.venue.accentColor }}
        >
          <i class={status.venue.icon || "ti ti-building-carousel"} />
        </span>
      )}
      <div class="min-w-0">
        <h1 class={`${props.compact ? "text-3xl" : "text-3xl sm:text-5xl"} truncate font-semibold`}>{status.venue.name}</h1>
        {status.venue.description && <p class="mt-1 line-clamp-2 max-w-3xl text-sm text-white/75">{status.venue.description}</p>}
      </div>
    </div>
  );
}

function StatusCard(props: { status: PublicStatus; display?: boolean }) {
  const status = props.status;
  return (
    <section
      class={`${props.display ? "flex min-h-0 flex-col justify-center rounded-2xl p-6 lg:p-8" : "rounded-3xl p-6 shadow-xl"} ${
        status.open ? "text-white" : "bg-zinc-900/90 text-white ring-1 ring-white/10"
      }`}
      style={status.open ? { "background-color": status.venue.accentColor } : undefined}
    >
      <p class="text-sm font-medium uppercase opacity-75">Current status</p>
      <p class={`${props.display ? "mt-3 text-6xl" : "mt-2 text-4xl"} font-semibold`}>{status.open ? "Open" : "Closed"}</p>
      <p class="mt-3 text-sm opacity-85">
        {status.activeWindowLabel ? `Open ${status.activeWindowLabel}` : `Today's hours: ${status.todayLabel}`}
      </p>
      {status.spontaneousOpen && (
        <p class="mt-3 rounded-xl bg-white/15 px-3 py-2 text-sm text-white/90">Staffing makes this venue additionally open right now.</p>
      )}
    </section>
  );
}

function RegularHours(props: { status: PublicStatus; display?: boolean }) {
  const entries = groupedOpeningHours(props.status.openingRules);
  if (props.status.venue.openMode === "staffed" || entries.length === 0) return null;
  return (
    <section
      class={`${props.display ? "min-h-0 overflow-hidden rounded-2xl bg-white/95 p-5" : "rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-black/5"}`}
    >
      <h2 class="mb-3 text-base font-semibold text-zinc-950">Regular opening hours</h2>
      <div class="flex flex-col gap-2">
        {entries.map((entry) => (
          <div class="flex items-start justify-between gap-3 text-sm">
            <span class="font-medium text-zinc-800">{weekdays[entry.weekday]}</span>
            <span class="text-right text-zinc-600">{entry.windows}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function UpcomingOpenings(props: { status: PublicStatus; display?: boolean }) {
  const openings = props.display ? props.status.upcomingOpenings.slice(0, 5) : props.status.upcomingOpenings;
  if (openings.length === 0 && !props.display) return null;
  return (
    <section
      class={`${props.display ? "min-h-0 overflow-hidden rounded-2xl bg-white/95 p-5" : "rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-black/5"}`}
    >
      <h2 class="mb-3 text-base font-semibold text-zinc-950">Upcoming staffed openings</h2>
      {openings.length > 0 ? (
        <div class="flex flex-col divide-y divide-zinc-200">
          {openings.map((opening) => (
            <div class="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-zinc-900">{opening.title}</p>
                <p class="text-xs text-zinc-500">{formatOpeningDate(opening, props.status.venue.timezone)}</p>
              </div>
              <span class="shrink-0 text-sm font-medium text-zinc-700">{formatOpeningTime(opening, props.status.venue.timezone)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p class="text-sm leading-relaxed text-zinc-600">No additional staffed opening is confirmed yet.</p>
      )}
    </section>
  );
}

function AutoRefresh() {
  return <script>{`setTimeout(function () { window.location.reload(); }, 60000);`}</script>;
}

function FullDisplay(props: { status: PublicStatus; publicUrl: string; feedbackQr: string | null }) {
  const status = props.status;
  const hasRegularHours = status.venue.openMode !== "staffed" && groupedOpeningHours(status.openingRules).length > 0;
  const hasStaffedOpenings = status.venue.openMode !== "regular";
  const hasSecondaryColumn = hasStaffedOpenings || status.venue.feedbackEnabled;
  return (
    <main class="relative h-screen overflow-hidden bg-zinc-950 text-white">
      <AutoRefresh />
      {status.venue.bannerBase64 && (
        <img src={status.venue.bannerBase64} alt="" class="absolute inset-0 size-full object-cover opacity-25" />
      )}
      <div class="absolute inset-0 bg-black/70" />
      <div class="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 p-5 lg:p-8">
        <header class="flex min-w-0 items-center justify-between gap-4">
          <VenueIdentity status={status} compact />
          <a href={props.publicUrl} class="btn-base btn-sm shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20">
            <i class="ti ti-external-link" /> Venue page
          </a>
        </header>

        <div class={`grid min-h-0 gap-4 ${hasSecondaryColumn ? "lg:grid-cols-[1.05fr_0.95fr]" : "grid-cols-1"}`}>
          <div class={`grid min-h-0 gap-4 ${hasRegularHours ? "grid-rows-[minmax(12rem,0.8fr)_minmax(0,1.2fr)]" : "grid-rows-1"}`}>
            <StatusCard status={status} display />
            <RegularHours status={status} display />
          </div>
          {hasSecondaryColumn ? (
            <div
              class={`grid min-h-0 gap-4 ${hasStaffedOpenings && status.venue.feedbackEnabled ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-rows-1"}`}
            >
              {hasStaffedOpenings ? <UpcomingOpenings status={status} display /> : null}
              {status.venue.feedbackEnabled && props.feedbackQr ? (
                <section
                  class={`flex min-h-0 items-center gap-5 rounded-2xl bg-white/95 p-5 text-zinc-950 ${hasStaffedOpenings ? "" : "self-center"}`}
                >
                  <div class="size-36 shrink-0 [&_svg]:block [&_svg]:size-full" innerHTML={props.feedbackQr} />
                  <div class="min-w-0">
                    <p class="text-lg font-semibold">Share feedback</p>
                    <p class="mt-1 text-sm leading-relaxed text-zinc-600">Scan to leave an anonymous rating on your phone.</p>
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function ScrollablePage(props: { status: PublicStatus }) {
  const status = props.status;
  return (
    <main class="min-h-screen bg-zinc-100 text-zinc-950">
      <div class="relative min-h-[42vh] overflow-hidden bg-zinc-950 text-white">
        {status.venue.bannerBase64 && (
          <img src={status.venue.bannerBase64} alt="" class="absolute inset-0 size-full object-cover opacity-45" />
        )}
        <div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/35 to-black/75" />
        <div class="relative mx-auto flex min-h-[42vh] max-w-6xl flex-col justify-end gap-6 p-6 sm:p-10">
          <VenueIdentity status={status} />
          <div class="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
            <StatusCard status={status} />
            <section class="rounded-3xl bg-white/95 p-6 text-zinc-950 shadow-xl">
              <p class="text-sm font-medium uppercase text-zinc-500">Today</p>
              <p class="mt-2 text-2xl font-semibold">{status.todayLabel}</p>
              {status.nextOpeningLabel && <p class="mt-3 text-sm text-zinc-600">Next opening: {status.nextOpeningLabel}</p>}
            </section>
          </div>
        </div>
      </div>

      <div class="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-[1fr_22rem]">
        <div class="flex flex-col gap-4">
          {status.sections.map((section) => (
            <PublicSectionView section={section} />
          ))}
        </div>
        <aside class="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <RegularHours status={status} />
          <UpcomingOpenings status={status} />
          {status.venue.feedbackEnabled && <PublicFeedbackForm slug={status.venue.slug} accentColor={status.venue.accentColor} />}
        </aside>
      </div>
    </main>
  );
}

export default ssr(async (c) => {
  c.header("Referrer-Policy", "no-referrer");
  const slug = c.req.param("slug");
  const status = slug ? await venueService.publicStatus(slug) : null;
  const displayHeight = parseVenuePublicDisplayHeight(c.req.query("height"));
  c.get("page").title = status?.venue.name ?? "Venue";

  if (!status || !slug) {
    return () => (
      <main class="min-h-screen bg-zinc-950 text-white">
        <div class="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-6 text-center">
          <i class="ti ti-building-store-off mb-4 text-5xl text-zinc-500" />
          <h1 class="text-2xl font-semibold">Venue not available</h1>
          <p class="mt-2 text-sm text-zinc-400">This public page is disabled or does not exist.</p>
        </div>
      </main>
    );
  }

  const requestOrigin = new URL(c.req.raw.url).origin;
  const appUrl = await coreSettings.get<string>("app.url").catch(() => "");
  const origin = resolveVenuePublicOrigin(appUrl, requestOrigin);
  const publicUrl = buildPublicVenueUrl(origin, slug);
  const feedbackUrl = buildPublicVenueFeedbackUrl(origin, slug);
  const feedbackQr = status.venue.feedbackEnabled
    ? qr.toSvg(feedbackUrl, { correctionLevel: "M", on: "#18181b", off: "transparent" })
    : null;

  return displayHeight === "full"
    ? () => <FullDisplay status={status} publicUrl={publicUrl} feedbackQr={feedbackQr} />
    : () => <ScrollablePage status={status} />;
});
