import { createSignal, For, onCleanup, onMount } from "solid-js";
import { LAYOUT_UPDATE_EVENT, type LayoutBreadcrumb, type LayoutUpdate } from "../ui/layout";

type Props = {
  breadcrumbs: LayoutBreadcrumb[];
  mobile?: boolean;
};

export default function LayoutBreadcrumbs(props: Props) {
  const [breadcrumbs, setBreadcrumbs] = createSignal(props.breadcrumbs);
  const visibleBreadcrumbs = () => (props.mobile ? breadcrumbs().slice(-1) : breadcrumbs());

  onMount(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<LayoutUpdate>).detail;
      if (detail.breadcrumbs) setBreadcrumbs(detail.breadcrumbs);
    };

    window.addEventListener(LAYOUT_UPDATE_EVENT, onUpdate);
    onCleanup(() => window.removeEventListener(LAYOUT_UPDATE_EVENT, onUpdate));
  });

  return (
    <nav class="flex items-center gap-1 sm:gap-2 min-w-0 text-sm md:text-xs">
      <For each={visibleBreadcrumbs()}>
        {(crumb, i) => {
          const isLast = () => i() === visibleBreadcrumbs().length - 1;
          return (
            <>
              {i() > 0 && <span class="text-zinc-400 dark:text-zinc-600 text-xs">/</span>}
              {crumb.href && !isLast() ? (
                <a href={crumb.href} class="text-dimmed hover:text-primary truncate">
                  {crumb.title}
                </a>
              ) : (
                <span class="font-semibold text-primary truncate">{crumb.title}</span>
              )}
            </>
          );
        }}
      </For>
    </nav>
  );
}
