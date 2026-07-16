import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { onCleanup, onMount } from "solid-js";
import {
  parseSpaceLiveServerMessage,
  SPACE_LIVE_WS_TYPE,
  type SpaceLiveClientMessage,
  type SpaceLiveServerMessage,
} from "../../../../live-events";
import { requestSpacesDataRefresh } from "./workspace-events";

type Props = {
  spaceId: string;
  initialCursor: string | null;
};

export default function SpaceLiveEvents(props: Props) {
  onMount(() => {
    let reconcileAfterReady = props.initialCursor === null;
    const connection = createLiveWebSocket<SpaceLiveServerMessage>({
      url: "/api/spaces/ws",
      initialCursor: props.initialCursor,
      activity: "visible",
      subscribe: (cursor) =>
        ({
          type: SPACE_LIVE_WS_TYPE.subscribe,
          payload: { spaceId: props.spaceId, fromCursor: cursor },
        }) satisfies SpaceLiveClientMessage,
      parse: parseSpaceLiveServerMessage,
      onMessage: (message, controls) => {
        if (message.payload.spaceId && message.payload.spaceId !== props.spaceId) return;
        if (message.type === SPACE_LIVE_WS_TYPE.ready) {
          controls.markApplied(message.payload.cursor);
          if (reconcileAfterReady) {
            reconcileAfterReady = false;
            requestSpacesDataRefresh();
          }
          return;
        }
        if (message.type === SPACE_LIVE_WS_TYPE.event) {
          controls.markApplied(message.payload.cursor);
          if (message.payload.event.type.startsWith("item.")) requestSpacesDataRefresh(["view", "detail"]);
          else requestSpacesDataRefresh(["view"]);
          return;
        }
        if (message.type === SPACE_LIVE_WS_TYPE.revoked) {
          controls.terminate({ code: message.payload.code, message: message.payload.message });
        }
      },
      onFatal: () => window.location.reload(),
    });

    connection.connect();
    onCleanup(connection.dispose);
  });

  return null;
}
