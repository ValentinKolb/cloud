import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { LinkCard } from "@valentinkolb/cloud/lib/ui";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { hasRole } from "@/accounts/contracts";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const isAdmin = hasRole(user, "admin");

  return (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Accounts" }]}>
      <div class="max-w-4xl mx-auto">
        <div class="p-6 mb-4 text-center">
          <div class="flex items-center justify-center gap-3 mb-2">
            <div class="w-12 h-12 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <i class="ti ti-users-group text-2xl text-zinc-600 dark:text-zinc-400" />
            </div>
          </div>
          <h1 class="text-xl font-semibold mb-1">Accounts</h1>
          <p class="text-sm text-dimmed">Manage users, groups and permissions</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {isAdmin && (
            <LinkCard
              href="/app/accounts/users"
              title="Users"
              description="Manage user accounts, profiles and group memberships"
              icon="ti ti-users"
              color="blue"
            />
          )}
          <LinkCard
            href="/app/accounts/groups"
            title="Groups"
            description={isAdmin ? "Manage groups, members and permissions" : "View and manage your groups"}
            icon="ti ti-users-group"
            color="emerald"
          />
          <LinkCard href="/me" title="Profile" description="View and edit your account details" icon="ti ti-user" color="violet" />
        </div>
      </div>
    </Layout>
  );
});
