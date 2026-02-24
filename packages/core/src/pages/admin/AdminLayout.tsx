import type { JSX } from "solid-js/jsx-runtime";
import Layout from "@/ssr/Layout";
import AdminSidebar from "./AdminSidebar";
import { getRuntimeContext, type RuntimeContext } from "@/runtime";
type Breadcrumb = { title: string; href?: string };
type AdminLayoutContext = {
  get(key: "user"): any;
  get(key: "page"): any;
  get(key: "runtime"): RuntimeContext;
  req: { raw: { headers: Headers; url: string } };
};
type Props = {
  children: JSX.Element;
  c: AdminLayoutContext;
  title: string /** Remove inner padding — for pages with their own sidebar/layout */;
  contentFullWidth?: boolean;
};
export default function AdminLayout({ children, c, title, contentFullWidth }: Props) {
  const pathname = new URL(c.req.raw.url).pathname;
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
      {" "}
      <div class="app-cols h-full">
        {" "}
        {/* Sidebar (Desktop) */}{" "}
        <div class="hidden lg:flex flex-col w-48 shrink-0 overflow-y-auto">
          <AdminSidebar pathname={pathname} apps={runtime.apps} />
        </div>{" "}
        {/* Main */}{" "}
        <div class="flex-1 min-w-0 flex flex-col">
          {" "}
          {/* Mobile: Back link */}{" "}
          <div class="lg:hidden px-3 pt-2 pb-1">
            {" "}
            <a href="/admin" class="list-item text-xs">
              {" "}
              <i class="ti ti-arrow-left text-sm" /> <span>Admin</span>{" "}
            </a>{" "}
          </div>{" "}
          <div class="divider lg:hidden" /> {/* Scrollable Content */}{" "}
          <div class={`flex-1 min-h-0 ${contentFullWidth ? "flex flex-col" : "overflow-y-auto"}`}>
            {" "}
            {contentFullWidth ? children : <div class="p-4">{children}</div>}{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
    </Layout>
  );
}
