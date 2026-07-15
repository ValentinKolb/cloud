import type { DateContext } from "@valentinkolb/stdlib";
import { createSignal } from "solid-js";
import type { SpaceColumn, SpaceTag, SpaceWormhole } from "@/contracts";
import KanbanBoard from "../kanban/KanbanBoard";
import type { KanbanBucketInitial } from "../kanban/types";
import { useSpacesViewRefresh } from "./view-refresh";

type Props = {
  spaceId: string;
  baseUrl: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  wormholes: SpaceWormhole[];
  initialBuckets: KanbanBucketInitial[];
  selectedItemId: string;
  dateConfig?: DateContext;
  canWrite: boolean;
};

export default function SpacesKanbanRoute(props: Props) {
  const [state, setState] = createSignal({ buckets: props.initialBuckets, wormholes: props.wormholes });
  useSpacesViewRefresh((snapshot) => {
    if (snapshot.kind === "kanban") setState({ buckets: snapshot.buckets, wormholes: snapshot.wormholes });
    else window.location.reload();
  });

  return (
    <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve={`spaces-main-${props.spaceId}`}>
      <KanbanBoard
        spaceId={props.spaceId}
        baseUrl={props.baseUrl}
        columns={props.columns}
        tags={props.tags}
        selectedItemId={props.selectedItemId}
        initialBuckets={state().buckets}
        pageSize={30}
        dateConfig={props.dateConfig}
        canWrite={props.canWrite}
        wormholes={state().wormholes}
      />
    </div>
  );
}
