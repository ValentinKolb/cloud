import { Button, ButtonLink } from "@k2b/ui";
import { createSignal, For, Show } from "solid-js";

export type CustomAppRenderedAction =
  | {
      id: string;
      kind: "navigate";
      label: string;
      icon?: string;
      href: string;
      history: "push" | "replace";
    }
  | {
      id: string;
      kind: "workflow";
      label: string;
      icon?: string;
      endpoint: string;
      confirm?: string;
    };

const responseError = async (response: Response): Promise<string> => {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
    ? payload.message
    : "The workflow could not be started.";
};

export default function Actions(props: { actions: CustomAppRenderedAction[] }) {
  const [pendingId, setPendingId] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{ kind: "success" | "error"; message: string } | null>(null);

  const invoke = async (action: Extract<CustomAppRenderedAction, { kind: "workflow" }>) => {
    if (pendingId() || (action.confirm && !window.confirm(action.confirm))) return;
    setPendingId(action.id);
    setStatus(null);
    try {
      const response = await fetch(action.endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setStatus({ kind: "success", message: "Workflow started." });
    } catch (cause) {
      setStatus({ kind: "error", message: cause instanceof Error ? cause.message : "The workflow could not be started." });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <For each={props.actions}>
          {(action) => (
            <Show
              when={action.kind === "workflow"}
              fallback={
                <ButtonLink
                  href={(action as Extract<CustomAppRenderedAction, { kind: "navigate" }>).href}
                  onClick={(event) => {
                    const navigateAction = action as Extract<CustomAppRenderedAction, { kind: "navigate" }>;
                    if (
                      navigateAction.history !== "replace" ||
                      event.defaultPrevented ||
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      (event.currentTarget.target && event.currentTarget.target !== "_self") ||
                      event.currentTarget.hasAttribute("download")
                    ) {
                      return;
                    }
                    event.preventDefault();
                    window.location.replace(navigateAction.href);
                  }}
                  variant="secondary"
                  size="sm"
                >
                  <Show when={action.icon}>
                    <i class={`ti ti-${action.icon}`} aria-hidden="true" />
                  </Show>
                  {action.label}
                </ButtonLink>
              }
            >
              <Button
                variant="primary"
                size="sm"
                loading={pendingId() === action.id}
                loadingLabel="Starting…"
                disabled={Boolean(pendingId())}
                onClick={() => void invoke(action as Extract<CustomAppRenderedAction, { kind: "workflow" }>)}
              >
                <Show when={action.icon}>
                  <i class={`ti ti-${action.icon}`} aria-hidden="true" />
                </Show>
                {action.label}
              </Button>
            </Show>
          )}
        </For>
      </div>
      <Show when={status()}>
        {(current) => (
          <p
            role={current().kind === "error" ? "alert" : "status"}
            class={`text-sm ${current().kind === "error" ? "text-danger" : "text-success"}`}
          >
            {current().message}
          </p>
        )}
      </Show>
    </div>
  );
}
