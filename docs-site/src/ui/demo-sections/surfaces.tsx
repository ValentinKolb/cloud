import {
  CalendarAllDayStressDemo,
  CalendarDayDemo,
  CalendarMobileDemo,
  CalendarMonthDemo,
  CalendarOverlapDemo,
  CalendarScheduleDemo,
  CalendarYearDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/calendar";
import {
  DataPanelDemo,
  NoticeCardDemo,
  ObservabilityStatsDemo,
  PanelHeaderDemo,
  RangePickerDemo,
  StatusBadgeDemo,
} from "../../../../packages/ui-lab/src/frontend/lab/observability";
import {
  AvatarDemo,
  CoreUtilityPatternsDemo,
  LinkCardDemo,
  NotFoundStateDemo,
  PaperUtility,
  PlaceholderDemo,
  ProgressBarDemo,
  StatCellDemo,
  StatGridDemo,
  StatHeroGridDemo,
  ThumbnailUtility,
} from "../../../../packages/ui-lab/src/frontend/lab/surfaces-cards";
import { DemoGrid, type DemoSection } from "./types";

const demos: DemoSection = {
  utilities: () => (
    <DemoGrid>
      <PaperUtility />
      <ThumbnailUtility />
      <CoreUtilityPatternsDemo />
    </DemoGrid>
  ),
  "empty-states": () => (
    <DemoGrid columns="one">
      <PlaceholderDemo />
      <NotFoundStateDemo />
    </DemoGrid>
  ),
  cards: () => (
    <DemoGrid>
      <LinkCardDemo />
      <ProgressBarDemo />
      <AvatarDemo />
    </DemoGrid>
  ),
  stats: () => (
    <DemoGrid columns="one">
      <StatCellDemo />
      <StatGridDemo />
      <StatHeroGridDemo />
    </DemoGrid>
  ),
  observability: () => (
    <DemoGrid columns="one">
      <PanelHeaderDemo />
      <DataPanelDemo />
      <StatusBadgeDemo />
      <NoticeCardDemo />
      <RangePickerDemo />
      <ObservabilityStatsDemo />
    </DemoGrid>
  ),
  calendar: () => (
    <DemoGrid columns="one">
      <CalendarScheduleDemo />
      <CalendarAllDayStressDemo />
      <CalendarOverlapDemo />
      <CalendarDayDemo />
      <CalendarMonthDemo />
      <CalendarYearDemo />
      <CalendarMobileDemo />
    </DemoGrid>
  ),
};

export default demos;
