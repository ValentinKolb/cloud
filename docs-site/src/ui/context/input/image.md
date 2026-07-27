# ImageInput

`ImageInput` opens a file picker, transforms the selected image, and returns a data URL. The parent owns the value, storage, and upload.

## Use ImageInput

Use it for a single generic image field with an immediate preview.

Use `FileDropzone` for drag-and-drop or multiple files. Use `openAvatarUploadDialog` for profile-picture writes that need the shared crop and save flow.

## Import

```tsx
import { ImageInput } from "@valentinkolb/cloud/ui";
```

## Value and transformation

`value` is an accessor returning a data URL, image URL, or `null`. `onChange` receives the transformed data URL or `null` when the image is removed.

The default transform uses the avatar preset and produces a square 512×512 WebP. Pass `transform(file)` for banners or other images that must preserve a different aspect ratio. `accept` controls the file-picker filter.

`variant="default"` renders a large preview. `variant="small"` renders compact preview, change, and remove controls. `round` changes the preview shape.

The input is read-only when `onChange` is absent. URLs containing `?fallback` are treated as an unset value.

## Accessibility

Provide a visible `label`, or set `ariaLabel` for the image preview. Change and remove controls include their own accessible names.

File type and size restrictions still need validation in the owning upload path.

## Runtime

The browser file picker and image transformation require hydrated Solid client code.

## Example

```tsx
const [image, setImage] = createSignal<string | null>(null);

<ImageInput
  label="Project image"
  accept="image/png,image/jpeg"
  value={image}
  onChange={setImage}
/>;
```
