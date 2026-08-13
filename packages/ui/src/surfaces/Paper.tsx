import { type JSX, splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";

export type PaperTag = "div" | "section" | "article" | "a";

type PaperOwnProps<T extends PaperTag> = {
  as?: T;
  children?: JSX.Element;
  class?: string;
  elevated?: boolean;
  interactive?: boolean;
  tabIndex?: number;
};

export type PaperProps<T extends PaperTag = "div"> = PaperOwnProps<T> & Omit<JSX.IntrinsicElements[T], keyof PaperOwnProps<T>>;

const PaperElement = Dynamic as unknown as (props: Record<string, unknown>) => JSX.Element;

export function Paper<T extends PaperTag = "div">(props: PaperProps<T>): JSX.Element {
  const [local, elementProps] = splitProps(props, ["as", "children", "class", "elevated", "interactive", "tabIndex"]);
  const className = () => local.class?.trim();

  return (
    <PaperElement
      component={local.as ?? "div"}
      {...elementProps}
      class={className() ? `k2b-paper ${className()}` : "k2b-paper"}
      data-elevated={local.elevated ? "true" : undefined}
      data-interactive={local.interactive ? "true" : undefined}
      tabindex={local.tabIndex}
    >
      {local.children}
    </PaperElement>
  );
}

export default Paper;
