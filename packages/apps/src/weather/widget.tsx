import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { weatherService, type WeatherData } from "./service";
import type { Widget } from "@valentinkolb/cloud/contracts/app"; /** Format hour from timestamp */
const formatHour = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}; /** Format day from date string */
const formatDay = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString("de-DE", { weekday: "short", day: "numeric" });
}; /** Weather widget content */
function WeatherContent({ data }: { data: WeatherData }) {
  const { current, hourly, daily } = data;
  return (
    <div class="flex flex-col gap-2 flex-1 text-sm min-h-0">
      {" "}
      {/* Current temperature */}{" "}
      <div class="flex items-center gap-2">
        {" "}
        <i
          class={`ti ti-${weatherService.ui.getTablerIcon(current.icon)} text-2xl ${weatherService.ui.getTempColorClass(current.temperature)}`}
        />{" "}
        <span class={`text-2xl ${weatherService.ui.getTempColorClass(current.temperature)}`}>
          {" "}
          {weatherService.ui.formatTemp(current.temperature)}{" "}
        </span>{" "}
        {current.windSpeed > 0 && (
          <span class="text-xs text-dimmed flex items-center gap-1">
            {" "}
            <i class="ti ti-wind text-[10px]" /> {current.windSpeed} km/h{" "}
          </span>
        )}{" "}
      </div>{" "}
      {/* Location */}{" "}
      <button
        type="button"
        id="weather-location-btn"
        class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1 w-fit"
        title="Click to use your location"
      >
        {" "}
        <i class="ti ti-map-pin" /> <span>{current.stationName}</span>{" "}
      </button>{" "}
      <script>{` document.getElementById('weather-location-btn')?.addEventListener('click', function() { const button = this; const icon = button.querySelector('i'); const label = button.querySelector('span'); const initialIconClass = icon ? icon.className : 'ti ti-map-pin'; const initialLabel = label ? label.textContent : 'Use my location'; const setLoading = function() { button.setAttribute('disabled', 'true'); button.classList.add('opacity-70'); if (icon) icon.className = 'ti ti-loader-2 animate-spin'; if (label) label.textContent = 'Getting location...'; }; const resetButton = function() { button.removeAttribute('disabled'); button.classList.remove('opacity-70'); if (icon) icon.className = initialIconClass; if (label) label.textContent = initialLabel; }; const showError = function(message) { button.removeAttribute('disabled'); button.classList.remove('opacity-70'); if (icon) icon.className = 'ti ti-alert-circle'; if (label) label.textContent = message; setTimeout(function() { resetButton(); }, 2500); }; if (!navigator.geolocation) { showError('Location unavailable'); return; } setLoading(); navigator.geolocation.getCurrentPosition( function(position) { const { latitude, longitude } = position.coords; document.cookie = '${weatherService.location.cookie.name}=' + latitude + ',' + longitude + ';path=/;max-age=31536000'; window.location.href = window.location.pathname + window.location.search; }, function(error) { const denied = error && typeof error.code === 'number' && error.code === 1; showError(denied ? 'Location denied' : 'Location unavailable'); }, { timeout: 10000 } ); }); `}</script>{" "}
      {/* Hourly - next 8 hours */}{" "}
      {hourly.length > 0 && (
        <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {" "}
          {hourly.slice(0, 8).map((h) => (
            <div class="flex flex-col items-center gap-0.5 min-w-12">
              {" "}
              <span class="text-[10px] text-dimmed">{formatHour(h.timestamp)}</span>{" "}
              <i class={`ti ti-${weatherService.ui.getTablerIcon(h.icon)} text-sm ${weatherService.ui.getTempColorClass(h.temperature)}`} />{" "}
              <span class={`text-xs ${weatherService.ui.getTempColorClass(h.temperature)}`}>
                {" "}
                {weatherService.ui.formatTemp(h.temperature)}{" "}
              </span>{" "}
            </div>
          ))}{" "}
        </div>
      )}{" "}
      {/* Daily - next 5 days */}{" "}
      {daily.length > 0 && (
        <div class="flex flex-col gap-1 border-t border-zinc-200 dark:border-zinc-700 pt-2 flex-1 overflow-y-auto">
          {" "}
          {daily.map((d) => (
            <div class="flex items-center justify-between text-xs">
              {" "}
              <span class="text-dimmed w-16">{formatDay(d.date)}</span>{" "}
              <i
                class={`ti ti-${weatherService.ui.getTablerIcon(d.icon)} ${weatherService.ui.getAvgTempColorClass(d.tempMin, d.tempMax)}`}
              />{" "}
              <div class="flex gap-2 w-14 justify-end">
                {" "}
                <span class={weatherService.ui.getTempColorClass(d.tempMax)}>{weatherService.ui.formatTemp(d.tempMax)}</span>{" "}
                <span class="text-dimmed">{weatherService.ui.formatTemp(d.tempMin)}</span>{" "}
              </div>{" "}
            </div>
          ))}{" "}
        </div>
      )}{" "}
      {/* Link to full weather page */}{" "}
      <a href="/app/weather" class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1 mt-1">
        {" "}
        <i class="ti ti-arrow-right text-[10px]" /> Weather forecast{" "}
      </a>{" "}
    </div>
  );
} /** * Create weather widget. * Always shown (weather is for everyone). */
export async function createWeatherWidget(c: Context): Promise<Widget> {
  const locationCookie = getCookie(c, weatherService.location.cookie.name);
  const location = weatherService.location.cookie.parse(locationCookie);
  const data = await weatherService.forecast.get(location);
  if (!data) return null;
  return {
    id: "weather",
    title: "Weather",
    icon: weatherService.ui.getTablerIcon(data.current.icon),
    content: <WeatherContent data={data} />,
  };
}
