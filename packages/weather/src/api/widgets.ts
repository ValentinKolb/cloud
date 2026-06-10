import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import type {
  WidgetResponse,
  WidgetBlock,
  WidgetListItem,
} from "@valentinkolb/cloud/contracts";
import { weatherService } from "@valentinkolb/cloud/services";

/**
 * Weather widget — every saved location of the current user, fresh forecast
 * each. Capped at 7 to keep the widget body within fixed height.
 *
 * Composition:
 *   - 0 locations → hero with "Add a location" hint
 *   - 1 location  → hero (big icon + temp + city) + pills (wind/humid/hPa)
 *   - 2-7         → list (one row per location with weather icon, temp, condition)
 *
 * Status: 200 always (with appropriate empty-state body), 403 when not signed in.
 */
const LOCATION_LIMIT = 7;

const ICON_MAP: Record<string, { ti: string; verbal: string }> = {
  "clear-day": { ti: "ti ti-sun", verbal: "clear" },
  "clear-night": { ti: "ti ti-moon", verbal: "clear" },
  "partly-cloudy-day": { ti: "ti ti-cloud-filled", verbal: "partly cloudy" },
  "partly-cloudy-night": { ti: "ti ti-cloud-filled", verbal: "partly cloudy" },
  cloudy: { ti: "ti ti-cloud", verbal: "cloudy" },
  fog: { ti: "ti ti-mist", verbal: "fog" },
  rain: { ti: "ti ti-cloud-rain", verbal: "rain" },
  sleet: { ti: "ti ti-cloud-rain", verbal: "sleet" },
  snow: { ti: "ti ti-snowflake", verbal: "snow" },
  wind: { ti: "ti ti-wind", verbal: "windy" },
  thunderstorm: { ti: "ti ti-bolt", verbal: "thunderstorm" },
  hail: { ti: "ti ti-cloud-rain", verbal: "hail" },
};

const iconFor = (icon: string) => ICON_MAP[icon] ?? { ti: "ti ti-cloud", verbal: icon };

const app = new Hono<AuthContext>()
  .use(auth.requireRole("*"))
  .get("/current", async (c) => {
    const actor = c.get("actor");
    const user = actor.kind === "user" ? actor.user : actor.delegatedUser;
    if (!user) return c.body(null, 403);

    const { items: locations } = await weatherService.locations.list({ userId: user.id });

    if (locations.length === 0) {
      const body: WidgetResponse = {
        title: "Weather",
        icon: "ti ti-cloud",
        href: "/app/weather",
        blocks: [
          {
            kind: "hero",
            icon: "ti ti-map-pin-plus",
            tone: "blue",
            title: "No saved locations yet",
            subtitle: "Add one in Weather to see forecasts here",
          },
        ],
      };
      return c.json(body);
    }

    const capped = locations.slice(0, LOCATION_LIMIT);
    const forecasts = await Promise.all(
      capped.map(async (loc) => ({
        loc,
        data: await weatherService.forecast.current.get({
          lat: String(loc.lat),
          lon: String(loc.lon),
        }),
      })),
    );

    // Single-location → hero + pills (rich single-cell view).
    if (forecasts.length === 1) {
      const entry = forecasts[0]!;
      if (!entry.data) {
        const body: WidgetResponse = {
          title: "Weather",
          icon: "ti ti-cloud",
          href: "/app/weather",
          blocks: [
            {
              kind: "hero",
              icon: "ti ti-cloud-off",
              title: "Forecast unavailable",
              subtitle: `Couldn't reach the provider for ${entry.loc.name}`,
            },
          ],
        };
        return c.json(body);
      }
      const ic = iconFor(entry.data.icon);
      const blocks: WidgetBlock[] = [
        {
          kind: "hero",
          icon: ic.ti,
          tone: "blue",
          title: `${Math.round(entry.data.temperature)}°C · ${ic.verbal}`,
          subtitle: entry.loc.name,
        },
        {
          kind: "pills",
          pills: [
            { label: "wind", value: `${Math.round(entry.data.windSpeed)} km/h` },
            ...(entry.data.humidity !== null
              ? [{ label: "humid", value: `${Math.round(entry.data.humidity)}%` } as const]
              : []),
            ...(entry.data.pressure !== null
              ? [{ label: "hPa", value: Math.round(entry.data.pressure) } as const]
              : []),
          ],
        },
      ];
      const body: WidgetResponse = {
        title: "Weather",
        icon: ic.ti,
        href: "/app/weather",
        blocks,
      };
      return c.json(body);
    }

    // Multi-location → one row per saved place, list grows to fill the body.
    const items: WidgetListItem[] = forecasts.map(({ loc, data }) => {
      if (!data) {
        return {
          icon: "ti ti-cloud-off",
          iconTone: "zinc",
          label: loc.name,
          sub: "no data",
        };
      }
      const ic = iconFor(data.icon);
      return {
        icon: ic.ti,
        iconTone: "blue",
        label: loc.name,
        sub: ic.verbal,
        meta: `${Math.round(data.temperature)}°C`,
      };
    });

    const body: WidgetResponse = {
      title: "Weather",
      icon: "ti ti-cloud",
      href: "/app/weather",
      meta:
        locations.length > LOCATION_LIMIT
          ? `${LOCATION_LIMIT} of ${locations.length}`
          : undefined,
      blocks: [{ kind: "list", items, grow: true }],
    };
    return c.json(body);
  });

export default app;
