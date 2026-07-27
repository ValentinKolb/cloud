import {
  AutocompleteEditorAsync,
  AutocompleteEditorFormula,
  AutocompleteEditorMentions,
  AutocompleteEditorSingleLine,
  CheckboxCardDemo,
  CheckboxDemo,
  ColorInputDemo,
  ComboboxDemo,
  DateInputDemo,
  DatePickerDemo,
  DatePickerPlainDemo,
  DateRangePickerDemo,
  DateRangePickerWithTimeDemo,
  DateTimeInputDemo,
  DateTimePickerDemo,
  FileDropzoneAcceptDemo,
  FileDropzoneDemo,
  IconInputDemo,
  ImageCropperDemo,
  ImageInputDemo,
  MarkdownEditorStandalone,
  MultiSelectInputDemo,
  NumberInputBasic,
  NumberInputCurrency,
  NumberInputPercent,
  PinInputDemo,
  SelectBasic,
  SelectChipDemo,
  SelectFetchData,
  SliderDemo,
  SwitchDemo,
  TagsInputDemo,
  TextInputAi,
  TextInputBasic,
  TextInputClearable,
  TextInputError,
  TextInputMarkdown,
  TextInputMarkdownCompletions,
  TextInputPassword,
  TextInputWithIcon,
} from "../../../../packages/ui-lab/src/frontend/lab/inputs";
import { FilterChipDemo } from "../../../../packages/ui-lab/src/frontend/lab/navigation";
import { DemoGrid, type DemoSection } from "./types";

const demos: DemoSection = {
  text: () => (
    <DemoGrid>
      <TextInputBasic />
      <TextInputWithIcon />
      <TextInputAi />
      <TextInputClearable />
      <TextInputError />
      <TextInputPassword />
      <TextInputMarkdown />
      <TextInputMarkdownCompletions />
    </DemoGrid>
  ),
  "markdown-editor": () => (
    <DemoGrid columns="one">
      <MarkdownEditorStandalone />
    </DemoGrid>
  ),
  autocomplete: () => (
    <DemoGrid columns="one">
      <AutocompleteEditorMentions />
      <AutocompleteEditorFormula />
      <AutocompleteEditorAsync />
      <AutocompleteEditorSingleLine />
    </DemoGrid>
  ),
  number: () => (
    <DemoGrid>
      <NumberInputBasic />
      <NumberInputPercent />
      <NumberInputCurrency />
    </DemoGrid>
  ),
  "date-picker": () => (
    <DemoGrid>
      <DatePickerDemo />
      <DatePickerPlainDemo />
      <DateTimePickerDemo />
      <DateRangePickerDemo />
      <DateRangePickerWithTimeDemo />
    </DemoGrid>
  ),
  "date-time": () => (
    <DemoGrid>
      <DateTimeInputDemo />
      <DateInputDemo />
    </DemoGrid>
  ),
  select: () => (
    <DemoGrid>
      <SelectBasic />
      <SelectFetchData />
      <SelectChipDemo />
      <MultiSelectInputDemo />
    </DemoGrid>
  ),
  combobox: () => (
    <DemoGrid>
      <ComboboxDemo />
    </DemoGrid>
  ),
  color: () => (
    <DemoGrid>
      <ColorInputDemo />
    </DemoGrid>
  ),
  tags: () => (
    <DemoGrid>
      <TagsInputDemo />
    </DemoGrid>
  ),
  pin: () => (
    <DemoGrid>
      <PinInputDemo />
    </DemoGrid>
  ),
  image: () => (
    <DemoGrid>
      <ImageInputDemo />
    </DemoGrid>
  ),
  "image-cropper": () => (
    <DemoGrid columns="one">
      <ImageCropperDemo />
    </DemoGrid>
  ),
  "file-dropzone": () => (
    <DemoGrid>
      <FileDropzoneDemo />
      <FileDropzoneAcceptDemo />
    </DemoGrid>
  ),
  icon: () => (
    <DemoGrid>
      <IconInputDemo />
    </DemoGrid>
  ),
  slider: () => (
    <DemoGrid>
      <SliderDemo />
    </DemoGrid>
  ),
  filters: () => (
    <DemoGrid>
      <FilterChipDemo />
    </DemoGrid>
  ),
  boolean: () => (
    <DemoGrid>
      <SwitchDemo />
      <CheckboxDemo />
      <CheckboxCardDemo />
    </DemoGrid>
  ),
};

export default demos;
