# ImageCropper

`ImageCropper` selects a crop rectangle and rotation for one image. It emits crop state; the parent decides when and how to create the output image.

## Use ImageCropper

Use it after an image has been selected and the user must control the visible region.

Use `ImageInput` when the default image transform is sufficient and no crop UI is needed.

## Import

```tsx
import {
  createCroppedImageDataUrl,
  ImageCropper,
  type ImageCropState,
} from "@k2b/ui";
```

## Source and crop state

`source` accepts a `File`, `Blob`, image element, canvas element, or URL. `onValueChange` receives `{ crop, rotation }` after the image is ready, or `null` while no valid crop is available.

`aspect` defaults to `"free"`. Pass `{ width, height }` for a fixed ratio. `previewShape="circle"` changes only the preview mask; exported pixels still use the rectangular crop.

Rectangular crops can be moved and resized from their corners. A fixed `aspect` stays locked and keeps the opposite corner anchored during resize. A circular preview can be moved but has no corner handles. Rotation advances in 90-degree steps.

When the crop surface is focused, arrow keys move it and Shift+arrow resizes
it. The same clamping and fixed-aspect rules apply to pointer and keyboard
editing.

Use `createCroppedImageDataUrl` or `createCroppedImageCanvas` to apply the emitted state. Output options support exact dimensions, maximum dimensions, format, and quality.

## Accessibility

Rotation, moving, and resizing are keyboard operable. Keep a reset path and do
not require pixel-perfect placement to complete the task.

Give the generated preview a useful `alt` value in the owning UI.

## Runtime

Image loading, pointer interaction, canvas export, and object URLs require hydrated browser code. Revoke and replacement of temporary object URLs is handled by the component.

## Example

```tsx
const [crop, setCrop] = createSignal<ImageCropState | null>(null);

<ImageCropper
  source={file}
  aspect={{ width: 1, height: 1 }}
  previewShape="circle"
  onValueChange={setCrop}
/>;

const state = crop();
if (state) {
  const result = await createCroppedImageDataUrl(file, state, {
    maxWidth: 480,
    maxHeight: 480,
    format: "webp",
  });
}
```
