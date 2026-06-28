export type { SettingsFieldProps, SettingsPanelFooterProps, SettingsSaveBarProps } from "./admin-settings";
export { readSettingsError, SettingsField, SettingsPanelFooter, SettingsSaveBar, sameSettingValue } from "./admin-settings";
export type { DialogClose, DialogCore, DialogRender, OpenDialogOptions } from "./dialog-core";
export { createDialogCore, dialogCore } from "./dialog-core";
export * from "./filter";
export * from "./input";
export { LAYOUT_UPDATE_EVENT, type LayoutBreadcrumb, type LayoutUpdate, layout } from "./layout";
export * from "./misc";
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
