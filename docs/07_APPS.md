# Built-in Apps

Built-in apps are packaged in `cloud/packages/apps` and registered in deterministic order in:

- `cloud/packages/standalone/src/built-in-apps.ts`

Current built-ins include files, spaces, notebooks, contacts, tools, weather, accounts, hosts, notifications, oauth, proxy-auth, sync, logging, faq, terms, settings, quotes, and ui-lab.

## App Registration Model

- standalone mode loads built-ins from `@valentinkolb/cloud-apps`
- custom runtimes can provide their own app list to `createCloud({ apps })`
- all apps use the same `AppFacade` contract

## Minimal App Checklist

1. define `meta`, `service`, `routes` in app `index.ts`
2. export default facade, named `service`, and `ApiType`
3. if `api.ts` exists, provide app-scoped client at `src/<app>/client.ts` exporting `apiClient`
4. add app to standalone built-in list if it should be built-in
5. keep lifecycle hooks (`setup/start/stop`) only when needed
