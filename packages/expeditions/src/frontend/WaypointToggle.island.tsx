import { createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";

/**
 * Checkbox-style toggle for a single waypoint's done/open state.
 *
 * Optimistic-ish UI: we flip the local `done` signal immediately so the
 * checkbox feels snappy, then call the API. On error we revert the signal
 * and show a toast. On success we call `refreshCurrentPath()` so the
 * progress bar + completion banner on the parent page also re-render.
 *
 * Side-effect note: when the toggle pushes the expedition into "all done"
 * the server also fires a notification email. The user doesn't see that
 * directly — it just lands in their inbox.
 */
type Props = {
  expeditionId: string;
  waypointId: string;
  done: boolean;
};

const WaypointToggle = (props: Props) => {
  // Local mirror of `props.done` so we can flip optimistically.
  const [done, setDone] = createSignal(props.done);
  const [pending, setPending] = createSignal(false);

  const handleClick = async () => {
    if (pending()) return;
    const next = !done();
    setDone(next); // optimistic flip
    setPending(true);
    try {
      const res = await apiClient[":id"].waypoints[":waypointId"].$patch({
        param: { id: props.expeditionId, waypointId: props.waypointId },
        json: { done: next },
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error("message" in body ? body.message : "Failed to update waypoint");
      }
      // Soft refresh so progress + completion banner re-render server-side.
      refreshCurrentPath();
    } catch (e: unknown) {
      setDone(!next); // revert optimistic flip
      prompts.error(e instanceof Error ? e.message : "Failed to update waypoint");
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      class="text-lg leading-none"
      aria-label={done() ? "Mark waypoint as open" : "Mark waypoint as done"}
      aria-pressed={done()}
    >
      <i
        class={
          pending()
            ? "ti ti-loader-2 animate-spin text-dimmed"
            : done()
              ? "ti ti-circle-check text-emerald-500"
              : "ti ti-circle text-dimmed hover:text-primary"
        }
      />
    </button>
  );
};

export default WaypointToggle;
