import { createMemo, createSignal } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import {
  TextInput,
  NumberInput,
  prompts,
  SettingsField,
  SettingsSaveBar,
  sameSettingValue,
  readSettingsError,
  toast,
} from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";

type Initial = {
  "weather.default_lat": string;
  "weather.default_lon": string;
  "weather.cache_minutes": number;
  "weather.geo_url": string;
};

export default function WeatherSettingsForm(props: { initial: Initial }) {
  const [draft, setDraft] = createSignal<Initial>({ ...props.initial });
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});

  const update = <K extends keyof Initial>(key: K, value: Initial[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  };

  const changedKeys = createMemo<Array<keyof Initial>>(() => {
    const d = draft();
    return (Object.keys(props.initial) as Array<keyof Initial>).filter((k) => !sameSettingValue(d[k], props.initial[k]));
  });
  const hasChanges = () => changedKeys().length > 0;

  if (typeof window !== "undefined") {
    window.onbeforeunload = () => (hasChanges() ? "" : null);
  }

  const save = mutations.create<void, void>({
    mutation: async () => {
      const updates: Record<string, unknown> = {};
      for (const k of changedKeys()) updates[k as string] = draft()[k];
      const response = await apiClient.admin.settings.$put({ json: updates });
      if (!response.ok) {
        const { message, fields } = await readSettingsError(response, `Save failed (HTTP ${response.status})`);
        setFieldErrors(fields);
        throw new Error(message);
      }
    },
    onSuccess: () => {
      window.onbeforeunload = null;
      toast.success("Weather settings saved");
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const discardAll = () => {
    setDraft({ ...props.initial });
    setFieldErrors({});
  };

  const isChanged = (key: keyof Initial) => !sameSettingValue(draft()[key], props.initial[key]);

  return (
    <div>
      <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
        <SettingsField
          label="Default Latitude"
          description="Default latitude shown in weather widgets"
          error={() => fieldErrors()["weather.default_lat"]}
          changed={() => isChanged("weather.default_lat")}
        >
          <TextInput
            value={() => draft()["weather.default_lat"]}
            onChange={(v) => update("weather.default_lat", v)}
            placeholder="e.g. 48.401082"
          />
        </SettingsField>
        <SettingsField
          label="Default Longitude"
          description="Default longitude shown in weather widgets"
          error={() => fieldErrors()["weather.default_lon"]}
          changed={() => isChanged("weather.default_lon")}
        >
          <TextInput
            value={() => draft()["weather.default_lon"]}
            onChange={(v) => update("weather.default_lon", v)}
            placeholder="e.g. 9.987608"
          />
        </SettingsField>
        <SettingsField
          label="Cache TTL (minutes)"
          description="How long weather data is cached before fetching fresh data"
          error={() => fieldErrors()["weather.cache_minutes"]}
          changed={() => isChanged("weather.cache_minutes")}
        >
          <NumberInput
            value={() => draft()["weather.cache_minutes"]}
            onChange={(v) => {
              if (v !== null) update("weather.cache_minutes", v);
            }}
            min={1}
            max={1440}
          />
        </SettingsField>
        <SettingsField
          label="Geo API URL"
          description="Geocoding API URL for location search"
          error={() => fieldErrors()["weather.geo_url"]}
          changed={() => isChanged("weather.geo_url")}
        >
          <TextInput
            value={() => draft()["weather.geo_url"]}
            onChange={(v) => update("weather.geo_url", v)}
            type="url"
            placeholder="e.g. https://geocoding.example.com/search"
          />
        </SettingsField>
      </div>

      <SettingsSaveBar
        changeCount={() => changedKeys().length}
        loading={() => save.loading()}
        onDiscard={discardAll}
        onSave={() => save.mutate()}
      />
    </div>
  );
}
