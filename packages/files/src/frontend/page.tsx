import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppOverview } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/actor";
import { filesService } from "@/service";
import { ssr } from "../config";
import FilesLayoutHelp from "./_components/help/FilesLayoutHelp.island";

/**
 * Files index page - redirects to first accessible base
 */
export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);

  // Get all accessible bases
  const bases = await filesService.base.listResolved({ user });

  if (bases.length === 0) {
    return () => (
      <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Files" }]}>
        <FilesLayoutHelp />
        <AppOverview title="Files" subtitle="Browse and manage shared file storage." icon="ti ti-folders">
          <AppOverview.Main title="Storage" description="No accessible file storage is available for your account.">
            <AppOverview.EmptyState
              title="No accessible storage"
              description="Ask an administrator to grant access to a home or group file storage."
              icon="ti ti-folder-off"
            />
          </AppOverview.Main>
        </AppOverview>
      </Layout>
    );
  }

  // Redirect to first base
  const firstBase = bases[0]!;
  const redirectUrl = firstBase.type === "home" ? "/app/files/home" : `/app/files/group/${firstBase.name}`;

  return c.redirect(redirectUrl, 302);
});
