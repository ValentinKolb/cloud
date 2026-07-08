import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function WeatherLayoutHelp() {
  return (
    <Layout.Help
      id="weather-start"
      title="Start"
      icon="ti ti-temperature-celsius"
      description="Saved locations, forecasts, radar, fullscreen display, and weather settings."
      order={100}
    >
      <DocPage>
        <DocLead>
          Weather tracks saved locations and shows current conditions, hourly forecast, daily forecast, and rain radar.
        </DocLead>

        <DocSection title="Overview" eyebrow="Start here">
          <DocConceptGrid
            items={[
              {
                title: "Saved location",
                icon: "ti-map-pin",
                text: "A city saved to your account with name, state, latitude, and longitude.",
              },
              {
                title: "Forecast",
                icon: "ti-cloud-sun",
                text: "The location page shows current weather, hourly values, daily forecast, and rain radar.",
              },
              {
                title: "Display link",
                icon: "ti-device-tv",
                text: "Fullscreen opens a public display URL for monitor-style weather views.",
              },
              {
                title: "Admin settings",
                icon: "ti-settings",
                text: "Admins control default widget coordinates, cache duration, and the geocoding endpoint.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Use Weather">
          <DocRows
            items={[
              {
                title: "Add a location",
                icon: "ti-plus",
                text: "Search for a German city, select a result, and Weather saves its coordinates to your account.",
              },
              {
                title: "Read a forecast",
                icon: "ti-cloud",
                text: "Open a saved location for current conditions, hourly forecast, daily forecast, details, and rain radar.",
              },
              {
                title: "Open a display",
                icon: "ti-device-tv",
                text: "Use Fullscreen to choose zoom, light or dark theme, and simple or detailed display.",
              },
              {
                title: "Remove a location",
                icon: "ti-trash",
                text: "Remove deletes the saved location from your account and returns to the Weather overview.",
              },
            ]}
          />
        </DocSection>

        <DocNote title="Data scope" variant="info">
          Location search is limited to German cities in the current UI. Forecast data can be unavailable when the configured provider has no
          data for the selected coordinates.
        </DocNote>
      </DocPage>
    </Layout.Help>
  );
}
