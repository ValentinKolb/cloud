import type { DateContext } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { LinkWidget as LinkWidgetConfig } from "../../../service";
import { openFormModal } from "../records/FormSubmitModal";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: LinkWidgetConfig;
  data: WidgetData;
  baseShortId: string;
  onSubmitted?: () => void;
  dateConfig?: DateContext;
};

export default function LinkWidget(props: Props) {
  const isLink = (d: WidgetData): d is Extract<WidgetData, { kind: "link" }> => d.kind === "link";
  const data = () => (isLink(props.data) ? props.data : null);
  const href = () => {
    const d = data();
    if (!d) return null;
    const target = d.target;
    if (target.kind === "url") return target.url;
    if (target.kind === "dashboard") return `/app/grids/${props.baseShortId}/dashboard/${target.dashboardShortId}`;
    if (target.kind === "table") return `/app/grids/${props.baseShortId}/table/${target.tableShortId}`;
    if (target.kind === "view") return `/app/grids/${props.baseShortId}/table/${target.tableShortId}/view/${target.viewShortId}`;
    return null;
  };
  const external = () => data()?.target.kind === "url";

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <Show
        when={data()}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed px-3 py-2 text-center">
            <Show when={props.data.kind === "error"} fallback="Loading...">
              <span class="text-red-600 dark:text-red-400">{(props.data as { kind: "error"; reason: string }).reason}</span>
            </Show>
          </div>
        }
      >
        {(d) => (
          <div class="flex flex-1 min-h-0 flex-col gap-3 p-4">
            <div class="flex min-w-0 items-start gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-dimmed">
                <i class={`${d().icon} text-lg`} />
              </span>
              <div class="min-w-0 flex-1">
                <h3 class="truncate text-sm font-semibold text-primary">{d().title}</h3>
                <Show when={d().description}>
                  <p class="mt-1 line-clamp-3 text-xs leading-snug text-dimmed">{d().description}</p>
                </Show>
              </div>
            </div>

            <div class="mt-auto flex flex-wrap items-center gap-2">
              <Show
                when={d().target.kind === "form"}
                fallback={
                  <Show
                    when={d().target.kind !== "blocked"}
                    fallback={
                      <button type="button" class="btn-input btn-sm" disabled>
                        <i class="ti ti-lock" />
                        {(d().target as { kind: "blocked"; reason: string }).reason}
                      </button>
                    }
                  >
                    <>
                      <a
                        href={href() ?? "#"}
                        target={external() ? "_blank" : undefined}
                        rel={external() ? "noreferrer" : undefined}
                        class="btn-primary btn-sm"
                      >
                        <i class={external() ? "ti ti-external-link" : "ti ti-arrow-right"} />
                        Open
                      </a>
                      <Show when={!external()}>
                        <a href={href() ?? "#"} target="_blank" rel="noreferrer" class="btn-input btn-sm">
                          <i class="ti ti-window-maximize" />
                          New window
                        </a>
                      </Show>
                    </>
                  </Show>
                }
              >
                {(() => {
                  const target = d().target;
                  if (target.kind !== "form") return null;
                  return (
                    <button
                      type="button"
                      class="btn-primary btn-sm"
                      disabled={!target.canSubmit}
                      onClick={() => {
                        if (target.canSubmit)
                          openFormModal(target.form, target.fields, { onSubmitted: props.onSubmitted, dateConfig: props.dateConfig });
                      }}
                    >
                      <i class={target.canSubmit ? "ti ti-forms" : "ti ti-lock"} />
                      {target.canSubmit ? "Open form" : "No submit access"}
                    </button>
                  );
                })()}
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
