import { createSignal, For, Show } from "solid-js";
import { isRecord, jsonPreview } from "./message-utils";

const toneClass = (tone: unknown) => {
  if (tone === "blue") return "border-blue-200 bg-blue-50/65 text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/25 dark:text-blue-100";
  if (tone === "green")
    return "border-emerald-200 bg-emerald-50/65 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/25 dark:text-emerald-100";
  if (tone === "amber")
    return "border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-100";
  if (tone === "red") return "border-red-200 bg-red-50/70 text-red-950 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-100";
  if (tone === "teal") return "border-cyan-200 bg-teal-50/70 text-cyan-950 dark:border-cyan-900/70 dark:bg-cyan-950/25 dark:text-cyan-100";
  return "border-zinc-200 bg-white text-primary dark:border-zinc-800 dark:bg-zinc-900";
};

export function CloudCardBlock(props: { args: unknown }) {
  const card = () => (isRecord(props.args) ? props.args : null);
  const emoji = () => (typeof card()?.emoji === "string" ? String(card()?.emoji).trim() : "");
  const title = () => String(card()?.title ?? "Card");
  const value = () => String(card()?.value ?? "");
  const caption = () => (typeof card()?.caption === "string" ? String(card()!.caption) : "");
  const legacyTrend = () => (isRecord(card()?.trend) ? (card()!.trend as Record<string, unknown>) : null);
  const trendValue = () => (typeof card()?.trendValue === "string" ? String(card()!.trendValue) : String(legacyTrend()?.value ?? ""));
  const trendLabel = () => (typeof card()?.trendLabel === "string" ? String(card()!.trendLabel) : String(legacyTrend()?.label ?? ""));
  const trendDirection = () => {
    const direction = card()?.trendDirection ?? legacyTrend()?.direction;
    return direction === "up" || direction === "down" || direction === "flat" ? direction : "flat";
  };
  const hasTrend = () => Boolean(trendValue() || trendLabel());

  return (
    <div class={`max-w-xl rounded-md border p-2.5 ${toneClass(card()?.tone)}`}>
      <Show
        when={card()}
        fallback={
          <pre class="max-h-52 overflow-auto rounded-md bg-zinc-950/5 p-2 text-xs text-primary dark:bg-white/5">
            {jsonPreview(props.args)}
          </pre>
        }
      >
        <div class="flex items-start gap-2">
          <Show when={emoji()}>
            <span class="shrink-0 text-2xl leading-7" aria-hidden="true">
              {emoji()}
            </span>
          </Show>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{title()}</p>
            <p class="mt-2 text-3xl font-semibold tracking-normal">{value()}</p>
            <Show when={hasTrend()}>
              <p class="mt-1 inline-flex items-center gap-1 rounded-md bg-white/55 px-1.5 py-0.5 text-xs dark:bg-white/10">
                <i
                  class={`ti ${
                    trendDirection() === "up" ? "ti-trending-up" : trendDirection() === "down" ? "ti-trending-down" : "ti-minus"
                  } text-sm`}
                  aria-hidden="true"
                />
                <Show when={trendValue()}>{trendValue()}</Show>
                <Show when={trendLabel()}>
                  <span class="opacity-70">{trendLabel()}</span>
                </Show>
              </p>
            </Show>
            <Show when={caption()}>
              <p class="mt-2 text-xs opacity-70">{caption()}</p>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

export function CloudSurveyBlock(props: { args: unknown; disabled?: boolean; onSubmit?: (result: unknown) => void | Promise<void> }) {
  const survey = () => (isRecord(props.args) ? props.args : null);
  const questions = () => (Array.isArray(survey()?.questions) ? (survey()!.questions as unknown[]).filter(isRecord) : []);
  const [answers, setAnswers] = createSignal<Record<string, unknown>>({});
  const [error, setError] = createSignal<string | null>(null);
  const [submitted, setSubmitted] = createSignal(false);

  const setAnswer = (id: string, value: unknown) => setAnswers((prev) => ({ ...prev, [id]: value }));
  const toggleAnswer = (id: string, value: string, checked: boolean) => {
    const current = Array.isArray(answers()[id]) ? ([...(answers()[id] as string[])] as string[]) : [];
    setAnswer(id, checked ? [...current, value] : current.filter((entry) => entry !== value));
  };
  const submit = async () => {
    const missing = questions().find((question) => {
      if (!question.required) return false;
      const value = answers()[String(question.id ?? "")];
      return Array.isArray(value) ? value.length === 0 : value === undefined || value === "";
    });
    if (missing) {
      setError("Please answer all required questions.");
      return;
    }
    setError(null);
    setSubmitted(true);
    await props.onSubmit?.({ submitted: true, answers: answers() });
  };

  return (
    <div class="max-w-xl rounded-md border border-zinc-200 bg-white/80 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div class="flex items-start gap-2">
        <i class="ti ti-forms mt-0.5 shrink-0 text-base leading-none text-dimmed" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-primary">{String(survey()?.title ?? "Survey")}</p>
          <Show when={typeof survey()?.description === "string"}>
            <p class="mt-1 text-xs text-dimmed">{String(survey()?.description)}</p>
          </Show>

          <div class="mt-3 space-y-3">
            <For each={questions()}>
              {(question) => {
                const id = () => String(question.id ?? "");
                const options = () => (Array.isArray(question.options) ? (question.options as unknown[]).filter(isRecord) : []);
                return (
                  <div>
                    <p class="text-xs font-medium text-primary">
                      {String(question.label ?? "")}
                      <Show when={question.required}>
                        <span class="text-red-500"> *</span>
                      </Show>
                    </p>
                    <Show when={question.type === "single"}>
                      <div class="mt-1 flex flex-wrap gap-1.5">
                        <For each={options()}>
                          {(option) => (
                            <button
                              type="button"
                              class={`btn-input btn-input-sm ${answers()[id()] === option.value ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200" : ""}`}
                              disabled={props.disabled || submitted()}
                              onClick={() => setAnswer(id(), option.value)}
                            >
                              {String(option.label ?? option.value ?? "")}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={question.type === "multiple"}>
                      <div class="mt-1 flex flex-wrap gap-1.5">
                        <For each={options()}>
                          {(option) => (
                            <label class="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-xs text-secondary dark:border-zinc-800">
                              <input
                                type="checkbox"
                                disabled={props.disabled || submitted()}
                                checked={Array.isArray(answers()[id()]) && (answers()[id()] as string[]).includes(String(option.value))}
                                onChange={(event) => toggleAnswer(id(), String(option.value), event.currentTarget.checked)}
                              />
                              {String(option.label ?? option.value ?? "")}
                            </label>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={question.type === "text"}>
                      <input
                        class="input mt-1 h-9 w-full text-sm"
                        disabled={props.disabled || submitted()}
                        placeholder={typeof question.placeholder === "string" ? question.placeholder : ""}
                        value={String(answers()[id()] ?? "")}
                        onInput={(event) => setAnswer(id(), event.currentTarget.value)}
                      />
                    </Show>
                    <Show when={question.type === "rating"}>
                      <input
                        class="mt-2 w-full accent-cyan-500"
                        type="range"
                        disabled={props.disabled || submitted()}
                        min={typeof question.min === "number" ? question.min : 1}
                        max={typeof question.max === "number" ? question.max : 5}
                        value={Number(answers()[id()] ?? question.min ?? 1)}
                        onInput={(event) => setAnswer(id(), Number(event.currentTarget.value))}
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>

          <Show when={error()}>
            <p class="mt-2 text-xs text-red-600 dark:text-red-300">{error()}</p>
          </Show>
          <Show
            when={!props.disabled && !submitted()}
            fallback={<p class="mt-3 text-xs text-dimmed">{submitted() ? "Submitted" : "Waiting for the assistant to continue."}</p>}
          >
            <button type="button" class="btn-ai btn-sm mt-3" onClick={() => void submit()}>
              {String(survey()?.submitLabel ?? "Submit")}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

const surveyAnswerLabel = (question: Record<string, unknown> | null, value: unknown) => {
  const options = Array.isArray(question?.options) ? (question!.options as unknown[]).filter(isRecord) : [];
  const optionLabel = (entry: unknown) => {
    const match = options.find((option) => String(option.value ?? "") === String(entry));
    return String(match?.label ?? entry ?? "");
  };
  if (Array.isArray(value)) return value.map(optionLabel).filter(Boolean).join(", ");
  if (typeof value === "object" && value !== null) return jsonPreview(value);
  if (value === undefined || value === null || value === "") return "No answer";
  return optionLabel(value);
};

export function CloudSurveyResultBlock(props: { args?: unknown; result: unknown }) {
  const survey = () => (isRecord(props.args) ? props.args : null);
  const result = () => (isRecord(props.result) ? props.result : null);
  const answers = () => (isRecord(result()?.answers) ? (result()!.answers as Record<string, unknown>) : {});
  const questions = () => (Array.isArray(survey()?.questions) ? (survey()!.questions as unknown[]).filter(isRecord) : []);
  const rows = () => {
    const knownQuestions = questions().map((question) => {
      const id = String(question.id ?? "");
      return {
        id,
        label: String(question.label ?? id),
        value: surveyAnswerLabel(question, answers()[id]),
      };
    });
    const knownIds = new Set(knownQuestions.map((question) => question.id));
    const extraAnswers = Object.entries(answers())
      .filter(([id]) => !knownIds.has(id))
      .map(([id, value]) => ({ id, label: id, value: surveyAnswerLabel(null, value) }));
    return [...knownQuestions, ...extraAnswers].filter((row) => row.id);
  };

  return (
    <details class="group min-w-0 max-w-[min(46rem,100%)] text-xs">
      <summary class="inline-flex min-h-7 max-w-full cursor-pointer list-none items-center gap-1.5 py-1 leading-none text-dimmed transition-colors hover:text-primary">
        <i class="ti ti-forms shrink-0 text-base leading-none" aria-hidden="true" />
        <span class="shrink-0 font-medium">survey</span>
        <span class="min-w-0 truncate">{String(survey()?.title ?? "Survey")} · submitted</span>
        <i class="ti ti-chevron-right shrink-0 text-base leading-none opacity-60 transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div class="mt-1 max-w-xl rounded-md bg-zinc-100/70 px-2.5 py-2 [box-shadow:var(--theme-recess)] dark:bg-zinc-950/70">
        <Show when={rows().length > 0} fallback={<p class="text-xs text-dimmed">No answers submitted.</p>}>
          <dl class="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5">
            <For each={rows()}>
              {(row) => (
                <>
                  <dt class="text-xs text-dimmed">{row.label}</dt>
                  <dd class="min-w-0 whitespace-pre-wrap text-xs text-primary">{row.value}</dd>
                </>
              )}
            </For>
          </dl>
        </Show>
      </div>
    </details>
  );
}
