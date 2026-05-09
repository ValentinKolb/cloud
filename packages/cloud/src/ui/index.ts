export * from "./misc";
export * from "./ipa";
export * from "./input";
export * from "./filter";
export * from "./widgets";
export { currentPathWithQuery, refreshCurrentPath, navigateTo } from "./navigation";
export { SettingsField, SettingsSaveBar, sameSettingValue, readSettingsError } from "./admin-settings";
export type { SettingsFieldProps, SettingsSaveBarProps } from "./admin-settings";
export { prompts, DialogHeader, createFormState } from "./prompts";
export type { PromptSearchItem, PromptSearchInput, PromptSearchOptions } from "./prompts";
export { toast } from "./toast";
export type { ToastFn, ToastHandle, ToastOptions, ToastVariant } from "./toast";
export { dialogCore, createDialogCore } from "./dialog-core";
export type { DialogClose, OpenDialogOptions, DialogRender, DialogCore } from "./dialog-core";
export { default as SidebarLayout, SidebarFromSpec } from "./sidebar";
export type { SidebarSpec, SidebarRow, SidebarSection, SidebarTreeNode, SidebarTreeSpec } from "./sidebar";
// NOTE: islands (*.island.tsx) belong inside the consuming app's package, not
// in cloud-lib. The SSR plugin discovers islands by import-path suffix; barrel
// re-exports strip the `.island` segment and silently break hydration. Apps
// that need a complex stateful component build their own admin/page islands
// using the input primitives exported above (TextInput, Switch, ImageInput, …).
