import { createSignal } from "solid-js";
import { cookies } from "@valentinkolb/cloud-lib/browser";

type FooterProps = {
  isLoggedIn: boolean;
  appName?: string;
};

export default function Footer(props: FooterProps) {
  const [theme, setTheme] = createSignal(
    typeof document !== "undefined" ? (document.documentElement.classList.contains("dark") ? "dark" : "light") : "dark",
  );

  const toggleTheme = () => {
    const newTheme = theme() === "dark" ? "light" : "dark";
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(newTheme);
    cookies.writeCookie("theme", newTheme);
    setTheme(newTheme);
  };

  return (
    <footer class="shrink-0 flex items-center justify-center gap-4 py-2 px-3 text-xs text-dimmed ">
      <a href="/impressum" class="hover:text-primary transition-colors flex items-center gap-1">
        <i class="ti ti-file-text text-xs" />
        Impressum
      </a>
      <a href="/faq" class="hover:text-primary transition-colors flex items-center gap-1">
        <i class="ti ti-help-circle text-xs" />
        FAQ
      </a>
      <a href="/legal/agb" class="hover:text-primary transition-colors flex items-center gap-1">
        <i class="ti ti-file-text text-xs" />
        AGB
      </a>
      <button type="button" onClick={toggleTheme} class="hidden md:flex hover:text-primary transition-colors items-center gap-1">
        <i class={`ti ${theme() === "dark" ? "ti-sunset-2" : "ti-moon-stars"} text-xs`} />
        {theme() === "dark" ? "Light" : "Dark"}
      </button>
      {props.isLoggedIn ? (
        <a href="/me" class="hover:text-primary transition-colors flex items-center gap-1">
          <i class="ti ti-user text-xs" />
          Account
        </a>
      ) : (
        <a href="/auth/login" class="hover:text-primary transition-colors flex items-center gap-1">
          <i class="ti ti-login text-xs" />
          Login
        </a>
      )}
      {props.appName && (
        <span class="hidden md:inline text-zinc-400 dark:text-zinc-600">
          Copyright &copy; {new Date().getFullYear()} {props.appName}
        </span>
      )}
    </footer>
  );
}
