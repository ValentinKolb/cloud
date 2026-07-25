# Resource API keys

Read this when an app resource needs API keys for automation or integrations. Core owns service-account identity and credential security; the app owns the resource permission decision.

The general principal model is in `auth.md`. This page is only the end-to-end flow.

## Two kinds of key

| | User-bound | Resource-bound |
|---|---|---|
| Created in | Core self-service (`/me`) | The app's own resource settings |
| Authenticates as | The linked user | A `service_account` principal |
| Permissions | The user's effective permissions | Only what the app granted that service account |
| Global Search | Allowed | **Rejected** |

OAuth `client_credentials` tokens for resource-bound service accounts use the same principal and access model. The only difference is issuance: short-lived JWTs from the OAuth app, versus long-lived hashed `cld_<prefix>_<secret>` credentials in core.

## Backend flow

Create resource API keys through app-specific routes — `GET`/`POST`/`DELETE /:id/api-keys` — never through the generic permission endpoint.

1. Resolve the resource and require **admin** permission on it.
2. Create the service account:

```typescript
const serviceAccount = await serviceAccounts.createResourceBound({
  name: `${resource.name} API access`,
  appId: "my-app",
  resourceType: "item",
  resourceId: resource.id,
  createdBy: user.id,
});
if (!serviceAccount.ok) return serviceAccount;
```

3. Grant the principal through the app's **own** access layer — the same adapter `PermissionEditor` uses:

```typescript
const access = await myService.item.access.ensureServiceAccount({
  itemId: resource.id,
  serviceAccountId: serviceAccount.data.id,
  permission,
});
if (!access.ok) return access;
```

4. Mint the credential and return the raw token **once**:

```typescript
return serviceAccountCredentials.createResourceApiToken({
  serviceAccountId: serviceAccount.data.id,
  actor: user,
  name,
  expiresAt,
  scopes: [permission],
});
```

List existing keys with `serviceAccountCredentials.listOverview()`, filtered by `serviceAccountKind: "resource_bound"`, `credentialStatus: "active"`, and the app's `appId` / `resourceType` / `resourceId`.

> The user object in steps 2 and 4 must be user-backed. Apps typically wrap that check in a small local helper — there is no framework-provided `expectUserBackedActor`; each app that wants one defines its own. Derive it from `c.get("actor")`.

## What scopes do and do not do

Scopes **cap** the permission resolved from `auth.access`. They never grant it. On every request the service still resolves access through `accessSubject` and the resource adapter, then takes the lower of that permission and the credential scope.

Middleware does not turn scopes into grants. Do not add OAuth-specific permission branches in app services unless the app is deliberately checking scopes as an additional limit.

Always verify a resource-bound account's exact `appId`, `resourceType`, and `resourceId` before loading data. Collection and search endpoints fail closed or query only the bound resource.

## Frontend flow

API keys live in the resource settings surface, usually in the same `SettingsModal.Tab` as access control, above `PermissionEditor`:

```tsx
import { ResourceApiKeys, PermissionEditor } from "@valentinkolb/cloud/ui";

<SettingsModal.Tab id="access" title="Access" icon="ti ti-shield">
  <div class="flex flex-col gap-6">
    <PermissionEditor {...permissionEditorProps} />

    <ResourceApiKeys
      initialKeys={apiKeys}
      description="Resource-bound keys for integrations that need access to this resource."
      createKey={async (input) => {
        const res = await apiClient[":id"]["api-keys"].$post({ param: { id }, json: input });
        if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create API key."));
        return await res.json();
      }}
      revokeKey={async (credentialId) => {
        const res = await apiClient[":id"]["api-keys"][":credentialId"].$delete({ param: { id, credentialId } });
        if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to revoke API key."));
      }}
    />
  </div>
</SettingsModal.Tab>
```

Load keys lazily when settings open, alongside the access entries. Do not add page-load requests for ordinary resource navigation.

`readErrorMessage` is a small app-local helper, not a framework export — see `frontend.md`.

## The PermissionEditor boundary

`PermissionEditor` is **grant UI only**. It may opt into showing existing service-account principals via `allowServiceAccounts`, but it must never create API keys, display raw tokens, or own revocation.

| Concern | Owner |
|---|---|
| Create/revoke secrets, choose initial permission | `ResourceApiKeys` |
| Inspect, add, update, remove existing principals | `PermissionEditor` |
| Validate resource admin rights, ensure the grant | App service layer |

Revoking a credential does not remove the service account or its grant. Keep the two lifecycles separate unless the user explicitly asks for cleanup.

## Verification

Smoke the full loop: create a key, copy the token once, call a read endpoint with `Authorization: Bearer <token>`, revoke it, then confirm the same call is now rejected.

If the resource supports OAuth client credentials, repeat with a token from `/oauth/token` using `grant_type=client_credentials` and an allowed `scope` and `resource`. Invalid scopes, invalid resources, public clients, and clients without an active resource-bound service account must all be rejected.

Cover in tests: nested-group parity, spoofed group metadata being ignored, `public`/`authenticated` entries, exact service-account binding, scope caps, and denial of personal operations for resource-bound accounts.
