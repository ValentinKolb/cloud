import {
  Button,
  Checkbox,
  CheckboxCard,
  IconButton,
  MultiSelectInput,
  RemoveButton,
  Select,
  Switch,
} from "@k2b/ui";
import type {
  ContextMenuContent,
  CopyButtonValue,
  DateContext,
  DatePickerBaseProps,
  DropdownActionBase,
  FilterChipChange,
  MaybeAccessor,
  PromptFieldBase,
  SegmentedControlChange,
  SelectSourceOption,
} from "@k2b/ui";

const components = [Button, Checkbox, CheckboxCard, IconButton, MultiSelectInput, RemoveButton, Select, Switch];
const dateContext: DateContext = { locale: "en", timeZone: "UTC" };
const dateProps: DatePickerBaseProps<string | null> = { value: null, dateConfig: dateContext };
const maybe: MaybeAccessor<string> = () => "ready";
const selectOption: SelectSourceOption = { id: "platform", label: "Platform" };
const contextMenu: ContextMenuContent = { items: [{ id: "open", label: "Open" }] };
const copyValue: CopyButtonValue = { text: "portable" };
const dropdownAction: DropdownActionBase = { label: "Open" };
const promptField: PromptFieldBase<string> = { label: "Name" };
const filterChange: FilterChipChange = { onValueChange: () => {} };
const segmentedChange: SegmentedControlChange<"one"> = { onValueChange: () => {} };

void [
  components,
  contextMenu,
  copyValue,
  dateProps,
  dropdownAction,
  filterChange,
  maybe,
  promptField,
  segmentedChange,
  selectOption,
];

// Cloud compatibility names are deliberately absent from the package API.
// @ts-expect-error no compatibility alias
import type { CheckboxInput } from "@k2b/ui";
// @ts-expect-error no compatibility alias
import type { CheckboxCardInput } from "@k2b/ui";
// @ts-expect-error no compatibility alias
import type { MultiSelect } from "@k2b/ui";
// @ts-expect-error no compatibility alias
import type { RemoveBtn } from "@k2b/ui";
// @ts-expect-error no compatibility alias
import type { RemoveBtnProps } from "@k2b/ui";
// @ts-expect-error no compatibility alias
import type { SegmentedControlOption } from "@k2b/ui";
// @ts-expect-error no compatibility alias
import type { SelectInput } from "@k2b/ui";
// @ts-expect-error no compatibility alias
import type { SwitchInput } from "@k2b/ui";
