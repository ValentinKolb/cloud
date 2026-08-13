import { createUniqueId, type JSX, Show, splitProps } from "solid-js";

export type DiscussionProps = Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "class"> & {
  label: JSX.Element;
  children: JSX.Element;
  icon?: string | false;
  count?: JSX.Element;
  actions?: JSX.Element;
  as?: "h2" | "h3";
  surface?: "default" | "bare";
  class?: string;
};

export type DiscussionComposerProps = Omit<JSX.FormHTMLAttributes<HTMLFormElement>, "children" | "class"> & {
  children: JSX.Element;
  actions?: JSX.Element;
  insetAction?: JSX.Element;
  class?: string;
};

export type DiscussionListProps = {
  children: JSX.Element;
  class?: string;
};

export type DiscussionItemProps = Omit<JSX.LiHTMLAttributes<HTMLLIElement>, "children" | "class"> & {
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
  const [local, sectionProps] = splitProps(props, ["label", "children", "icon", "count", "actions", "as", "surface", "class"]);

  return (
    <section
      {...sectionProps}
      class={classNames("k2b-discussion", local.class)}
      data-surface={local.surface ?? "default"}
      aria-labelledby={headingId}
    >
      <header class="k2b-discussion__header">
        <Show when={local.icon !== false && local.icon}>
          {(icon) => (
            <span class="k2b-discussion__icon" aria-hidden="true">
              <i class={icon()} />
            </span>
          )}
        </Show>
        <Show when={local.as === "h2"} fallback={<h3 id={headingId}>{local.label}</h3>}>
          <h2 id={headingId}>{local.label}</h2>
        </Show>
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
  const [local, formProps] = splitProps(props, ["children", "actions", "insetAction", "class"]);
  return (
    <form {...formProps} class={classNames("k2b-discussion__composer", local.class)}>
      <div class="k2b-discussion__composer-field" data-has-inset-action={local.insetAction !== undefined ? "true" : undefined}>
        {local.children}
        <Show when={local.insetAction !== undefined}>
          <div class="k2b-discussion__composer-inset-action">{local.insetAction}</div>
        </Show>
      </div>
      <Show when={local.actions !== undefined}>
        <footer>{local.actions}</footer>
      </Show>
    </form>
  );
};

const DiscussionList = (props: DiscussionListProps): JSX.Element => (
  <ol class={classNames("k2b-discussion__list", props.class)}>{props.children}</ol>
);

const DiscussionItem = (props: DiscussionItemProps): JSX.Element => {
  const [local, itemProps] = splitProps(props, [
    "author",
    "children",
    "avatar",
    "timestamp",
    "meta",
    "replyContext",
    "actions",
    "actionVisibility",
    "class",
  ]);
  return (
    <li
      {...itemProps}
      class={classNames("k2b-discussion__item", local.class)}
      data-has-avatar={local.avatar !== undefined ? "true" : undefined}
    >
      <Show when={local.avatar !== undefined}>
        <div class="k2b-discussion__avatar">{local.avatar}</div>
      </Show>
      <div class="k2b-discussion__entry">
        <header>
          <strong>{local.author}</strong>
          <Show when={local.timestamp !== undefined}>
            <span class="k2b-discussion__timestamp">{local.timestamp}</span>
          </Show>
          <Show when={local.meta !== undefined}>
            <span class="k2b-discussion__meta">{local.meta}</span>
          </Show>
          <Show when={local.actions !== undefined}>
            <div class="k2b-discussion__item-actions" data-visibility={local.actionVisibility ?? "progressive"}>
              {local.actions}
            </div>
          </Show>
        </header>
        <Show when={local.replyContext !== undefined}>
          <div class="k2b-discussion__reply-context">{local.replyContext}</div>
        </Show>
        <div class="k2b-discussion__content">{local.children}</div>
      </div>
    </li>
  );
};

const Discussion = DiscussionRoot as DiscussionComponent;
Discussion.Composer = DiscussionComposer;
Discussion.List = DiscussionList;
Discussion.Item = DiscussionItem;

export default Discussion;
