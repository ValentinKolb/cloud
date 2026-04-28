import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { weatherService, type WeatherData } from "@valentinkolb/cloud/services";
import LocationSidebar from "./_components/LocationSidebar";
type Location = { id: string; name: string; state: string | null; lat: number; lon: number };
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const locations = (await weatherService.location.saved.list({ userId: user.id })).items;
  if (locations.length > 0) {
    return c.redirect(`/app/weather/${locations[0]!.id}`);
  }
  const weatherMap = new Map<string, WeatherData | null>();
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Weather" }]}>
      <div class="app-cols h-full">
        <LocationSidebar locations={locations} activeId={null} weatherMap={weatherMap} />
        <div class="flex-1 min-w-0 flex flex-col">
          <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
            <i class="ti ti-map-pin text-sm" /> No location selected
          </p>{" "}
        </div>
      </div>
    </Layout>
  );
});
