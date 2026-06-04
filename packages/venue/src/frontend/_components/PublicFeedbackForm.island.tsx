import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For } from "solid-js";
import { apiClient } from "../../api/client";

const readError = async (res: Response, fallback: string): Promise<string> => {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

function FeedbackDialog(props: { slug: string; accentColor: string; close: () => void }) {
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
      props.close();
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="grid gap-4">
      <p class="text-sm text-zinc-600">
        Your feedback is completely anonymous. We only store the rating, optional comment, and submission time.
      </p>
      <div class="grid grid-cols-5 gap-2">
        <For each={[1, 2, 3, 4, 5]}>
          {(value) => (
            <button
              type="button"
              class="flex h-12 items-center justify-center rounded-xl border text-3xl shadow-sm transition-all hover:-translate-y-0.5 hover:shadow"
              classList={{
                "border-amber-200 bg-amber-50 text-amber-600": value <= rating(),
                "border-zinc-200 bg-zinc-50 text-zinc-300 hover:border-zinc-300 hover:text-zinc-400": value > rating(),
              }}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              onClick={() => setRating(value)}
            >
              <i class="ti ti-star" />
            </button>
          )}
        </For>
      </div>
      <textarea
        class="min-h-24 w-full rounded-xl border border-zinc-200 p-3 text-sm outline-none focus:border-blue-400"
        placeholder="Optional comment"
        value={comment()}
        onInput={(event) => setComment(event.currentTarget.value)}
      />
      <button
        type="button"
        class="w-full rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
        style={{ "background-color": props.accentColor }}
        disabled={submit.loading()}
        onClick={() => submit.mutate()}
      >
        {submit.loading() ? "Submitting..." : "Submit feedback"}
      </button>
    </div>
  );
}

export default function PublicFeedbackForm(props: { slug: string; accentColor: string }) {
  const openFeedback = () => {
    void prompts.dialog<void>((close) => <FeedbackDialog slug={props.slug} accentColor={props.accentColor} close={close} />, {
      title: "Share feedback",
      icon: "ti ti-star",
      size: "small",
    });
  };

  return (
    <section class="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-zinc-50"
        onClick={openFeedback}
      >
        <span class="flex items-center gap-3">
          <span
            class="flex size-9 items-center justify-center rounded-xl text-lg text-white"
            style={{ "background-color": props.accentColor }}
            aria-hidden="true"
          >
            <i class="ti ti-star" />
          </span>
          <span>
            <span class="block text-base font-semibold text-zinc-950">Feedback</span>
            <span class="block text-xs text-zinc-500">Anonymous rating</span>
          </span>
        </span>
        <i class="ti ti-message-star text-xl text-zinc-500" aria-hidden="true" />
      </button>
    </section>
  );
}
