import { createSignal } from "solid-js";
import { theme, type ThemeMode } from "@valentinkolb/cloud-lib/browser";

/** Theme toggle button for the desktop rail navigation. */
export default function ThemeToggleRail() {
  const [mode, setMode] = createSignal<ThemeMode>(typeof document !== "undefined" ? theme.getCurrent() : "light");

  const toggleTheme = () => {
    setMode(theme.toggle());
  };

  return (
    <button
      type="button"
      class={`rail-item ${
        mode() === "light"
          ? "text-violet-500 hover:text-violet-600 dark:text-violet-400 dark:hover:text-violet-300 hover:bg-violet-500/10 dark:hover:bg-violet-500/15"
          : "text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300 hover:bg-amber-500/10 dark:hover:bg-amber-500/15"
      }`}
      onClick={toggleTheme}
      aria-label={mode() === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={mode() === "light" ? "Dark mode" : "Light mode"}
    >
      <i class={`ti ${mode() === "light" ? "ti-moon" : "ti-sun-high"} text-base`} />
    </button>
  );
}
