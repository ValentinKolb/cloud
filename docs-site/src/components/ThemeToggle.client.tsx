import { createSignal, onMount } from "solid-js";

const COOKIE = "cloud_docs_theme";

export default function ThemeToggle() {
  const [dark, setDark] = createSignal(false);

  onMount(() => setDark(document.documentElement.classList.contains("dark")));

  const toggle = () => {
    const next = !dark();
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.classList.toggle("light", !next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    document.cookie = `${COOKIE}=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
    setDark(next);
  };

  return (
    <button class="site-theme-toggle" type="button" aria-label="Toggle theme" onClick={toggle}>
      {dark() ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 13.2A7.5 7.5 0 0 1 10.8 3 8.5 8.5 0 1 0 21 13.2Z" />
        </svg>
      )}
    </button>
  );
}
