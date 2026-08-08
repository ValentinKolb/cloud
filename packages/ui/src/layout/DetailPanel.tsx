import { createUniqueId, type JSX, Show, splitProps } from "solid-js";
import { Button, ButtonLink, type ButtonLinkProps, type ButtonProps } from "../actions/Button";

export type DetailPanelProps = {
  children: JSX.Element;
  class?: string;
};

export type DetailPanelHeaderProps = {
  title: JSX.Element;
  subtitle?: JSX.Element;
  meta?: JSX.Element;
  actions?: JSX.Element;
  class?: string;
};

export type DetailPanelBodyProps = {
  children: JSX.Element;
  scrollPreserveKey?: string;
  class?: string;
};

type DetailPanelSectionBaseProps = {
  title: JSX.Element;
  children: JSX.Element;
  class?: string;
};

type DetailPanelActionBaseProps = {
  title: JSX.Element;
  description?: JSX.Element;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  class?: string;
};

export type DetailPanelActionLinkProps = DetailPanelActionBaseProps &
  Omit<ButtonLinkProps, "children" | "class" | "size" | "title" | "variant"> & {
    href: string;
  };

export type DetailPanelActionButtonProps = DetailPanelActionBaseProps &
  Omit<ButtonProps, "children" | "class" | "size" | "title" | "variant"> & {
    href?: never;
  };

export type DetailPanelActionProps = DetailPanelActionLinkProps | DetailPanelActionButtonProps;

export type DetailPanelSectionProps = DetailPanelSectionBaseProps &
  (
    | {
        actions?: JSX.Element;
        collapsible?: false;
        defaultOpen?: never;
      }
    | {
        actions?: never;
        collapsible: true;
        defaultOpen?: boolean;
      }
  );

type DetailPanelComponent = ((props: DetailPanelProps) => JSX.Element) & {
  Header: (props: DetailPanelHeaderProps) => JSX.Element;
  Body: (props: DetailPanelBodyProps) => JSX.Element;
  Section: (props: DetailPanelSectionProps) => JSX.Element;
  Action: (props: DetailPanelActionProps) => JSX.Element;
};

const classNames = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base);

const DetailPanelHeader = (props: DetailPanelHeaderProps): JSX.Element => (
  <header class={classNames("k2b-detail-panel__header", props.class)}>
    <div class="k2b-detail-panel__heading">
      <h2>{props.title}</h2>
      <Show when={props.subtitle || props.meta}>
        <div class="k2b-detail-panel__supporting">
          <Show when={props.subtitle}>
            <p>{props.subtitle}</p>
          </Show>
          <Show when={props.meta}>
            <div class="k2b-detail-panel__meta">{props.meta}</div>
          </Show>
        </div>
      </Show>
    </div>
    <Show when={props.actions}>
      <div class="k2b-detail-panel__actions">{props.actions}</div>
    </Show>
  </header>
);

const DetailPanelBody = (props: DetailPanelBodyProps): JSX.Element => (
  <div class={classNames("k2b-detail-panel__body", props.class)} data-scroll-preserve={props.scrollPreserveKey}>
    {props.children}
  </div>
);

const DetailPanelActionContent = (props: DetailPanelActionBaseProps): JSX.Element => (
  <>
    <Show when={props.leading}>
      <span class="k2b-detail-panel__action-leading">{props.leading}</span>
    </Show>
    <span class="k2b-detail-panel__action-copy">
      <span class="k2b-detail-panel__action-title">{props.title}</span>
      <Show when={props.description}>
        <span class="k2b-detail-panel__action-description">{props.description}</span>
      </Show>
    </span>
    <Show when={props.trailing}>
      <span class="k2b-detail-panel__action-trailing">{props.trailing}</span>
    </Show>
  </>
);

const DetailPanelAction = (props: DetailPanelActionProps): JSX.Element => {
  const [local, rest] = splitProps(props, ["class", "description", "href", "leading", "title", "trailing"]);
  const className = classNames("k2b-detail-panel__action", local.class);
  const content = () => (
    <DetailPanelActionContent title={local.title} description={local.description} leading={local.leading} trailing={local.trailing} />
  );

  return (
    <Show
      when={local.href !== undefined}
      fallback={
        <Button
          {...(rest as Omit<DetailPanelActionButtonProps, keyof DetailPanelActionBaseProps>)}
          class={className}
          variant="ghost"
          size="sm"
        >
          {content()}
        </Button>
      }
    >
      <ButtonLink
        {...(rest as Omit<DetailPanelActionLinkProps, keyof DetailPanelActionBaseProps | "href">)}
        href={local.href as string}
        class={className}
        variant="ghost"
        size="sm"
      >
        {content()}
      </ButtonLink>
    </Show>
  );
};

const DetailPanelSection = (props: DetailPanelSectionProps): JSX.Element => {
  const headingId = `k2b-detail-panel-section-${createUniqueId()}`;
  const className = () => classNames("k2b-detail-panel__section", props.class);

  return (
    <Show
      when={props.collapsible}
      fallback={
        <section class={className()} aria-labelledby={headingId}>
          <header class="k2b-detail-panel__section-header">
            <h3 id={headingId}>{props.title}</h3>
            <Show when={props.actions}>
              <div class="k2b-detail-panel__section-actions">{props.actions}</div>
            </Show>
          </header>
          <div class="k2b-detail-panel__section-body">{props.children}</div>
        </section>
      }
    >
      <details class={className()} open={props.defaultOpen}>
        <summary class="k2b-detail-panel__section-summary">
          <span id={headingId}>{props.title}</span>
          <i class="ti ti-chevron-down" aria-hidden="true" />
        </summary>
        <div class="k2b-detail-panel__section-body">{props.children}</div>
      </details>
    </Show>
  );
};

const DetailPanel = ((props: DetailPanelProps): JSX.Element => (
  <div class={classNames("k2b-detail-panel", props.class)}>{props.children}</div>
)) as DetailPanelComponent;

DetailPanel.Header = DetailPanelHeader;
DetailPanel.Body = DetailPanelBody;
DetailPanel.Section = DetailPanelSection;
DetailPanel.Action = DetailPanelAction;

export default DetailPanel;
