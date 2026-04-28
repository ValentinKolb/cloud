import { ssr } from "../../config";
import { coreSettings } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { gradients } from "@valentinkolb/stdlib";
import type { WidgetData } from "@valentinkolb/cloud/contracts";
import { WidgetCard } from "@valentinkolb/cloud/ui";

// TODO(stage-3-followup): widget rendering used to build-time-import every
// app's widget factories (createFilesWidget, createWeatherWidget, etc.). That
// violated the per-package container rule, so the imports are gone. Replace
// with a runtime mechanism — each app exposes a widget render endpoint, the
// home page calls listApps() and fetches widget HTML/data through the gateway.
// Tracked in backlog.

export default ssr<AuthContext>(async (c) => {
    const user = c.get("user");

    // Parse hidden widgets from cookie
    const cookie = c.req.raw.headers.get("Cookie") ?? "";
    const hiddenMatch = cookie.match(/hiddenWidgets=([^;]+)/);
    let hiddenWidgets: string[] = [];
    try {
      if (hiddenMatch?.[1]) hiddenWidgets = JSON.parse(decodeURIComponent(hiddenMatch[1]));
    } catch {}

    // Parse name gradient preference
    const gradientMatch = cookie.match(/nameGradient=([^;]+)/);
    const gradient = gradients.getGradientById(gradientMatch?.[1] ? decodeURIComponent(gradientMatch[1]) : "default");

    // Widgets disabled until the runtime widget-fetch mechanism lands.
    const widgets: WidgetData[] = [];
    void hiddenWidgets;
    void user;

    const appName = (await coreSettings.get<string>("app.name")) || "Home";

    return () => (
      <Layout c={c} title={appName}>
        <div class="flex-1 flex flex-col items-center justify-center p-4 max-w-7xl mx-auto w-full">
          {/* Welcome text */}
          <h1 class="text-4xl sm:text-5xl font-bold mb-8 text-center" style="view-transition-name: page-title">
            {user ? (
              <>
                <span class="text-primary">Hi, </span>
                <span class={gradient.style ? "" : "text-primary"} style={gradient.style}>
                  {user.displayName || user.uid}
                </span>
              </>
            ) : (
              <span class={gradient.style ? "" : "text-primary"} style={gradient.style}>
                {appName}
              </span>
            )}
          </h1>

          {/* Widgets grid */}
          {widgets.length > 0 && (
            <div
              class={`grid gap-4 w-full grid-cols-1 ${
                widgets.length === 1
                  ? "sm:grid-cols-1 max-w-xs mx-auto"
                  : widgets.length === 2
                    ? "sm:grid-cols-2 max-w-2xl mx-auto"
                    : widgets.length === 3
                      ? "sm:grid-cols-2 lg:grid-cols-3"
                      : "sm:grid-cols-2 lg:grid-cols-4"
              }`}
            >
              {widgets.map((widget) => (
                <WidgetCard title={widget.title} icon={widget.icon}>
                  {widget.content}
                </WidgetCard>
              ))}
            </div>
          )}
        </div>
      </Layout>
    );
});
