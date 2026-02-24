import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import SettingsForm from "../../settings/frontend/SettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  return (
    <AdminLayout c={c} title="Weather">
      <div class="max-w-6xl mx-auto flex flex-col gap-6">
        <h1 class="text-xl font-bold text-primary">Weather Settings</h1>

        <div class="info-block-info p-4 text-xs flex items-start gap-2">
          <i class="ti ti-info-circle shrink-0 mt-0.5" />
          <div class="flex flex-col gap-2">
            <p>
              The weather app uses the <strong>Bright Sky API</strong> (brightsky.dev) to display weather data. Set default coordinates for
              the initial location shown to users. Weather data is cached in Redis — the cache TTL controls how often fresh data is fetched.
            </p>
            <p>
              The location search uses a self-hosted geocoding service (
              <a href="https://github.com/ValentinKolb/geo" target="_blank" class="underline">
                github.com/ValentinKolb/geo
              </a>
              ) — make sure it is running and the geocoding URL points to it.
            </p>
          </div>
        </div>

        <SettingsForm groups={["weather"]} />
      </div>
    </AdminLayout>
  );
});
