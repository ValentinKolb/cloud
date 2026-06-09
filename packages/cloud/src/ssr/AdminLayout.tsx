import type { JSX } from "solid-js/jsx-runtime";
import type { LayoutAnnouncementsState } from "../server/middleware/settings";
import AdminSidebar from "./AdminSidebar";
import Layout from "./Layout";
import { getRuntimeContext, type RuntimeContext } from "./runtime";

type Breadcrumb = { title: string; href?: string };
type AdminLayoutContext = {
  get(key: "user"): any;
  get(key: "page"): any;
  get(key: "runtime"): RuntimeContext;
  get(key: "settings"): Record<string, any>;
  get(key: "announcements"): LayoutAnnouncementsState | undefined;
  req: { raw: { headers: Headers; url: string } };
};
type Props = {
  children: JSX.Element;
  c: AdminLayoutContext;
  title: string;
  /** Bypass the scroll wrapper — child manages its own overflow. */
  stretch?: boolean;
};
export default function AdminLayout({ children, c, title, stretch }: Props) {
  const url = new URL(c.req.raw.url);
  const currentPath = `${url.pathname}${url.search}`;
  const runtime = getRuntimeContext(c);
  const breadcrumbs: Breadcrumb[] = [
    { title: "Start", href: "/" },
    { title: "Admin", href: "/admin" },
  ];
  if (title !== "Overview") {
    breadcrumbs.push({ title });
  }
  return (
    <Layout c={c} fullWidth title={breadcrumbs}>
      <div class="app-cols flex-1 min-h-0">
        <AdminSidebar currentPath={currentPath} apps={runtime.apps} />
        <div class="flex-1 min-w-0 min-h-0 flex flex-col">
          <div class={`flex-1 min-h-0 ${stretch ? "flex flex-col" : "overflow-y-auto"}`} style="scrollbar-gutter: stable">
            {children}
          </div>
        </div>
      </div>
    </Layout>
  );
}
