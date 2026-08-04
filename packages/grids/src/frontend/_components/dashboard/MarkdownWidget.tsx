import { MarkdownView } from "@k2b/ui";
import { Match, Show, Switch } from "solid-js";
import type { Widget } from "../../../service";
import DashboardWidgetState from "./DashboardWidgetState";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "markdown" }>;
  data: WidgetData;
};

export default function MarkdownWidget(props: Props) {
  const isMarkdown = (d: WidgetData): d is Extract<WidgetData, { kind: "markdown" }> => d.kind === "markdown";
  const source = () => props.widget.markdown ?? "";
  const fallbackHtml = () => (!source() && isMarkdown(props.data) ? props.data.html : "");

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <Show when={props.widget.title}>
        <header class="px-3 py-2">
          <span class="text-xs font-semibold text-primary truncate">{props.widget.title}</span>
        </header>
      </Show>
      <Show
        when={source() || fallbackHtml()}
        fallback={
          <DashboardWidgetState
            kind={props.data.kind === "error" ? "error" : "empty"}
            title={props.data.kind === "error" ? undefined : "No content"}
            detail={props.data.kind === "error" ? props.data.reason : null}
          />
        }
      >
        <div class="flex-1 min-h-0 overflow-auto px-3 pb-3 pt-2">
          <Switch>
            <Match when={source()}>{(markdown) => <MarkdownView markdown={markdown()} smallHeadings />}</Match>
            <Match when={fallbackHtml()}>{(html) => <MarkdownView trustedHtml={html()} smallHeadings />}</Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
}
