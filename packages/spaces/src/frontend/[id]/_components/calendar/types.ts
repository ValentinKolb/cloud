import type { CalendarItem, SpaceColumn, SpaceTag } from "@/contracts";

export type CalendarView = "month" | "week";

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
  view: CalendarView;
  date: Date;
  baseUrl: string;
  /** Weather forecasts indexed by date string (YYYY-MM-DD) */
  weather?: Record<string, DayWeather>;
};

export type MonthViewProps = {
  year: number;
  month: number;
  items: CalendarItem[];
  currentDate: Date;
  currentView: CalendarView;
  baseUrl: string;
  weather?: Record<string, DayWeather>;
};

export type WeekViewProps = {
  weekStart: Date;
  items: CalendarItem[];
  currentView: CalendarView;
  currentDate: Date;
  baseUrl: string;
  weather?: Record<string, DayWeather>;
};

export type CalendarHeaderProps = {
  view: CalendarView;
  date: Date;
  baseUrl: string;
};

export type CalendarCellProps = {
  date: Date;
  items: CalendarItem[];
  isToday: boolean;
  isCurrentMonth: boolean;
  baseUrl: string;
};

export type CalendarItemDisplayProps = {
  item: CalendarItem;
  variant: "full" | "compact" | "dot";
  baseUrl: string;
  currentView: CalendarView;
  currentDate: Date;
};
