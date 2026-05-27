import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { spacesService } from "@/service";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppOverview } from "@valentinkolb/cloud/ui";
import { parseLastSpaceId } from "./[id]/_components/settings/SpaceSettingsStore";
import CreateSpaceButton from "./_components/CreateSpaceButton.island";

/**
 * Spaces list page - shows all spaces the user has access to
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);

  const spacesPage = await spacesService.space.list({
    userId: user.id,
    groups: user.memberofGroupIds,
  });
  const userSpaces = spacesPage.items;

  // Redirect to last opened space if ?recent=true
  if (url.searchParams.get("recent") === "true" && userSpaces.length > 0) {
    const cookieHeader = c.req.raw.headers.get("Cookie") ?? undefined;
    const lastId = parseLastSpaceId(cookieHeader);
    if (lastId && userSpaces.some((s) => s.id === lastId)) {
      return c.redirect(`/app/spaces/${lastId}`);
    }
  }

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Spaces" }]}>
      <AppOverview title="Spaces" subtitle="Organize your tasks, events, and tickets." icon="ti ti-layout-kanban">
        <AppOverview.Main title="Your spaces" description={`${userSpaces.length} space${userSpaces.length !== 1 ? "s" : ""} available`}>
          {userSpaces.length === 0 ? (
            <AppOverview.EmptyState title="No spaces yet" description="Create one to get started." icon="ti ti-layout-kanban" />
          ) : (
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {userSpaces.map((space) => (
                <a
                  href={`/app/spaces/${space.id}`}
                  class="paper flex items-center gap-4 p-4 no-underline transition-all hover:paper-highlighted"
                  style={`view-transition-name: space-card-${space.id}`}
                >
                  <div
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                    style={`background-color: ${space.color}; view-transition-name: space-color-${space.id}`}
                  >
                    <i class="ti ti-layout-kanban text-lg" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold text-primary" style={`view-transition-name: space-name-${space.id}`}>
                      {space.name}
                    </span>
                    <p class="truncate text-xs text-dimmed">{space.description || "No description"}</p>
                  </div>
                  <i class="ti ti-chevron-right text-dimmed" />
                </a>
              ))}
            </div>
          )}
        </AppOverview.Main>

        <AppOverview.Aside title="Create" description="Start a new space for tasks, events, or tickets.">
          <div class="paper flex flex-col gap-3 p-4">
            <p class="text-xs text-dimmed">You become the admin of spaces you create and can adjust access later in settings.</p>
            <CreateSpaceButton />
          </div>
        </AppOverview.Aside>
      </AppOverview>
    </Layout>
  );
});
