import type { CalendarItem, SpaceColumn, SpaceTag } from "@/contracts";

export type CalendarView = "day" | "week" | "month" | "year";

/** Weather data for a specific date */
export type DayWeather = {
  tempMin: number;
  tempMax: number;
  icon: string; // Tabler icon name
};

export type CalendarProps = {
  spaceId: string;
  items: CalendarItem[];
  columns: SpaceColumn[];
  tags: SpaceTag[];
  selectedTagIds: string[];
  view: CalendarView;
  date: Date;
  baseUrl: string;
  /** Weather forecasts indexed by date string (YYYY-MM-DD) */
  weather?: Record<string, DayWeather>;
};
