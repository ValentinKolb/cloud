import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For } from "solid-js";
import { apiClient } from "../../api/client";

const readError = async (res: Response, fallback: string): Promise<string> => {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

export default function PublicFeedbackForm(props: { slug: string; accentColor: string }) {
  const [rating, setRating] = createSignal(4);
  const [comment, setComment] = createSignal("");

  const submit = mutation.create<void, void>({
    mutation: async () => {
      const res = await apiClient.public[":slug"].feedback.$post({
        param: { slug: props.slug },
        json: { rating: rating(), comment: comment().trim() || null },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to submit feedback."));
    },
    onSuccess: () => {
      setRating(4);
      setComment("");
      toast.success("Thank you for your feedback");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <section class="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 class="text-base font-semibold text-zinc-950">Feedback</h2>
      <div class="mt-4 grid grid-cols-5 gap-2">
        <For each={[1, 2, 3, 4, 5]}>
          {(value) => (
            <button
              type="button"
              class="flex h-12 items-center justify-center rounded-xl text-4xl transition-colors hover:bg-zinc-50"
              style={{ color: value <= rating() ? "#d97706" : "#d4d4d8" }}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              onClick={() => setRating(value)}
            >
              <i class="ti ti-star" />
            </button>
          )}
        </For>
      </div>
      <textarea
        class="mt-3 min-h-24 w-full rounded-xl border border-zinc-200 p-3 text-sm outline-none focus:border-blue-400"
        placeholder="Optional comment"
        value={comment()}
        onInput={(event) => setComment(event.currentTarget.value)}
      />
      <button
        type="button"
        class="mt-3 w-full rounded-xl px-4 py-2 text-sm font-semibold text-white"
        style={{ "background-color": props.accentColor }}
        disabled={submit.loading()}
        onClick={() => submit.mutate()}
      >
        {submit.loading() ? "Submitting..." : "Submit feedback"}
      </button>
    </section>
  );
}
