import { AppOverview } from "@k2b/ui";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@valentinkolb/cloud/server";
import { weatherService } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import AddLocationButton from "./AddLocation.island";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const locations = (await weatherService.location.saved.list({ userId: user.id })).items;
  if (locations.length > 0) {
    return c.redirect(`/app/weather/${locations[0]!.id}`);
  }

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Weather" }]}>
      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <AppOverview title="Weather" subtitle="Track forecasts for your saved locations." icon="ti ti-temperature-celsius">
          <AppOverview.Main title="Locations" description="No saved locations yet.">
            <AppOverview.EmptyState
              title="No locations yet"
              description="Add a city to see current conditions and forecasts."
              icon="ti ti-map-pin"
            />
          </AppOverview.Main>

          <AppOverview.Aside title="Create" description="Add your first saved forecast.">
            <div class="grid grid-cols-1 gap-2">
              <AddLocationButton variant="overview" />
            </div>
          </AppOverview.Aside>
        </AppOverview>
      </div>
    </Layout>
  );
});
