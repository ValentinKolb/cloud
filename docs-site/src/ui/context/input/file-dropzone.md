# FileDropzone

`FileDropzone` provides file-picker and drag-and-drop input. The parent owns validation beyond file type, upload progress, persistence, and the list of accepted files.

## Use FileDropzone

Use it for uploads where dropping files is a useful primary interaction.

Use `ImageInput` for one image with an immediate transformed preview.

## Import

```tsx
import {
  FileDropzone,
  type FileDropzoneProps,
} from "@k2b/ui";
```

## Files and upload state

`onDrop` receives a `File[]` from either interaction. `multiple` defaults to `true`; when it is `false`, only the first file is emitted.

`accept` is a reactive string prop and is read when a picker or drop happens,
so changing a file policy does not require remounting the field. It is passed to
both the hidden file input and the drop handler. Validate size, content, and
permissions again before upload.

The parent reports progress through `busy`. While busy, the dropzone is
disabled and shows its loading state. `error` accepts visible JSX. `title`,
`subtitle`, `hint`, and `icon` describe the upload task.

The component does not retain selected files. Store them or start the upload in `onDrop`.

## Accessibility

The drop surface is a button, so it works with keyboard activation. Provide
`label`, `aria-label`, or a clear `title` that names the expected file.

Do not communicate file restrictions only through an icon or invalid-drag color. State them in `subtitle` or `hint`.

## Runtime

File selection and drag events require hydrated Solid client code. Server-rendered markup provides the initial field surface.

## Example

```tsx
<FileDropzone
  label="Attachment"
  accept="application/pdf"
  multiple={false}
  subtitle="PDF, up to 10 MB"
  busy={upload.loading()}
  error={upload.error()}
  onDrop={(files) => upload(files[0]!)}
/>;
```
