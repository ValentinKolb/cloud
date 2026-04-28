import { apiClient } from "@/api/client";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";

/**
 * "+ Waypoint" button — adds a single waypoint to the current expedition.
 *
 * Uses `refreshCurrentPath()` instead of `navigateTo()` because we're
 * staying on the same route — the platform's refresh helper triggers a
 * soft reload that re-runs the SSR handler and patches the DOM, so the
 * new waypoint appears without a full reload.
 */
type Props = {
  expeditionId: string;
};

const AddWaypointButton = (props: Props) => {
  const mutation = mutations.create<void, { title: string }>({
    mutation: async (data) => {
      const res = await apiClient[":id"].waypoints.$post({
        param: { id: props.expeditionId },
        json: data,
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error("message" in body ? body.message : "Failed to add waypoint");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "Add waypoint",
      icon: "ti ti-map-pin-plus",
      fields: {
        title: {
          type: "text",
          label: "Title",
          required: true,
          placeholder: "What's the next checkpoint?",
        },
      },
    });
    if (result) mutation.mutate(result);
  };

  return (
    <button
      type="button"
      class="btn-secondary btn-sm inline-flex items-center gap-1.5"
      disabled={mutation.loading()}
      onClick={handleClick}
      aria-label="Add waypoint"
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      Waypoint
    </button>
  );
};

export default AddWaypointButton;
