import ThemeToggle from "./ThemeToggle.client";

type SiteHeaderProps = {
  active: "home" | "docs" | "ui";
};

export default function SiteHeader(props: SiteHeaderProps) {
  return (
    <header class="fibel-topbar sticky top-0 z-40 border-b border-zinc-200 bg-white/92 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/90">
      <div class="relative mx-auto flex h-16 max-w-[120rem] items-center gap-5 px-4 md:px-5 lg:px-8">
        <a
          class="flex min-w-0 items-center text-2xl font-medium leading-[1.3] tracking-tight md:text-[2rem]"
          href="/en"
          aria-label="Cloud home"
        >
          <span class="truncate lowercase">Cloud</span>
          <span class="ml-0.5 opacity-80">|</span>
        </a>
        <nav class="hidden items-center gap-7 text-[15px] text-zinc-700 dark:text-zinc-300 md:flex" aria-label="Main navigation">
          <a class="fibel-header-link" classList={{ "is-active": props.active === "home" }} href="/en">
            Home
          </a>
          <a class="fibel-header-link" classList={{ "is-active": props.active === "docs" }} href="/docs/en">
            Docs
          </a>
          <a class="fibel-header-link" classList={{ "is-active": props.active === "ui" }} href="/ui">
            UI
          </a>
          <a class="fibel-header-link" href="https://github.com/ValentinKolb/cloud">
            GitHub
          </a>
        </nav>
        <div class="ml-auto flex items-center gap-3">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
