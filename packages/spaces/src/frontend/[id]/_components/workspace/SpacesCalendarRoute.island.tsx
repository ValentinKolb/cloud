import type { DateContext } from "@valentinkolb/stdlib";
import { createSignal, onCleanup, onMount } from "solid-js";
import type { CalendarItem, SpaceColumn, SpaceTag } from "@/contracts";
import { subscribeToDetailSelection } from "../../../lib/detail";
import Calendar from "../calendar";
import type { CalendarFilter } from "../calendar/filter";
import type { CalendarView, DayWeather } from "../calendar/types";
import { useSpacesViewRefresh } from "./view-refresh";

type CalendarState = {
  view: CalendarView;
  date: string;
  filter: CalendarFilter;
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
  const [selectedItemId, setSelectedItemId] = createSignal(props.selectedItemId);
  useSpacesViewRefresh((snapshot) => {
    if (snapshot.kind === "calendar") setState(snapshot);
    else window.location.reload();
  });
  onMount(() => {
    const unsubscribe = subscribeToDetailSelection(({ selectionId }) => setSelectedItemId(selectionId ?? ""));
    onCleanup(unsubscribe);
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-scroll-preserve={`spaces-main-${props.spaceId}`}>
      <Calendar
        spaceId={props.spaceId}
        items={state().items}
        columns={props.columns}
        tags={props.tags}
        filter={state().filter}
        selectedItemId={selectedItemId()}
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
