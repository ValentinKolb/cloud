import { dates } from "@k2b/stdlib";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { coreSettings } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import AccountHub, { AccountPageHeader, AccountProfileActions } from "./AccountHub";

const formatAddress = (address: {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
}): string | null => {
  const parts = [address.street, [address.postalCode, address.city].filter(Boolean).join(" "), address.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const [rawAppName, freeIpaEnabledRaw] = await Promise.all([
    coreSettings.get<string>("app.name"),
    coreSettings.get<boolean>("freeipa.enable"),
  ]);
  const appName = rawAppName || "Cloud";
  const freeIpaEnabled = Boolean(freeIpaEnabledRaw);
  const address = formatAddress(user.ipa?.address ?? { street: null, postalCode: null, city: null, state: null });

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Account", href: "/me" }, { title: "Profile" }]}>
      <AccountHub user={user} active="profile">
        <div class="flex flex-col gap-2">
          <AccountPageHeader
            title="Profile and contact"
            description="Review the identity and contact information other Cloud users can see."
            actions={<AccountProfileActions user={user} appName={appName} freeIpaEnabled={freeIpaEnabled} />}
          />

          <section class="paper p-5 sm:p-6">
            <div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <div>
                <p class="section-label mb-1">Display name</p>
                <p class="text-sm font-medium text-primary">{user.displayName || user.uid}</p>
              </div>
              <div>
                <p class="section-label mb-1">Username</p>
                <p class="text-sm text-secondary">{user.uid}</p>
              </div>
              <div>
                <p class="section-label mb-1">Email</p>
                <p class="break-words text-sm text-secondary">{user.mail ?? "Not set"}</p>
              </div>
              <div>
                <p class="section-label mb-1">Phone</p>
                <p class="text-sm text-secondary">{user.ipa?.phone ?? "Not set"}</p>
              </div>
              {user.ipa?.mobile && user.ipa.mobile !== user.ipa.phone && (
                <div>
                  <p class="section-label mb-1">Mobile</p>
                  <p class="text-sm text-secondary">{user.ipa.mobile}</p>
                </div>
              )}
              {user.ipa?.employeeType && (
                <div>
                  <p class="section-label mb-1">Employee type</p>
                  <p class="text-sm text-secondary">{user.ipa.employeeType}</p>
                </div>
              )}
              <div class="sm:col-span-2">
                <p class="section-label mb-1">Address</p>
                <p class="text-sm text-secondary">{address ?? "Not set"}</p>
              </div>
            </div>
          </section>

          <section class="paper p-5 sm:p-6">
            <div class="mb-5">
              <h3 class="text-sm font-semibold text-primary">Account facts</h3>
              <p class="mt-1 text-xs text-dimmed">Provider-managed values and account lifecycle dates.</p>
            </div>
            <div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <div>
                <p class="section-label mb-1">Provider</p>
                <p class="text-sm text-secondary">{user.provider === "ipa" ? "FreeIPA" : "Local account"}</p>
              </div>
              <div>
                <p class="section-label mb-1">Profile</p>
                <p class="text-sm text-secondary">{user.profile === "guest" ? "Guest account" : "Full account"}</p>
              </div>
              <div>
                <p class="section-label mb-1">Account expiry</p>
                <p class="text-sm text-secondary">{user.accountExpires ? dates.formatDate(user.accountExpires) : "No expiry"}</p>
              </div>
              <div>
                <p class="section-label mb-1">Password expiry</p>
                <p class="text-sm text-secondary">
                  {user.ipa?.passwordExpires ? dates.formatDate(user.ipa.passwordExpires) : "Not applicable"}
                </p>
              </div>
              <div>
                <p class="section-label mb-1">SSH keys</p>
                <p class="text-sm text-secondary">
                  {user.ipa?.sshPublicKeys.length ?? 0} {(user.ipa?.sshPublicKeys.length ?? 0) === 1 ? "key" : "keys"} configured
                </p>
              </div>
            </div>
          </section>
        </div>
      </AccountHub>
    </Layout>
  );
});
