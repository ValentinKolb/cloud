import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { settingsService } from "@/settings/service";
import SettingsForm from "../../settings/frontend/SettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  const entries = (await settingsService.entry.list({ filter: { group: "weather" } })).items;

  return (
    <AdminLayout c={c} title="Weather" fullHeight>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-weather-title">
            <h1 class="text-base font-semibold text-primary">Weather</h1>
            <p class="mt-1 text-xs text-dimmed">Geocoding, default location, and cache behavior.</p>
          </div>

          <div class="info-block-info p-4 text-xs flex items-start gap-2" style="view-transition-name: admin-weather-info">
            <i class="ti ti-info-circle shrink-0 mt-0.5" />
            <div class="flex flex-col gap-2">
              <p>
                The weather app uses <strong>Bright Sky</strong> for forecast data. Set the default coordinates shown to users and tune the
                Redis cache TTL for refresh frequency.
              </p>
              <p>
                Location search depends on your geocoding service at{" "}
                <a href="https://github.com/ValentinKolb/geo" target="_blank" class="underline">
                  github.com/ValentinKolb/geo
                </a>
                .
              </p>
            </div>
          </div>

          <div class="paper overflow-hidden" style="view-transition-name: admin-weather-settings">
            <SettingsForm entries={entries} />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
});
