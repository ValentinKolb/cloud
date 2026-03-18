import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import CreateUserForm from "./CreateUserForm.island";
import DenyRequest from "../DenyRequest.island";
import AccountsNavSidebar from "../../AccountsNavSidebar";

type AccountRequest = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  phone: string | null;
  comment: string | null;
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const freeIpaEnabled = Boolean(getSync<boolean>("freeipa.enable"));
  const requestId = c.req.query("request");
  let accountRequest: AccountRequest | null = null;
  const pendingRequestsPage = await accountsService.accountRequest.list({
    access: { userId: user.id, isAdmin: true },
    filter: { status: "pending" },
  });

  if (requestId) {
    const requestResult = await accountsService.accountRequest.get({
      id: requestId,
      access: {
        userId: user.id,
        isAdmin: true,
      },
    });

    if (requestResult.ok && requestResult.data.status === "pending") {
      const req = requestResult.data;
      accountRequest = {
        id: req.id,
        email: req.email,
        firstName: req.firstName,
        lastName: req.lastName,
        displayName: req.displayName,
        phone: req.phone,
        comment: req.comment,
      };
    }
  }

  return (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Accounts", href: "/app/accounts" },
        { title: "Users", href: "/app/accounts/users" },
        { title: "New User" },
      ]}
    >
      <div class="app-cols h-full">
        <AccountsNavSidebar active="users" isAdmin={true} pendingRequests={pendingRequestsPage.total} />
        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="max-w-2xl mx-auto">
            {accountRequest && (
              <div class="paper p-4 mb-4 flex flex-col gap-3 border-amber-500">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-primary flex items-center gap-2">
                    <i class="ti ti-user-plus text-amber-500" />
                    FreeIPA Access Request
                  </h3>
                  <DenyRequest requestId={accountRequest.id} email={accountRequest.email} firstName={accountRequest.firstName} />
                </div>

                <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt class="text-dimmed">Name</dt>
                  <dd class="text-primary font-medium">
                    {accountRequest.displayName || `${accountRequest.firstName} ${accountRequest.lastName}`}
                  </dd>
                  <dt class="text-dimmed">Email</dt>
                  <dd class="text-secondary">{accountRequest.email}</dd>
                  {accountRequest.phone && (
                    <>
                      <dt class="text-dimmed">Phone</dt>
                      <dd class="text-secondary">{accountRequest.phone}</dd>
                    </>
                  )}
                </dl>

                {accountRequest.comment && (
                  <div class="info-block-warning">
                    <p class="text-[10px] font-semibold mb-1 flex items-center gap-1">
                      <i class="ti ti-message text-xs" />
                      Requester's Note
                    </p>
                    <p class="text-sm">{accountRequest.comment}</p>
                  </div>
                )}

                <p class="text-xs text-dimmed">The request will be marked as completed when the FreeIPA-backed account is created.</p>
              </div>
            )}
            <div class="paper p-6">
              <div class="mb-6 flex flex-col gap-2">
                <h1 class="text-xl font-bold text-primary">Create New Account</h1>
                <p class="text-sm text-dimmed">
                  This compatibility page now opens the same provider-first dialog flow used from the Users and Requests pages.
                </p>
              </div>
              <CreateUserForm
                autoOpen
                freeIpaEnabled={freeIpaEnabled}
                prefill={
                  accountRequest
                    ? {
                        requestId: accountRequest.id,
                        email: accountRequest.email,
                        givenname: accountRequest.firstName,
                        sn: accountRequest.lastName,
                        displayName: accountRequest.displayName ?? undefined,
                        firstName: accountRequest.firstName,
                      }
                    : undefined
                }
              />
              <div class="mt-6">
                <CreateUserForm
                  buttonLabel="Open account creation"
                  buttonClass="btn-input btn-input-sm"
                  freeIpaEnabled={freeIpaEnabled}
                  prefill={
                    accountRequest
                      ? {
                          requestId: accountRequest.id,
                          email: accountRequest.email,
                          givenname: accountRequest.firstName,
                          sn: accountRequest.lastName,
                          displayName: accountRequest.displayName ?? undefined,
                          firstName: accountRequest.firstName,
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
