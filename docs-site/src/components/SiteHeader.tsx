import ThemeToggle from "./ThemeToggle.client";

type SiteHeaderProps = {
  active: "home" | "docs" | "ui";
};

export default function SiteHeader(props: SiteHeaderProps) {
  return (
    <header class="site-header">
      <div class="site-header-inner">
        <a class="site-brand" href="/en" aria-label="Cloud home">
          <img src="/assets/logo.svg" alt="" width="26" height="26" />
          <span>Cloud</span>
        </a>
        <nav class="site-nav" aria-label="Main navigation">
          <a classList={{ active: props.active === "home" }} href="/en">
            Home
          </a>
          <a classList={{ active: props.active === "docs" }} href="/docs/en">
            Docs
          </a>
          <a classList={{ active: props.active === "ui" }} href="/ui">
            UI
          </a>
          <a href="https://github.com/ValentinKolb/cloud">GitHub</a>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
