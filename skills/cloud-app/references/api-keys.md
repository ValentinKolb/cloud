# App API key pattern

Use this reference when an app resource needs API keys for automation or integrations. Cloud owns service-account identity and credential security; the app owns the resource permission decision.

## Model

- User-bound API keys live in core self-service (`/me`) and inherit the linked user's effective permissions.
- Resource-bound API keys belong to one app resource, for example one notebook. They authenticate as a `service_account` principal and only work where the app grants that service account access.
- Core tables remain platform-owned: `auth.service_accounts`, `auth.service_account_credentials`, and `auth.access`.
- Apps create only their own resource/access junction tables and never migrate core auth tables.

## Backend flow

Create resource API keys through the app API, not through the generic permission endpoint.

1. Resolve the app resource and require admin permission on that resource.
2. Call `serviceAccounts.getOrCreateResourceBound({ appId, resourceType, resourceId, name, createdBy })`.
3. Grant or update the service-account principal in the app service layer:

```ts
await myService.resource.access.ensureServiceAccount({
  resourceId,
  serviceAccountId: serviceAccount.id,
  permission,
});
```

4. Call `serviceAccountCredentials.createResourceApiToken({ serviceAccountId, actor, name, expiresAt })`.
5. Return the raw token once. Never store or re-display it.

List resource keys with `serviceAccountCredentials.listOverview()` filtered by:

```ts
filter: {
  serviceAccountKind: "resource_bound",
  credentialStatus: "active",
  appId: "my-app",
  resourceType: "my-resource",
  resourceId,
}
```

Revoking an API key revokes the credential, not the service-account resource grant. Keep permission lifecycle and secret lifecycle separate unless the user explicitly asks for a cleanup action.

## Frontend flow

Put API keys in the resource settings UI, usually in the same `SettingsModal.Tab` as access controls:

```tsx
import { ResourceApiKeys, PermissionEditor } from "@valentinkolb/cloud/ui";

<SettingsModal.Tab id="access" title="Access" icon="ti ti-shield">
  <div class="flex flex-col gap-6">
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

    <PermissionEditor {...permissionEditorProps} />
  </div>
</SettingsModal.Tab>
```

Load resource API keys lazily when opening settings if the settings dialog already loads access entries lazily. Do not add extra page-load requests for ordinary resource navigation.

## PermissionEditor boundary

`PermissionEditor` is grant UI only. It may opt in to existing service-account principals with `allowServiceAccounts`, but it must not create API keys, show raw tokens, or own credential revoke flows.

Use this split:

- `ResourceApiKeys`: create/revoke secrets and choose the initial resource permission.
- `PermissionEditor`: inspect, add, update, or remove principals that already exist.
- App service layer: validate resource admin rights and ensure the service-account principal has the selected permission.

## Verification

Run at least:

```bash
bun run --filter @valentinkolb/cloud typecheck
bun run --filter @valentinkolb/cloud-app-<app> typecheck
bun test packages/cloud/src/services/service-account-credentials.test.ts
```

For manual smoke, create a resource key, copy the token once, call a read endpoint with `Authorization: Bearer <token>`, then revoke it and verify the same call is rejected.
