import { createUniqueId, type JSX, Show, splitProps } from "solid-js";

export type DiscussionProps = Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "class"> & {
  label: JSX.Element;
  children: JSX.Element;
  icon?: string | false;
  count?: JSX.Element;
  actions?: JSX.Element;
  class?: string;
};

export type DiscussionComposerProps = Omit<JSX.FormHTMLAttributes<HTMLFormElement>, "children" | "class"> & {
  children: JSX.Element;
  actions: JSX.Element;
  class?: string;
};

export type DiscussionListProps = {
  children: JSX.Element;
  class?: string;
};

export type DiscussionItemProps = {
  author: JSX.Element;
  children: JSX.Element;
  avatar?: JSX.Element;
  timestamp?: JSX.Element;
  meta?: JSX.Element;
  replyContext?: JSX.Element;
  actions?: JSX.Element;
  actionVisibility?: "always" | "progressive";
  class?: string;
};

type DiscussionComponent = ((props: DiscussionProps) => JSX.Element) & {
  Composer: (props: DiscussionComposerProps) => JSX.Element;
  List: (props: DiscussionListProps) => JSX.Element;
  Item: (props: DiscussionItemProps) => JSX.Element;
};

const classNames = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base);

const DiscussionRoot = (props: DiscussionProps): JSX.Element => {
  const headingId = `k2b-discussion-${createUniqueId()}`;
  const [local, sectionProps] = splitProps(props, ["label", "children", "icon", "count", "actions", "class"]);

  return (
    <section {...sectionProps} class={classNames("k2b-discussion", local.class)} aria-labelledby={headingId}>
      <header class="k2b-discussion__header">
        <Show when={local.icon !== false && local.icon}>
          {(icon) => (
            <span class="k2b-discussion__icon" aria-hidden="true">
              <i class={icon()} />
            </span>
          )}
        </Show>
        <h3 id={headingId}>{local.label}</h3>
        <Show when={local.count !== undefined}>
          <span class="k2b-discussion__count">{local.count}</span>
        </Show>
        <Show when={local.actions !== undefined}>
          <div class="k2b-discussion__actions">{local.actions}</div>
        </Show>
      </header>
      <div class="k2b-discussion__body">{local.children}</div>
    </section>
  );
};

const DiscussionComposer = (props: DiscussionComposerProps): JSX.Element => {
  const [local, formProps] = splitProps(props, ["children", "actions", "class"]);
  return (
    <form {...formProps} class={classNames("k2b-discussion__composer", local.class)}>
      {local.children}
      <footer>{local.actions}</footer>
    </form>
  );
};

const DiscussionList = (props: DiscussionListProps): JSX.Element => (
  <ol class={classNames("k2b-discussion__list", props.class)}>{props.children}</ol>
);

const DiscussionItem = (props: DiscussionItemProps): JSX.Element => (
  <li class={classNames("k2b-discussion__item", props.class)} data-has-avatar={props.avatar !== undefined ? "true" : undefined}>
    <Show when={props.avatar !== undefined}>
      <div class="k2b-discussion__avatar">{props.avatar}</div>
    </Show>
    <div class="k2b-discussion__entry">
      <header>
        <strong>{props.author}</strong>
        <Show when={props.timestamp !== undefined}>
          <span class="k2b-discussion__timestamp">{props.timestamp}</span>
        </Show>
        <Show when={props.meta !== undefined}>
          <span class="k2b-discussion__meta">{props.meta}</span>
        </Show>
        <Show when={props.actions !== undefined}>
          <div class="k2b-discussion__item-actions" data-visibility={props.actionVisibility ?? "progressive"}>
            {props.actions}
          </div>
        </Show>
      </header>
      <Show when={props.replyContext !== undefined}>
        <div class="k2b-discussion__reply-context">{props.replyContext}</div>
      </Show>
      <div class="k2b-discussion__content">{props.children}</div>
    </div>
  </li>
);

const Discussion = DiscussionRoot as DiscussionComponent;
Discussion.Composer = DiscussionComposer;
Discussion.List = DiscussionList;
Discussion.Item = DiscussionItem;

export default Discussion;
