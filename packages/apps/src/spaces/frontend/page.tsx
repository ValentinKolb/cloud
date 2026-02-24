import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { spacesService } from "@/spaces/service";
import { Layout } from "@valentinkolb/cloud/core/ssr";
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
    groups: user.memberofGroup,
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

  return (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Spaces" }]}>
      <div class="max-w-4xl mx-auto">
        {/* Hero */}
        <div class="p-6 mb-4 text-center">
          <div class="flex items-center justify-center gap-3 mb-2">
            <div class="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <i class="ti ti-layout-kanban text-2xl text-zinc-600 dark:text-zinc-400" />
            </div>
          </div>
          <h1 class="text-xl font-semibold mb-1">Spaces</h1>
          <p class="text-sm text-dimmed">Organize your tasks, events, and tickets</p>
        </div>

        {/* Info block */}
        <div class="info-block-info mb-6 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <i class="ti ti-layout-kanban shrink-0" />
            <span>
              {userSpaces.length === 0
                ? "No spaces yet. Create one to get started!"
                : `${userSpaces.length} space${userSpaces.length !== 1 ? "s" : ""} available`}
            </span>
          </div>
          <CreateSpaceButton />
        </div>

        {/* Spaces grid */}
        {userSpaces.length > 0 && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {userSpaces.map((space) => (
              <a
                href={`/app/spaces/${space.id}`}
                class="paper p-4 flex items-center gap-4 hover:paper-highlighted transition-all no-underline"
                style={`view-transition-name: space-card-${space.id}`}
              >
                <div
                  class="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={`background-color: ${space.color}; view-transition-name: space-color-${space.id}`}
                >
                  <i class="ti ti-layout-kanban text-lg" />
                </div>
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-semibold text-primary block truncate" style={`view-transition-name: space-name-${space.id}`}>
                    {space.name}
                  </span>
                  <p class="text-xs text-dimmed truncate">{space.description || "No description"}</p>
                </div>
                <i class="ti ti-chevron-right text-dimmed" />
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
});
