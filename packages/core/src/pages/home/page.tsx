import { ssr } from "@config";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import Layout from "@/ssr/Layout";
import { type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import { gradients } from "@valentinkolb/cloud-lib/shared";
import type { AppFacade, WidgetData } from "@valentinkolb/cloud-contracts/app";
import { WidgetCard } from "@valentinkolb/cloud-lib/ui";

export const createHomePage = (apps: readonly AppFacade[]) => {
  const appWidgetFactories = apps.flatMap((app) => app.widgets ?? []);

  return ssr<AuthContext>(async (c) => {
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

    // Load app widgets + core widgets in parallel.
    const appWidgets = await Promise.all(appWidgetFactories.map((factory) => Promise.resolve(factory(c, user))));

    // Filter out null widgets
    const widgets: WidgetData[] = [...appWidgets]
      .filter((w): w is WidgetData => w !== null)
      .filter((w) => !hiddenWidgets.includes(w.id));

    return (
      <Layout c={c} title={getSync<string>("app.name") || "Home"}>
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
                {getSync<string>("app.name") || "Home"}
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
};
