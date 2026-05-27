export type { SettingsFieldProps, SettingsSaveBarProps } from "./admin-settings";
export { readSettingsError, SettingsField, SettingsSaveBar, sameSettingValue } from "./admin-settings";
export type { DialogClose, DialogCore, DialogRender, OpenDialogOptions } from "./dialog-core";
export { createDialogCore, dialogCore } from "./dialog-core";
export * from "./filter";
export * from "./input";
export * from "./misc";
export type { LinkNavigateEvent, LinkProps } from "./NavigationLink";
export { Link } from "./NavigationLink";
export type { EnhancedNavigateOptions, NavigationScrollMode, ScrollSnapshot } from "./navigation";
export {
  captureScroll,
  currentPathWithQuery,
  documentNavigate,
  navigate,
  navigateTo,
  refreshCurrentPath,
  restoreScroll,
  startViewTransition,
} from "./navigation";
export type { PromptSearchInput, PromptSearchItem, PromptSearchOptions } from "./prompts";
export { createFormState, DialogHeader, prompts } from "./prompts";
export type { ToastFn, ToastHandle, ToastOptions, ToastVariant } from "./toast";
export { toast } from "./toast";
export * from "./widgets";
// NOTE: islands (*.island.tsx) belong inside the consuming app's package, not
// in cloud-lib. The SSR plugin discovers islands by import-path suffix; barrel
// re-exports strip the `.island` segment and silently break hydration. Apps
// that need a complex stateful component build their own admin/page islands
// using the input primitives exported above (TextInput, Switch, ImageInput, …).
