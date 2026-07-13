import { prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";

const readError = async (res: Response, fallback: string): Promise<string> => {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

function FeedbackForm(props: { slug: string; accentColor: string; onSubmitted: () => void }) {
  const [rating, setRating] = createSignal(4);
  const [hoverRating, setHoverRating] = createSignal<number | null>(null);
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
      props.onSubmitted();
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="grid gap-4">
      <p class="info-block-note">Your feedback is completely anonymous. We only store the rating, optional comment, and submission time.</p>
      <div class="grid grid-cols-5 gap-2" role="group" aria-label="Rating" onMouseLeave={() => setHoverRating(null)}>
        <For each={[1, 2, 3, 4, 5]}>
          {(value) => {
            const active = () => value <= (hoverRating() ?? rating());
            const focused = () => hoverRating() === value;
            return (
              <button
                type="button"
                class="flex h-12 items-center justify-center rounded-xl border text-3xl shadow-sm transition-colors"
                classList={{
                  "border-amber-300 bg-amber-100 text-amber-700 ring-2 ring-amber-300/50": focused(),
                  "border-amber-200 bg-amber-50 text-amber-600": active() && !focused(),
                  "border-zinc-200 bg-zinc-50 text-zinc-300 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-500": !active(),
                }}
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
                onMouseEnter={() => setHoverRating(value)}
                onFocus={() => setHoverRating(value)}
                onBlur={() => setHoverRating(null)}
                onClick={() => setRating(value)}
              >
                <i class="ti ti-star" />
              </button>
            );
          }}
        </For>
      </div>
      <TextInput
        label="Comment"
        icon="ti ti-message"
        placeholder="Optional comment"
        value={comment}
        onInput={setComment}
        multiline
        lines={4}
      />
      <button
        type="button"
        class="btn-base btn-sm w-full border-transparent text-white disabled:opacity-70"
        style={{ "background-color": props.accentColor, "border-color": props.accentColor }}
        disabled={submit.loading()}
        onClick={() => submit.mutate()}
      >
        {submit.loading() ? "Submitting..." : "Submit feedback"}
      </button>
    </div>
  );
}

export default function PublicFeedbackForm(props: { slug: string; accentColor: string; variant?: "button" | "page" }) {
  const [submitted, setSubmitted] = createSignal(false);
  const openFeedback = () => {
    void prompts.dialog<void>((close) => <FeedbackForm slug={props.slug} accentColor={props.accentColor} onSubmitted={close} />, {
      title: "Share feedback",
      icon: "ti ti-star",
      size: "small",
    });
  };

  if (props.variant === "page") {
    return (
      <Show
        when={!submitted()}
        fallback={
          <div class="flex flex-col items-center gap-4 py-10 text-center">
            <span
              class="flex size-14 items-center justify-center rounded-full text-2xl text-white"
              style={{ "background-color": props.accentColor }}
            >
              <i class="ti ti-check" />
            </span>
            <div>
              <h2 class="text-xl font-semibold text-zinc-950">Thank you</h2>
              <p class="mt-1 text-sm text-zinc-600">Your anonymous feedback was submitted.</p>
            </div>
          </div>
        }
      >
        <FeedbackForm slug={props.slug} accentColor={props.accentColor} onSubmitted={() => setSubmitted(true)} />
      </Show>
    );
  }

  return (
    <button
      type="button"
      class="flex w-full items-center justify-between gap-3 rounded-2xl bg-white/90 px-4 py-3 text-left shadow-sm ring-1 ring-black/5 transition-colors hover:bg-zinc-50"
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
  );
}
