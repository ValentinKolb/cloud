import type { JSX } from "solid-js";
import {
  captureScroll,
  documentNavigate,
  type EnhancedNavigateOptions,
  type NavigationScrollMode,
  navigate,
  restoreScroll,
  type ScrollSnapshot,
  startViewTransition,
} from "./navigation";

type AnchorProps = JSX.AnchorHTMLAttributes<HTMLAnchorElement>;

export type LinkNavigateEvent = {
  event: MouseEvent;
  href: string;
  url: URL;
  replace: boolean;
  scroll: NavigationScrollMode;
  push: (href?: string, options?: EnhancedNavigateOptions) => void;
  replaceWith: (href?: string, options?: Omit<EnhancedNavigateOptions, "replace">) => void;
  fallback: (href?: string) => void;
  scrollSnapshot: ScrollSnapshot;
  captureScroll: (selector?: string) => ScrollSnapshot;
  restoreScroll: typeof restoreScroll;
};

export type LinkProps = Omit<AnchorProps, "href" | "onClick"> & {
  href: string;
  replace?: boolean;
  scroll?: NavigationScrollMode;
  onClick?: JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent>;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
};

const shouldEnhanceClick = (event: MouseEvent, anchor: HTMLAnchorElement): boolean => {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  const url = new URL(anchor.href, window.location.href);
  return url.origin === window.location.origin;
};

const callUserClick = (handler: LinkProps["onClick"], event: MouseEvent, anchor: HTMLAnchorElement): void => {
  if (!handler) return;
  if (typeof handler === "function") {
    handler(event as MouseEvent & { currentTarget: HTMLAnchorElement; target: Element });
    return;
  }
  (handler as unknown as EventListenerObject).handleEvent(event);
};

/**
 * SSR-safe anchor with opt-in progressive navigation.
 *
 * Without `onNavigate`, it performs a client-side history navigation via
 * `navigate()`. With `onNavigate`, the app owns loading/state updates and can
 * call `push`, `replaceWith`, or `fallback`.
 */
export function Link(props: LinkProps) {
  const anchorProps = () => {
    const { href: _href, replace: _replace, scroll: _scroll, onNavigate: _onNavigate, onClick: _onClick, ...rest } = props;
    return rest;
  };

  const handleClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callUserClick(props.onClick, event, event.currentTarget);
    if (!shouldEnhanceClick(event, event.currentTarget)) return;

    const href = props.href;
    const url = new URL(href, window.location.href);
    const scroll = props.scroll ?? "top";
    const replace = Boolean(props.replace);
    const scrollSnapshot = captureScroll();

    event.preventDefault();

    if (!props.onNavigate) {
      navigate(href, { replace, scroll, scrollSnapshot });
      return;
    }

    startViewTransition(() =>
      props.onNavigate!({
        event,
        href,
        url,
        replace,
        scroll,
        push: (nextHref = href, options = {}) =>
          navigate(nextHref, { replace: false, scroll, scrollSnapshot, viewTransition: false, ...options }),
        replaceWith: (nextHref = href, options = {}) =>
          navigate(nextHref, { replace: true, scroll, scrollSnapshot, viewTransition: false, ...options }),
        fallback: (nextHref = href) => documentNavigate(nextHref, { replace }),
        scrollSnapshot,
        captureScroll,
        restoreScroll,
      }),
    );
  };

  return <a {...anchorProps()} href={props.href} onClick={handleClick} />;
}
