import type { DateContext } from "@valentinkolb/stdlib";
import { createSignal } from "solid-js";
import type { CalendarItem, SpaceColumn, SpaceTag } from "@/contracts";
import Calendar from "../calendar";
import type { CalendarView, DayWeather } from "../calendar/types";
import { useSpacesViewRefresh } from "./view-refresh";

type CalendarState = {
  view: CalendarView;
  date: string;
  tagIds: string[];
  items: CalendarItem[];
  weather: Record<string, DayWeather>;
};

type Props = {
  spaceId: string;
  baseUrl: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  initialState: CalendarState;
  selectedItemId: string;
  dateConfig?: DateContext;
  canWrite: boolean;
};

export default function SpacesCalendarRoute(props: Props) {
  const [state, setState] = createSignal(props.initialState);
  useSpacesViewRefresh((snapshot) => {
    if (snapshot.kind === "calendar") setState(snapshot);
    else window.location.reload();
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-scroll-preserve={`spaces-main-${props.spaceId}`}>
      <Calendar
        spaceId={props.spaceId}
        items={state().items}
        columns={props.columns}
        tags={props.tags}
        selectedTagIds={state().tagIds}
        selectedItemId={props.selectedItemId}
        view={state().view}
        date={new Date(state().date)}
        baseUrl={props.baseUrl}
        weather={state().weather}
        dateConfig={props.dateConfig}
        canWrite={props.canWrite}
      />
    </div>
  );
}
