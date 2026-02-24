import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/faq/client";
import { refreshCurrentPath } from "../lib/navigation";

type Props = {
  /** All FAQ IDs in current order */
  allIds: string[];
  /** Index of this item */
  index: number;
};

const getErrorMessage = async (response: Response, fallback: string) => {
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? fallback;
};

const FaqReorder = (props: Props) => {
  const mutation = mutations.create<void, string[]>({
    mutation: async (ids) => {
      const res = await apiClient.reorder.$put({ json: { ids } });
      if (!res.ok) throw new Error(await getErrorMessage(res, "Failed to reorder FAQs"));
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (error) => prompts.error(error.message),
  });

  const swap = (direction: "up" | "down") => {
    const ids = [...props.allIds];
    const i = props.index;
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    mutation.mutate(ids);
  };

  return (
    <div class="flex flex-col gap-0.5">
      <button
        type="button"
        class="btn-simple p-0.5 text-xs"
        onClick={() => swap("up")}
        disabled={props.index === 0 || mutation.loading()}
        title="Move up"
      >
        <i class="ti ti-chevron-up" />
      </button>
      <button
        type="button"
        class="btn-simple p-0.5 text-xs"
        onClick={() => swap("down")}
        disabled={props.index === props.allIds.length - 1 || mutation.loading()}
        title="Move down"
      >
        <i class="ti ti-chevron-down" />
      </button>
    </div>
  );
};

export default FaqReorder;
