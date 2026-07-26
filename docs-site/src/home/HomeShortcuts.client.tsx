import { onCleanup, onMount } from "solid-js";

export default function HomeShortcuts() {
  let toast: HTMLDivElement | undefined;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = (message: string) => {
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.visible = "true";
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (toast) toast.dataset.visible = "false";
    }, 1600);
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "g") {
        pending = "g";
        show("g then d → docs · g then u → UI");
        return;
      }
      if (pending !== "g") return;
      pending = "";
      if (event.key === "d") window.location.assign("/docs/en");
      if (event.key === "u") window.location.assign("/ui");
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return <div ref={toast} class="cloud-shortcut-toast" role="status" aria-live="polite" />;
}
