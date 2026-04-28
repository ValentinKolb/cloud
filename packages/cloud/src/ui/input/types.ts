import type { JSX } from "solid-js";

/**
 * Shared input component prop types
 */

/** Base props shared by all input components */
export type BaseInputProps = {
  label?: string | JSX.Element;
  description?: string;
  error?: () => string | undefined;
  required?: boolean;
  disabled?: boolean;
};

/** Props for checkbox/toggle inputs */
export type CheckboxInputProps = BaseInputProps & {
  value?: () => boolean | undefined;
  onChange?: (checked: boolean) => void;
};

/** Props for switch/toggle inputs */
export type SwitchInputProps = {
  label?: string;
  value?: () => boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
};

/** Props for color input */
export type ColorInputProps = BaseInputProps & {
  value?: () => string | undefined;
  onChange?: (value: string) => void;
  /** Compact mode - just shows color swatch */
  compact?: boolean;
  /** Show a transparent toggle button inside the input */
  transparent?: boolean;
  /** Whether transparent is currently active */
  isTransparent?: () => boolean;
  /** Called when transparent toggle changes */
  onTransparentChange?: (value: boolean) => void;
};
