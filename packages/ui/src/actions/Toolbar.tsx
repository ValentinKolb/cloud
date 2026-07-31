import type { JSX } from "solid-js";

export type ToolbarProps = {
  children: JSX.Element;
  label: string;
  orientation?: "horizontal" | "vertical";
  wrap?: boolean;
  class?: string;
};

export type ToolbarGroupProps = { children: JSX.Element; label?: string; class?: string };
export type ToolbarSeparatorProps = { class?: string };

type ToolbarComponent = ((props: ToolbarProps) => JSX.Element) & {
  Group: (props: ToolbarGroupProps) => JSX.Element;
  Separator: (props: ToolbarSeparatorProps) => JSX.Element;
  Spacer: () => JSX.Element;
};

const ToolbarGroup = (props: ToolbarGroupProps): JSX.Element => (
  <div class={`k2b-toolbar__group ${props.class ?? ""}`} role="group" aria-label={props.label}>{props.children}</div>
);

const ToolbarSeparator = (props: ToolbarSeparatorProps): JSX.Element => (
  <span class={`k2b-toolbar__separator ${props.class ?? ""}`} role="separator" aria-orientation="vertical" />
);

const ToolbarSpacer = (): JSX.Element => <span class="k2b-toolbar__spacer" aria-hidden="true" />;

export const Toolbar = Object.assign(
  (props: ToolbarProps): JSX.Element => (
    <div
      class={`k2b-toolbar ${props.class ?? ""}`}
      role="toolbar"
      aria-label={props.label}
      aria-orientation={props.orientation ?? "horizontal"}
      data-orientation={props.orientation ?? "horizontal"}
      data-wrap={props.wrap ? "true" : undefined}
    >
      {props.children}
    </div>
  ),
  { Group: ToolbarGroup, Separator: ToolbarSeparator, Spacer: ToolbarSpacer },
) as ToolbarComponent;

export default Toolbar;
