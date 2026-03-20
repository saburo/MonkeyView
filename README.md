# Monkey View

Monkey View is a lightweight desktop overlay app for manually aligning a reference image on top of another application's content.

It is designed for workflows where you need to compare a still image against a live view underneath the overlay, such as lining up a reference image with an instrument or camera feed.

For the developer guide in Japanese, see [README.developer.ja.md](README.developer.ja.md).

## What It Does

- Opens a single overlay image in a transparent always-on-top window
- Keeps a separate toolbar available while you work
- Lets you scale and rotate the overlay around a visible anchor point
- Supports click-through mode so the underlying app can receive mouse input
- Keeps the toolbar interactive even when the overlay itself is click-through
- Resizes the overlay window to match the transformed image bounds

## Supported Image Formats

- PNG
- JPG / JPEG
- TIFF / TIF

## Typical Workflow

1. Launch Monkey View.
2. Click **Open Image** in the toolbar.
3. Pick a reference image.
4. Drag the **Drag** handle to place the toolbar and overlay near your target area.
5. Use **Anchor** to choose the pivot point, then click the image where you want the anchor.
6. Switch back to **Transform** if needed, then drag directly on the overlay image to scale and rotate it.
7. Adjust **Opacity** or turn on **Click-through** while comparing the overlay with the app underneath.

## Controls

| Control | What it does |
| --- | --- |
| `Open Image` | Loads a new overlay image |
| `Reset` | Restores the image state to the initial post-load fit |
| `Transform` | Lets you drag on the image to scale and rotate it |
| `Anchor` | Lets you click once to move the anchor point |
| `Opacity` slider | Sets overlay opacity from 5% to 100% |
| `ON/OFF` next to Opacity | Toggles between full opacity and your preferred reduced opacity |
| `Click-through` | Lets mouse input pass through the image area to the app below |
| `Drag` | Moves the toolbar and overlay together |

## Keyboard Shortcuts

- `A` (hold): temporarily enter anchor selection mode
- `Space`: toggle between 100% opacity and your saved reduced opacity level

## Notes

- The overlay window stays hidden until an image is loaded.
- The anchor marker is always visible so you can see the current pivot point.
- Only uniform scaling is supported in this version.
- Monkey View is for manual alignment only. It does not auto-register images or save presets yet.
- The app works best when the target application is already open and visible before you start aligning.

## Platform Status

- Primary target: Windows
- Secondary development and testing target: macOS

## Build Availability

If you are using a packaged build, open the app and start from **Open Image**.

If you want to run from source, see [README.developer.ja.md](README.developer.ja.md).
