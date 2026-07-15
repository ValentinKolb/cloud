import { streaming } from "@valentinkolb/stdlib";
import { onCleanup, onMount } from "solid-js";
import { requestSpacesDataRefresh } from "./workspace-events";

type Props = {
  spaceId: string;
  initialCursor: string | null;
};

const reconnectDelay = (attempt: number) => Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4));

export default function SpaceLiveEvents(props: Props) {
  onMount(() => {
    const controller = new AbortController();
    let cursor = props.initialCursor;
    let reconcileAfterReady = cursor === null;
    let reconnectAttempt = 0;
    const wait = (delay: number) =>
      new Promise<void>((resolve) => {
        if (controller.signal.aborted) {
          resolve();
          return;
        }
        const onAbort = () => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          controller.signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const url = new URL(`/api/spaces/${props.spaceId}/events`, window.location.origin);
          if (cursor) url.searchParams.set("after", cursor);
          const response = await fetch(url, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            window.location.reload();
            return;
          }
          if (!response.ok || !response.body) throw new Error(`Spaces event stream returned ${response.status}`);
          reconnectAttempt = 0;

          for await (const event of streaming.parseSSE(response.body)) {
            if (controller.signal.aborted) return;
            if (event.id) cursor = event.id;
            if (event.event === "ready" && reconcileAfterReady) {
              reconcileAfterReady = false;
              requestSpacesDataRefresh();
            } else if (event.event === "access.revoked") {
              window.location.reload();
              return;
            } else if (event.event?.startsWith("item.")) {
              requestSpacesDataRefresh(["view", "detail"]);
            } else if (event.event?.startsWith("wormhole.")) {
              requestSpacesDataRefresh(["view"]);
            }
          }
        } catch (error) {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        }
        reconnectAttempt += 1;
        await wait(reconnectDelay(reconnectAttempt));
      }
    })();

    onCleanup(() => controller.abort());
  });

  return null;
}
