import { weatherLocationsService } from "./locations";
import { weatherCityService } from "./geo";

/** Weather location cookie name. */
export const WEATHER_LOCATION_COOKIE = "weather_location";

/** Parse weather location from cookie value. */
export const parseLocationCookie = (cookieValue: string | undefined): { lat: string; lon: string } | undefined => {
  if (!cookieValue) return undefined;
  const [lat, lon] = cookieValue.split(",");
  if (!lat || !lon) return undefined;
  return { lat, lon };
};

export const weatherLocationService = {
  saved: weatherLocationsService,
  city: weatherCityService,
  cookie: {
    name: WEATHER_LOCATION_COOKIE,
    parse: parseLocationCookie,
  },
};

export type WeatherLocationService = typeof weatherLocationService;
