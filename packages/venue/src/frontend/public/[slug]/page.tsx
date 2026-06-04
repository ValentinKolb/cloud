import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { ssr } from "../../../config";
import type { PublicSection } from "../../../contracts";
import { venueService } from "../../../service";
import PublicFeedbackForm from "../../_components/PublicFeedbackForm.island";

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
        <MarkdownView html={markdown.renderSync(sectionText(section, "markdown"))} />
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

export default ssr(async (c) => {
  const slug = c.req.param("slug");
  const status = slug ? await venueService.publicStatus(slug) : null;
  c.get("page").title = status?.venue.name ?? "Venue";

  if (!status) {
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

  return () => (
    <main class="min-h-screen bg-zinc-100 text-zinc-950">
      <div class="relative min-h-[42vh] overflow-hidden bg-zinc-950 text-white" style={{ "--venue-accent": status.venue.accentColor }}>
        {status.venue.bannerBase64 && (
          <img src={status.venue.bannerBase64} alt="" class="absolute inset-0 h-full w-full object-cover opacity-45" />
        )}
        <div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/35 to-black/75" />
        <div class="relative mx-auto flex min-h-[42vh] max-w-6xl flex-col justify-end gap-6 p-6 sm:p-10">
          <div class="flex items-center gap-4">
            {status.venue.logoBase64 ? (
              <img src={status.venue.logoBase64} alt="" class="h-16 w-16 rounded-2xl bg-white object-contain p-2 shadow-lg" />
            ) : (
              <div
                class="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-3xl ring-1 ring-white/20"
                style={{ color: status.venue.accentColor }}
              >
                <i class={status.venue.icon || "ti ti-building-carousel"} />
              </div>
            )}
            <div class="min-w-0">
              <h1 class="text-3xl font-semibold tracking-tight sm:text-5xl">{status.venue.name}</h1>
              {status.venue.description && <p class="mt-2 max-w-2xl text-sm text-white/75 sm:text-base">{status.venue.description}</p>}
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
            <div
              class={`rounded-3xl p-6 shadow-xl ${status.open ? "text-white" : "bg-zinc-900/90 text-white ring-1 ring-white/10"}`}
              style={status.open ? { "background-color": status.venue.accentColor } : undefined}
            >
              <p class="text-sm font-medium uppercase tracking-wide opacity-75">Current status</p>
              <p class="mt-2 text-4xl font-semibold">{status.open ? "Open" : "Closed"}</p>
              <p class="mt-3 text-sm opacity-85">{status.activeWindowLabel ? `Open ${status.activeWindowLabel}` : status.todayLabel}</p>
              {status.spontaneousOpen && (
                <p class="mt-2 rounded-2xl bg-white/15 px-3 py-2 text-sm text-white/90">
                  Someone is signed up outside regular hours, so this venue is spontaneously open right now.
                </p>
              )}
            </div>
            <div class="rounded-3xl bg-white/95 p-6 text-zinc-950 shadow-xl">
              <p class="text-sm font-medium uppercase tracking-wide text-zinc-500">Today</p>
              <p class="mt-2 text-2xl font-semibold">{status.todayLabel}</p>
              {status.nextOpeningLabel && <p class="mt-3 text-sm text-zinc-600">Next opening: {status.nextOpeningLabel}</p>}
            </div>
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
          <section class="rounded-2xl bg-white/90 p-5 shadow-sm ring-1 ring-black/5">
            <h2 class="mb-3 text-base font-semibold text-zinc-950">Opening hours</h2>
            <div class="flex flex-col gap-2">
              {groupedOpeningHours(status.openingRules).length > 0 ? (
                groupedOpeningHours(status.openingRules).map((entry) => (
                  <div class="flex items-start justify-between gap-3 text-sm">
                    <span class="font-medium text-zinc-800">{weekdays[entry.weekday]}</span>
                    <span class="text-right text-zinc-600">{entry.windows}</span>
                  </div>
                ))
              ) : (
                <p class="text-sm text-zinc-600">No regular opening hours configured.</p>
              )}
            </div>
          </section>
          {status.venue.feedbackEnabled && <PublicFeedbackForm slug={status.venue.slug} accentColor={status.venue.accentColor} />}
        </aside>
      </div>
    </main>
  );
});
