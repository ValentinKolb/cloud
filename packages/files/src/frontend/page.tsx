import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { filesService } from "@/service";
import { Layout } from "@valentinkolb/cloud/ssr";

/**
 * Files index page - redirects to first accessible base
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");

  // Get all accessible bases
  const bases = await filesService.base.listResolved({ user });

  if (bases.length === 0) {
    return () => (
      <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Files" }]}>
        <div class="flex items-center justify-center gap-2 text-xs text-dimmed h-full">
          <i class="ti ti-folder-off" />
          <span>No accessible file storage</span>
        </div>
      </Layout>
    );
  }

  // Redirect to first base
  const firstBase = bases[0]!;
  const redirectUrl = firstBase.type === "home" ? "/app/files/home" : `/app/files/group/${firstBase.name}`;

  return c.redirect(redirectUrl, 302);
});
