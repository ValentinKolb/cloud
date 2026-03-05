# Built-in Apps

Built-in apps are packaged in `cloud/packages/apps` and registered in deterministic order in:

- `cloud/packages/standalone/src/built-in-apps.ts`

Current built-ins include files, spaces, notebooks, contacts, tools, weather, accounts, hosts, notifications, oauth, proxy-auth, sync, logging, faq, terms, settings, quotes, and ui-lab.

## App Registration Model

- standalone mode loads built-ins from `@valentinkolb/cloud-apps`
- custom runtimes can provide their own app list to `createCloud({ apps })`
- all apps use the same `AppFacade` contract

## App Capabilities

Apps can expose optional cross-app capabilities via `AppFacade.capabilities`.

Global search uses:

- `capabilities.search.tags?: string[]`
- `capabilities.search.run({ query, tags, limit, ctx })`

Rules:

1. `limit` is provider-local only (from `provider_limit`)
2. provider tags are optional and app-owned
3. providers return app-local hrefs
4. optional `priority` must be `0..9`
5. optional `metadata` can add compact details (`[{label,value}]`)
6. optional `previewUrl` must be an app-local path (`/...`)
7. frontend applies final ranking/presentation

## Minimal App Checklist

1. define `meta`, `service`, `routes` in app `index.ts`
2. export default facade, named `service`, and `ApiType`
3. if `api.ts` exists, provide app-scoped client at `src/<app>/client.ts` exporting `apiClient`
4. add app to standalone built-in list if it should be built-in
5. keep lifecycle hooks (`setup/start/stop`) only when needed
