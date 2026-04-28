import { apiClient } from "@/api/client";
import { prompts, navigateTo } from "@valentinkolb/cloud/ui";

/**
 * Header-level "delete the whole expedition" button.
 *
 * After deletion we navigate back to the list — there's nothing left to
 * show on the detail page, so a refresh would just 404.
 */
type Props = {
  expeditionId: string;
  expeditionTitle: string;
};

const DeleteExpeditionButton = (props: Props) => {
  const handleClick = async () => {
    const ok = await prompts.confirm(
      `Delete "${props.expeditionTitle}" and every waypoint inside? This cannot be undone.`,
      {
        title: "Delete expedition",
        icon: "ti ti-trash",
        confirmText: "Delete",
        variant: "danger",
      },
    );
    if (!ok) return;

    const res = await apiClient[":id"].$delete({ param: { id: props.expeditionId } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      prompts.error("message" in body ? (body as { message: string }).message : "Failed to delete expedition");
      return;
    }
    navigateTo("/app/expeditions");
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      class="text-dimmed hover:text-red-500 transition-colors p-1.5"
      aria-label="Delete expedition"
    >
      <i class="ti ti-trash text-sm" />
    </button>
  );
};

export default DeleteExpeditionButton;
