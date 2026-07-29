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

`source` accepts a `File`, `Blob`, image element, canvas element, or URL. `onChange` receives `{ crop, rotation }` after the image is ready, or `null` while no valid crop is available.

`aspect` defaults to `"free"`. Pass `{ width, height }` for a fixed ratio. `previewShape="circle"` changes only the preview mask; exported pixels still use the rectangular crop.

Free crops can be moved and resized, except with `previewShape="circle"`, which has neither resize handles nor a zoom slider and can only be moved. Fixed-aspect crops can be moved and zoomed. Rotation advances in 90-degree steps.

Use `createCroppedImageDataUrl` or `createCroppedImageCanvas` to apply the emitted state. Output options support exact dimensions, maximum dimensions, format, and quality.

## Accessibility

Rotation and zoom are keyboard operable. Moving and resizing the crop area is pointer-driven, so do not make precise cropping the only way to complete a keyboard-only flow.

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
  onChange={setCrop}
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
