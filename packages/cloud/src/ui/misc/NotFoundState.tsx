import { Show } from "solid-js";

export type NotFoundStateProps = {
  /** The big numeral. Omit it when the answer is not literally "404" — a base
   *  you may not open is found, just not yours. */
  code?: string;
  title: string;
  description?: string;
  icon?: string;
  /** Where to send someone who ended up here. */
  action?: { label: string; href: string; icon?: string };
};

/**
 * The full-page dead end: a page, a base, a record that is not there.
 *
 * `Placeholder` covers the in-page version — an empty table, a panel that
 * failed to load. This is the whole-screen one, so it is deliberately larger
 * and always offers somewhere to go next.
 */
export default function NotFoundState(props: NotFoundStateProps) {
  return (
    <div class="mx-auto flex max-w-sm flex-col items-center gap-6 py-16">
      <Show
        when={props.code}
        fallback={
          <Show when={props.icon}>{(icon) => <i class={`${icon()} text-5xl text-gray-300 dark:text-gray-600`} aria-hidden="true" />}</Show>
        }
      >
        {(code) => <div class="text-7xl font-light text-gray-300 dark:text-gray-600">{code()}</div>}
      </Show>

      <div class="text-center">
        <h1 class="text-lg font-medium text-gray-900 dark:text-gray-100">{props.title}</h1>
        <Show when={props.description}>{(description) => <p class="mt-1 text-sm text-dimmed">{description()}</p>}</Show>
      </div>

      <Show when={props.action}>
        {(action) => (
          <a href={action().href} class="btn-primary btn-sm">
            <i class={action().icon ?? "ti ti-home"} />
            <span>{action().label}</span>
          </a>
        )}
      </Show>
    </div>
  );
}
