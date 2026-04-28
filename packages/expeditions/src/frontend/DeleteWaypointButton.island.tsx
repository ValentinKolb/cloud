import { apiClient } from "@/api/client";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";

/**
 * Trash-can button next to each waypoint. Confirms first, then deletes.
 *
 * No `mutation.create` wrapper here because the action is one-shot and the
 * confirmation already provides a "are you sure" gate — the extra reactive
 * `loading()` state isn't worth the noise. Plain async function it is.
 */
type Props = {
  expeditionId: string;
  waypointId: string;
  waypointTitle: string;
};

const DeleteWaypointButton = (props: Props) => {
  const handleClick = async () => {
    const ok = await prompts.confirm(`Delete waypoint "${props.waypointTitle}"?`, {
      title: "Delete waypoint",
      icon: "ti ti-trash",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!ok) return;

    const res = await apiClient[":id"].waypoints[":waypointId"].$delete({
      param: { id: props.expeditionId, waypointId: props.waypointId },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      prompts.error("message" in body ? (body as { message: string }).message : "Failed to delete waypoint");
      return;
    }
    refreshCurrentPath();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      class="text-dimmed hover:text-red-500 transition-colors p-1"
      aria-label={`Delete ${props.waypointTitle}`}
    >
      <i class="ti ti-trash text-sm" />
    </button>
  );
};

export default DeleteWaypointButton;
