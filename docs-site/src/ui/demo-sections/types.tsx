import type { DockWorkspaceState } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";

export type DemoRenderProps = {
  markdownHtml: string;
  dockWorkspaceInitialState: DockWorkspaceState | null;
};

export type DemoSection = Record<string, (props: DemoRenderProps) => JSX.Element>;

export function DemoGrid(props: { children: JSX.Element; columns?: "one" | "two" }) {
  return (
    <div class={props.columns === "one" ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 xl:grid-cols-2"}>
      {props.children}
    </div>
  );
}
