import { coreSettings } from "@valentinkolb/cloud/services";
import { ssr } from "../../../../config";
import { venueService } from "../../../../service";
import PublicFeedbackForm from "../../../_components/PublicFeedbackForm.island";
import { buildPublicVenueUrl, resolveVenuePublicOrigin } from "../../../public-runtime";

export default ssr(async (c) => {
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex");
  const slug = c.req.param("slug");
  const status = slug ? await venueService.publicStatus(slug) : null;
  const requestOrigin = new URL(c.req.raw.url).origin;
  const appUrl = await coreSettings.get<string>("app.url").catch(() => "");
  const publicUrl = slug ? buildPublicVenueUrl(resolveVenuePublicOrigin(appUrl, requestOrigin), slug) : "/app/venue";
  c.get("page").title = status ? `Feedback · ${status.venue.name}` : "Feedback unavailable";

  if (!status || !status.venue.feedbackEnabled) {
    return () => (
      <main class="flex min-h-screen items-center justify-center bg-zinc-100 p-4 text-zinc-950">
        <section class="w-full max-w-md text-center">
          <i class="ti ti-message-off mb-4 text-5xl text-zinc-400" />
          <h1 class="text-2xl font-semibold">Feedback unavailable</h1>
          <p class="mt-2 text-sm text-zinc-600">This venue is not accepting public feedback.</p>
        </section>
      </main>
    );
  }

  return () => (
    <main class="min-h-screen bg-zinc-100 text-zinc-950">
      <div class="mx-auto flex min-h-screen w-full max-w-xl flex-col bg-white px-5 py-6 shadow-sm sm:px-8 sm:py-8">
        <header class="flex items-center gap-3 border-b border-zinc-200 pb-5">
          {status.venue.logoBase64 ? (
            <img src={status.venue.logoBase64} alt="" class="size-12 rounded-xl bg-white object-contain p-1 ring-1 ring-zinc-200" />
          ) : (
            <span
              class="flex size-12 items-center justify-center rounded-xl text-xl text-white"
              style={{ "background-color": status.venue.accentColor }}
            >
              <i class={status.venue.icon || "ti ti-building-carousel"} />
            </span>
          )}
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase text-zinc-500">Anonymous feedback</p>
            <h1 class="truncate text-xl font-semibold">{status.venue.name}</h1>
          </div>
        </header>

        <section class="flex flex-1 flex-col justify-center py-8">
          <div class="mb-6">
            <h2 class="text-2xl font-semibold">How was your visit?</h2>
            <p class="mt-2 text-sm leading-relaxed text-zinc-600">Share a rating and an optional comment. No account is required.</p>
          </div>
          <PublicFeedbackForm slug={status.venue.slug} accentColor={status.venue.accentColor} variant="page" />
        </section>

        <footer class="border-t border-zinc-200 pt-4">
          <a href={publicUrl} class="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 no-underline hover:text-zinc-950">
            <i class="ti ti-arrow-left" />
            View {status.venue.name}
          </a>
        </footer>
      </div>
    </main>
  );
});
