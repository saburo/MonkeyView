# Codex Implementation Brief: Overlay Image Alignment App

## Objective
Build a cross-platform desktop application for manual visual alignment of an overlay image on top of another application's visible content.

Primary deployment target: Windows  
Secondary development/testing target: macOS

Typical use case: a user aligns a reference image against a SIMS CCD camera image shown in another application beneath the overlay window.

## Recommended Stack
Use **Tauri 2** with a web UI frontend.

Why this stack:
- transparent windows are supported by Tauri window configuration,
- always-on-top windows are supported,
- click-through behavior can be controlled at runtime with `setIgnoreCursorEvents(true/false)`,
- platform-specific config files are supported for Windows and macOS differences. ([v2.tauri.app](https://v2.tauri.app/reference/config/?utm_source=chatgpt.com))

## Core Product Behavior
The app displays one image in a transparent always-on-top window. The underlying application must remain visible through transparent areas.

The user aligns the overlay by:
1. moving the app window via a toolbar drag handle,
2. selecting an anchor point on the image,
3. transforming the image in real time by dragging a point on the image.

## v1 Scope
Implement all of the following:
- single overlay image,
- transparent always-on-top window,
- PNG, JPG/JPEG, and TIFF loading,
- semi-transparent horizontal toolbar,
- window repositioning via a drag handle in the toolbar,
- two explicit modes: Transform mode and Select Anchor mode,
- always-visible anchor marker,
- uniform scaling only,
- rotation,
- direct drag-based transform interaction,
- click-through ON/OFF toggle for the image area,
- toolbar remains interactive while click-through is ON,
- current scale and rotation shown in the toolbar,
- current grab point shown during drag,
- reset to immediately-post-load state,
- automatic initial fit for oversized images,
- dynamic window resizing to match transformed image bounds.

Do not implement in v1:
- non-uniform scaling,
- independent image translation inside the window,
- multiple overlay images,
- preset save/load,
- automatic alignment.

## Platform Requirements
### Windows
This is the primary production platform and should be treated as the reference implementation.

### macOS
Must run for development/testing.

Note: transparent windows on macOS require the `macos-private-api` feature flag, which prevents App Store acceptance. That is acceptable for this project. ([v2.tauri.app](https://v2.tauri.app/reference/config/?utm_source=chatgpt.com))

## Window Requirements
Implement a transparent overlay window with these properties:
- always on top,
- frameless or minimal chrome,
- movable by dragging a handle in the toolbar,
- no independent image translation inside the window.

Use Tauri window configuration for transparency and always-on-top, and runtime window APIs where needed. Tauri documents both `transparent` and `alwaysOnTop` in configuration, and `setAlwaysOnTop()` in the window API. ([v2.tauri.app](https://v2.tauri.app/reference/config/?utm_source=chatgpt.com))

## Image Formats
Support loading:
- PNG
- JPG / JPEG
- TIFF

## Initial Load Behavior
When a user loads an image:
1. display the image in the transparent overlay window,
2. set the default anchor to the image top-left corner,
3. set the active mode to Transform mode,
4. display at native size if practical,
5. if too large, auto-fit so the window fits within about 80% of the current display,
6. save the immediately-post-load state as `loadedState`,
7. use `loadedState` as the Reset target.

## Modes
### Transform Mode
In Transform mode, clicking and dragging on a visible point of the image starts a transform interaction.

During drag:
- uniform scale is determined by the change in distance from anchor to pointer,
- rotation is determined by the change in angle from anchor to pointer,
- the image updates continuously in real time.

### Select Anchor Mode
In Select Anchor mode, clicking the image sets a new anchor point.

Required behavior:
- default anchor is the image top-left corner,
- after the user selects an anchor, automatically return to Transform mode,
- anchor marker must remain visible at all times.

## Transform Math
At drag start:
- `A` = anchor position,
- `P0` = initial pointer position,
- `V0 = P0 - A`,
- `startScale` = current scale,
- `startRotation` = current rotation.

During drag:
- `P1` = current pointer position,
- `V1 = P1 - A`.

Compute:
- `newScale = startScale * (|V1| / |V0|)`
- `newRotation = startRotation + angle(V1) - angle(V0)`

Rules:
- preserve aspect ratio at all times,
- clamp scale to `0.01x` minimum and `100x` maximum,
- present rotation as clockwise degrees normalized to `0..360`.

## Visual Feedback
Implement all of the following:
- always-visible anchor marker,
- visible grab point while dragging,
- current scale display in toolbar,
- current rotation display in toolbar.

## Window Sizing Rules
### Initial Size
- if the image fits comfortably, window size should match the displayed image size,
- if the image is too large, limit initial window size to about 80% of the current display and downscale image to fit.

### During Transform
- recompute the transformed image bounding box continuously,
- resize the window to follow the transformed image bounds,
- keep resizing behavior visually stable and avoid obvious jitter.

## Toolbar Requirements
Create a **semi-transparent horizontal toolbar**.

Required contents:
- image file selection button,
- Transform mode button,
- Select Anchor mode button,
- Reset button,
- click-through ON/OFF toggle button,
- drag handle for window movement,
- current scale readout,
- current rotation readout.

## Click-Through Behavior
Implement click-through so that:
- when ON, the image display area ignores pointer interaction and events pass through to the underlying application,
- the toolbar remains interactive at all times,
- when OFF, normal image interaction resumes.

Tauri exposes `setIgnoreCursorEvents(true/false)` for cursor event behavior changes at runtime. Use that capability or equivalent platform handling as appropriate. ([tauri.app](https://tauri.app/fr/reference/javascript/api/namespacewebviewwindow/?utm_source=chatgpt.com))

## Reset Behavior
Reset must restore the app state for the current image to the immediately-post-load state.

That includes restoring:
- anchor,
- fitted initial scale,
- rotation,
- mode,
- click-through state,
- opacity if opacity is included in active state.

## State Model
Use a state model equivalent to this:

```json
{
  "imagePath": "...",
  "windowPosition": { "x": 120, "y": 80 },
  "state": {
    "opacity": 1.0,
    "uniformScale": 0.8,
    "rotationDeg": 0,
    "anchor": { "x": 0.0, "y": 0.0 },
    "mode": "transform",
    "clickThrough": false
  },
  "loadedState": {
    "opacity": 1.0,
    "uniformScale": 0.8,
    "rotationDeg": 0,
    "anchor": { "x": 0.0, "y": 0.0 },
    "mode": "transform",
    "clickThrough": false
  }
}
```

Implementation notes:
- store `anchor` in normalized image-local coordinates (`0..1`, `0..1`),
- `windowPosition` refers to overlay window position only,
- do not implement image translation inside the window in v1,
- `loadedState` is the canonical reset target.

## Configuration Guidance
Use a main Tauri config plus platform-specific overrides if needed.

Tauri supports platform-specific config files such as `tauri.windows.conf.json` and `tauri.macos.conf.json`, merged with the main config. Use that to isolate macOS-specific transparent-window behavior from Windows-specific production settings. ([schema.tauri.app](https://schema.tauri.app/config/2?utm_source=chatgpt.com))

## Suggested Technical Structure
### Frontend
- render the image and overlay markers in a single scene layer,
- separate toolbar hit-testing from image-area hit-testing,
- keep transform math in a dedicated module,
- compute transformed bounding box from scale, rotation, anchor, and source dimensions.

### Window Control Layer
- manage transparency, always-on-top, click-through, position, and resize through Tauri window APIs,
- keep platform-specific behavior isolated in a small wrapper.

### Image Loading
- support PNG/JPEG/TIFF decode path,
- preserve image dimensions accurately,
- derive initial fit scale on load.

## Acceptance Criteria
The implementation is acceptable only if all of the following are true:
- launches on Windows and macOS,
- window is transparent,
- window stays always on top,
- PNG/JPG/JPEG/TIFF images can be loaded,
- toolbar is semi-transparent and horizontal,
- toolbar contains all required controls,
- toolbar remains interactive when click-through is ON,
- default anchor is image top-left,
- anchor is always visible,
- Select Anchor mode sets anchor and returns automatically to Transform mode,
- Transform mode supports real-time drag-based transform,
- scaling is uniform only,
- scale is clamped to `0.01x..100x`,
- rotation is shown as clockwise `0..360`,
- grab point is visible during transform,
- toolbar shows current scale and rotation,
- large images auto-fit to about 80% of display,
- window size tracks transformed image bounds,
- Reset returns to immediately-post-load state,
- click-through passes pointer input through the image area to the underlying app.

## Implementation Priorities
Build in this order:
1. transparent always-on-top window + toolbar shell,
2. image loading and rendering,
3. window drag handle,
4. anchor rendering and Select Anchor mode,
5. Transform mode math and real-time interaction,
6. transformed bounding-box window resizing,
7. click-through behavior,
8. reset behavior,
9. polish and edge-case handling.

## Important Edge Cases
Handle these safely:
- pointer starts too close to anchor causing unstable transform,
- very large TIFF files,
- rotation normalization across 0/360 boundary,
- click-through enabled while user still needs toolbar access,
- transformed bounds changing quickly during drag,
- display scaling / high-DPI environments.

## Deliverable Expectation
Produce a working Tauri 2 application with a clean code structure, clear separation between interaction logic and window management, and implementation comments only where necessary.

