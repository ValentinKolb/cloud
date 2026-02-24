import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import CreateUserForm from "./CreateUserForm.island";
import DenyRequest from "../DenyRequest.island";
import { accountsService } from "../../../service";

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
  const requestId = c.req.query("request");
  let accountRequest: AccountRequest | null = null;

  if (requestId) {
    const requestResult = await accountsService.accountRequest.get({
      id: requestId,
      access: {
        userId: c.get("user").id,
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
      <div class="max-w-2xl mx-auto">
        {accountRequest && (
          <div class="paper p-4 mb-4 flex flex-col gap-3 border-amber-500">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-primary flex items-center gap-2">
                <i class="ti ti-user-plus text-amber-500" />
                Account Request
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
              <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3">
                <p class="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1">
                  <i class="ti ti-message text-xs" />
                  Requester's Note
                </p>
                <p class="text-sm text-amber-800 dark:text-amber-300">{accountRequest.comment}</p>
              </div>
            )}

            <p class="text-xs text-dimmed">The request will be marked as completed when the user is created.</p>
          </div>
        )}
        <div class="paper p-6">
          <h1 class="text-xl font-bold text-primary mb-6">Create New User</h1>
          <CreateUserForm
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
    </Layout>
  );
});
