import { AppWorkspace, Chart, Placeholder, prompts } from "@k2b/ui";
import { createSignal } from "solid-js";

export default function Demo() {
  const [theme, setTheme] = createSignal<"light" | "dark">("light");
  const [confirmed, setConfirmed] = createSignal(false);

  const confirmAction = async () => {
    const result = await prompts.confirm("The dialog is rendered in the scoped @k2b/ui portal root.", {
      title: "Scoped prompt",
      confirmText: "Confirm",
    });
    setConfirmed(result);
  };

  return (
    <div
      class="k2b-ui"
      data-theme={theme()}
      style="--k2b-accent-500:#8b5cf6;--k2b-accent-600:#7c3aed;--k2b-accent-700:#6d28d9;height:calc(100dvh - 45px);padding:16px"
    >
      <AppWorkspace>
        <AppWorkspace.Sidebar>
          <AppWorkspace.SidebarHeader title="@k2b/ui" subtitle="Standalone SSR fixture" icon={false} />
          <AppWorkspace.SidebarBody>
            <AppWorkspace.SidebarSection title="Components">
              <AppWorkspace.SidebarItem active>Overview</AppWorkspace.SidebarItem>
              <AppWorkspace.SidebarItem href="/?page=content">Content</AppWorkspace.SidebarItem>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
        </AppWorkspace.Sidebar>

        <AppWorkspace.Content>
          <AppWorkspace.Main>
            <div style="display:flex;flex-direction:column;gap:16px;padding:20px">
              <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
                <div>
                  <h1 style="margin:0;font-size:20px">Independent package consumer</h1>
                  <p style="margin:4px 0 0;color:var(--k2b-text-muted);font-size:13px">
                    Solid components, scoped CSS, custom accent stack, and no Cloud import.
                  </p>
                </div>
                <div style="display:flex;gap:8px">
                  <button
                    type="button"
                    class="k2b-button k2b-button--secondary"
                    onClick={() => setTheme(theme() === "light" ? "dark" : "light")}
                  >
                    Toggle theme
                  </button>
                  <button type="button" class="k2b-button" onClick={confirmAction}>
                    Open prompt
                  </button>
                </div>
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
                <section style="border:1px solid var(--k2b-border);border-radius:var(--k2b-radius-surface);background:var(--k2b-surface);padding:12px">
                  <h2 style="margin:0 0 8px;font-size:13px">Content / Chart</h2>
                  <Chart
                    kind="line"
                    label="Example request volume"
                    style="height:15rem"
                    series={[
                      {
                        label: "Requests",
                        data: [
                          { x: 1, y: 12 },
                          { x: 2, y: 19 },
                          { x: 3, y: 14 },
                          { x: 4, y: 27 },
                        ],
                      },
                    ]}
                  />
                </section>

                <section style="border:1px solid var(--k2b-border);border-radius:var(--k2b-radius-surface);background:var(--k2b-surface);padding:12px">
                  <h2 style="margin:0 0 8px;font-size:13px">Surfaces / Placeholder</h2>
                  <Placeholder
                    variant="panel"
                    title={confirmed() ? "Prompt confirmed" : "No selection yet"}
                    description="This state uses only @k2b/ui semantic tokens."
                  />
                </section>
              </div>
            </div>
          </AppWorkspace.Main>
        </AppWorkspace.Content>
      </AppWorkspace>
    </div>
  );
}
