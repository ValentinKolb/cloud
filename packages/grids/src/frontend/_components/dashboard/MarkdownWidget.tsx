import { Show } from "solid-js";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";
import type { Widget } from "../../../service";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "markdown" }>;
  data: WidgetData;
};

export default function MarkdownWidget(props: Props) {
  const isMarkdown = (d: WidgetData): d is Extract<WidgetData, { kind: "markdown" }> => d.kind === "markdown";
  const html = () => {
    const live = markdown.render(props.widget.markdown ?? "");
    if (live || !isMarkdown(props.data)) return live;
    return props.data.html;
  };

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <Show when={props.widget.title}>
        <header class="px-3 py-2">
          <span class="text-xs font-semibold text-primary truncate">{props.widget.title}</span>
        </header>
      </Show>
      <Show
        when={html()}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed px-3 py-2 text-center">
            <Show when={props.data.kind === "error"} fallback="No content">
              <span class="text-red-600 dark:text-red-400">{(props.data as { kind: "error"; reason: string }).reason}</span>
            </Show>
          </div>
        }
      >
        {(() => {
          return (
            <div class="flex-1 min-h-0 overflow-auto px-3 pb-3 pt-2">
              <MarkdownView html={html()} smallHeadings />
            </div>
          );
        })()}
      </Show>
    </div>
  );
}
