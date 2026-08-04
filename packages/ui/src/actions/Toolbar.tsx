import { createContext, type JSX, useContext } from "solid-js";

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

type ToolbarOrientation = NonNullable<ToolbarProps["orientation"]>;

const defaultToolbarOrientation: () => ToolbarOrientation = () => "horizontal";
const ToolbarOrientationContext = createContext(defaultToolbarOrientation);

const ToolbarGroup = (props: ToolbarGroupProps): JSX.Element => (
  <div class={`k2b-toolbar__group ${props.class ?? ""}`} role="group" aria-label={props.label}>
    {props.children}
  </div>
);

const ToolbarSeparator = (props: ToolbarSeparatorProps): JSX.Element => {
  const toolbarOrientation = useContext(ToolbarOrientationContext);
  const separatorOrientation = () => (toolbarOrientation() === "horizontal" ? "vertical" : "horizontal");

  return (
    <span
      class={`k2b-toolbar__separator ${props.class ?? ""}`}
      role="separator"
      aria-orientation={separatorOrientation()}
      data-orientation={separatorOrientation()}
    />
  );
};

const ToolbarSpacer = (): JSX.Element => <span class="k2b-toolbar__spacer" aria-hidden="true" />;

export const Toolbar = Object.assign(
  (props: ToolbarProps): JSX.Element => {
    const orientation = () => props.orientation ?? "horizontal";

    return (
      <ToolbarOrientationContext.Provider value={orientation}>
        <div
          class={`k2b-toolbar ${props.class ?? ""}`}
          role="toolbar"
          aria-label={props.label}
          aria-orientation={orientation()}
          data-orientation={orientation()}
          data-wrap={props.wrap ? "true" : undefined}
        >
          {props.children}
        </div>
      </ToolbarOrientationContext.Provider>
    );
  },
  { Group: ToolbarGroup, Separator: ToolbarSeparator, Spacer: ToolbarSpacer },
) as ToolbarComponent;

export default Toolbar;
