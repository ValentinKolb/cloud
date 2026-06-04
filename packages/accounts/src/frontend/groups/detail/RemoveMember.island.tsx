import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { RemoveBtn } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";

type RemoveMemberProps = {
  /** Group ID */
  groupId: string;
  /** "members" or "managers" */
  membershipRole: "members" | "managers";
  /** Type of entity to remove */
  type: "user" | "group";
  /** UID or CN of the entity */
  id: string;
  /** Display label for the confirmation */
  label: string;
};

export default function RemoveMember(props: RemoveMemberProps) {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      const endpoint =
        props.membershipRole === "members" ? apiClient.groups[":id"].members.$delete : apiClient.groups[":id"].managers.$delete;
      const res = await endpoint({
        param: { id: props.groupId },
        json: { type: props.type, id: props.id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to remove.");
      }
    },
    onSuccess: () => {
      refreshCurrentPath();
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const handleClick = async () => {
    const roleLabel = props.membershipRole === "members" ? "member" : "manager";
    const confirmed = await prompts.confirm(`Remove "${props.label}" as ${roleLabel} of this group?`, {
      title: `Remove ${roleLabel}`,
      icon: "ti ti-user-minus",
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "danger",
    });

    if (confirmed) {
      await mutation.mutate();
    }
  };

  return <RemoveBtn ariaLabel={`Remove ${props.label}`} onClick={handleClick} loading={mutation.loading()} />;
}
