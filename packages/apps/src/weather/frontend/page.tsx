import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { weatherService, type WeatherData } from "../service";
import LocationSidebar from "./components/LocationSidebar";
type Location = { id: string; name: string; state: string | null; lat: number; lon: number };
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const locations = (await weatherService.location.saved.list({ userId: user.id })).items;
  if (locations.length > 0) {
    return c.redirect(`/app/weather/${locations[0]!.id}`);
  }
  const weatherMap = new Map<string, WeatherData | null>();
  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Weather" }]}>
      {" "}
      <div class="app-cols h-full">
        {" "}
        {/* Sidebar (Desktop) */}{" "}
        <div class="hidden lg:flex flex-col w-48 shrink-0 overflow-y-auto">
          {" "}
          <LocationSidebar locations={locations} activeId={null} weatherMap={weatherMap} />{" "}
        </div>{" "}
        {/* Main */}{" "}
        <div class="flex-1 min-w-0 flex flex-col">
          {" "}
          {/* Mobile Sidebar */}{" "}
          <div class="lg:hidden px-3 pt-2 pb-1">
            {" "}
            <LocationSidebar locations={locations} activeId={null} weatherMap={weatherMap} />{" "}
          </div>{" "}
          <div class="divider lg:hidden" />{" "}
          <p class="flex items-center justify-center gap-1.5 py-8 text-xs text-dimmed">
            {" "}
            <i class="ti ti-map-pin text-sm" /> No location selected{" "}
          </p>{" "}
        </div>{" "}
      </div>{" "}
    </Layout>
  );
});
