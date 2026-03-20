<script lang="ts">
  import { onMount, tick } from "svelte";
  import { emitTo } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { Point } from "../types";
  import { createEmptySnapshot } from "../state/overlayState";
  import {
    OVERLAY_STATE_SNAPSHOT_EVENT,
    TOOLBAR_ACTION_EVENT,
    type OverlaySnapshotEvent,
    type ToolbarAction,
  } from "../state/contracts";
  import {
    OVERLAY_WINDOW_LABEL,
    createWindowPositionScheduler,
    getAppWindowByLabel,
    getWindowLogicalPosition,
  } from "../window/windowControl";

  const toolbarWindow = getCurrentWindow();
  const toolbarWebview = getCurrentWebviewWindow();

  let dragHandleElement: HTMLButtonElement | null = null;
  let snapshot = createEmptySnapshot();
  let overlayPositionScheduler: ReturnType<
    typeof createWindowPositionScheduler
  > | null = null;
  const toolbarPositionScheduler = createWindowPositionScheduler(toolbarWindow);
  let dragPointerId: number | null = null;
  let preferredOpacityPercent = 60;
  let dragState: {
    pointerOrigin: Point;
    toolbarOrigin: Point;
    overlayOrigin: Point | null;
  } | null = null;

  function isOpacityShortcut(event: KeyboardEvent): boolean {
    return (
      event.code === "Space" &&
      !event.repeat &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    );
  }

  function isAnchorShortcut(event: KeyboardEvent): boolean {
    return (
      event.code === "KeyA" &&
      !event.repeat &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    );
  }

  function basename(path: string | null): string {
    if (!path) {
      return "";
    }

    const segments = path.split(/[/\\]/);
    return segments.at(-1) ?? path;
  }

  function setLocalMode(mode: "transform" | "select-anchor"): void {
    snapshot = {
      ...snapshot,
      state: {
        ...snapshot.state,
        mode,
      },
      statusMessage: "",
    };
  }

  function setLocalOpacity(opacity: number): void {
    snapshot = {
      ...snapshot,
      state: {
        ...snapshot.state,
        opacity,
      },
      statusMessage: "",
    };
  }

  function setLocalClickThrough(enabled: boolean): void {
    snapshot = {
      ...snapshot,
      state: {
        ...snapshot.state,
        clickThrough: enabled,
      },
      statusMessage: "",
    };
  }

  async function emitAction(action: ToolbarAction): Promise<void> {
    await emitTo(OVERLAY_WINDOW_LABEL, TOOLBAR_ACTION_EVENT, action);
  }

  async function ensureToolbarFocus(): Promise<void> {
    await toolbarWindow.setFocus().catch(() => undefined);
  }

  async function chooseImage(): Promise<void> {
    await ensureToolbarFocus();

    const selection = await open({
      multiple: false,
      filters: [
        {
          name: "Overlay image",
          extensions: ["png", "jpg", "jpeg", "tif", "tiff"],
        },
      ],
    });

    if (typeof selection === "string") {
      snapshot = {
        ...snapshot,
        loadingImage: true,
        statusMessage: "",
      };

      await tick();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      await emitAction({
        type: "load-image",
        path: selection,
      });
    }
  }

  async function handleDragPointerDown(event: PointerEvent): Promise<void> {
    await ensureToolbarFocus();

    dragHandleElement?.setPointerCapture(event.pointerId);
    dragPointerId = event.pointerId;

    const overlayWindow = await getAppWindowByLabel(OVERLAY_WINDOW_LABEL);
    overlayPositionScheduler = overlayWindow
      ? createWindowPositionScheduler(overlayWindow)
      : overlayPositionScheduler;

    dragState = {
      pointerOrigin: {
        x: event.screenX,
        y: event.screenY,
      },
      toolbarOrigin: await getWindowLogicalPosition(toolbarWindow),
      overlayOrigin: snapshot.imageLoaded ? snapshot.windowPosition : null,
    };
  }

  async function handleWindowPointerMove(event: PointerEvent): Promise<void> {
    if (!dragState || dragPointerId !== event.pointerId) {
      return;
    }

    const delta = {
      x: event.screenX - dragState.pointerOrigin.x,
      y: event.screenY - dragState.pointerOrigin.y,
    };
    const nextToolbarPosition = {
      x: dragState.toolbarOrigin.x + delta.x,
      y: dragState.toolbarOrigin.y + delta.y,
    };

    toolbarPositionScheduler.schedule(nextToolbarPosition);

    if (dragState.overlayOrigin && overlayPositionScheduler) {
      const nextOverlayPosition = {
        x: dragState.overlayOrigin.x + delta.x,
        y: dragState.overlayOrigin.y + delta.y,
      };

      snapshot = {
        ...snapshot,
        windowPosition: nextOverlayPosition,
      };
      overlayPositionScheduler.schedule(nextOverlayPosition);
      await emitAction({
        type: "group-move",
        windowPosition: nextOverlayPosition,
      });
    }
  }

  function endWindowDrag(pointerId?: number): void {
    if (
      pointerId !== undefined &&
      dragPointerId !== null &&
      pointerId !== dragPointerId
    ) {
      return;
    }

    if (
      dragPointerId !== null &&
      dragHandleElement?.hasPointerCapture(dragPointerId)
    ) {
      dragHandleElement.releasePointerCapture(dragPointerId);
    }

    dragPointerId = null;
    dragState = null;
  }

  function setMode(mode: "transform" | "select-anchor"): void {
    if (!snapshot.imageLoaded) {
      return;
    }

    setLocalMode(mode);
    void emitAction({
      type: "set-mode",
      mode,
    });
  }

  function setOpacity(opacityPercent: number): void {
    if (!snapshot.imageLoaded) {
      return;
    }

    preferredOpacityPercent = opacityPercent;
    const opacity = Math.max(0.05, Math.min(1, opacityPercent / 100));
    setLocalOpacity(opacity);
    void emitAction({
      type: "set-opacity",
      opacity,
    });
  }

  function toggleOpacity(): void {
    if (!snapshot.imageLoaded) {
      return;
    }

    const currentlyOn = snapshot.state.opacity < 0.995;
    const nextOpacity = currentlyOn
      ? 1
      : Math.max(0.05, Math.min(1, preferredOpacityPercent / 100));

    setLocalOpacity(nextOpacity);
    void emitAction({
      type: "set-opacity",
      opacity: nextOpacity,
    });
  }

  function toggleClickThrough(): void {
    if (!snapshot.imageLoaded) {
      return;
    }

    const enabled = !snapshot.state.clickThrough;
    setLocalClickThrough(enabled);
    void emitAction({
      type: "toggle-click-through",
      enabled,
    });
  }

  function resetImage(): void {
    if (!snapshot.imageLoaded) {
      return;
    }

    snapshot = {
      ...snapshot,
      statusMessage: "",
    };

    void emitAction({
      type: "reset",
    });
  }

  onMount(() => {
    const disposers: Array<() => void> = [];

    void (async () => {
      const overlayWindow = await getAppWindowByLabel(OVERLAY_WINDOW_LABEL);
      if (overlayWindow) {
        overlayPositionScheduler = createWindowPositionScheduler(overlayWindow);
      }

      const unlistenSnapshot =
        await toolbarWebview.listen<OverlaySnapshotEvent>(
          OVERLAY_STATE_SNAPSHOT_EVENT,
          (event) => {
            snapshot = event.payload;
          },
        );

      const handlePointerMove = (event: PointerEvent) => {
        void handleWindowPointerMove(event);
      };
      const handlePointerUp = (event: PointerEvent) => {
        endWindowDrag(event.pointerId);
      };
      const handlePointerCancel = (event: PointerEvent) => {
        endWindowDrag(event.pointerId);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!snapshot.imageLoaded) {
          return;
        }

        if (isOpacityShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          toggleOpacity();
          return;
        }

        if (isAnchorShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          void emitAction({
            type: "set-anchor-hold",
            active: true,
          });
        }
      };
      const handleKeyUp = (event: KeyboardEvent) => {
        if (!snapshot.imageLoaded || event.code !== "KeyA") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void emitAction({
          type: "set-anchor-hold",
          active: false,
        });
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("keyup", handleKeyUp, true);

      disposers.push(unlistenSnapshot);
      disposers.push(() => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("keyup", handleKeyUp, true);
      });

      await emitAction({
        type: "request-snapshot",
      });
    })();

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  });

  $: if (snapshot.state.opacity < 0.995) {
    preferredOpacityPercent = Math.round(snapshot.state.opacity * 100);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="toolbar-shell"
  on:pointerdown|capture={() => void ensureToolbarFocus()}
>
  <div class="toolbar">
    <div class="toolbar-group">
      <span class="group-label">File</span>
      <div class="group-controls">
        <button
          class="primary"
          type="button"
          on:click={() => void chooseImage()}
        >
          Open Image
        </button>
        <button
          class="reset"
          disabled={!snapshot.imageLoaded}
          type="button"
          on:click={resetImage}
        >
          Reset
        </button>
      </div>
    </div>

    <div class="toolbar-group">
      <span class="group-label">Mode</span>
      <div class="group-controls">
        <button
          class:active={snapshot.state.mode === "transform"}
          disabled={!snapshot.imageLoaded}
          type="button"
          on:click={() => setMode("transform")}
        >
          Transform
        </button>
        <button
          class:active={snapshot.state.mode === "select-anchor"}
          disabled={!snapshot.imageLoaded}
          type="button"
          on:click={() => setMode("select-anchor")}
        >
          Anchor
        </button>
      </div>
    </div>

    <div class="toolbar-group overlay-group">
      <span class="group-label">Overlay</span>
      <div class="group-controls overlay-controls">
        <div class="opacity-control">
          <span class="opacity-label">Opacity:</span>
          <input
            disabled={!snapshot.imageLoaded}
            max="100"
            min="5"
            step="5"
            type="range"
            value={Math.round(snapshot.state.opacity * 100)}
            on:input={(event) =>
              setOpacity(
                Number((event.currentTarget as HTMLInputElement).value),
              )}
          />
          <strong class="opacity-value"
            >{Math.round(snapshot.state.opacity * 100)}%</strong
          >
          <button
            class:active={snapshot.state.opacity < 0.995}
            class="opacity-toggle"
            disabled={!snapshot.imageLoaded}
            type="button"
            on:click={toggleOpacity}
          >
            {snapshot.state.opacity < 0.995 ? "ON" : "OFF"}
          </button>
        </div>
        <button
          class:active={snapshot.state.clickThrough}
          disabled={!snapshot.imageLoaded}
          type="button"
          on:click={toggleClickThrough}
        >
          Click-through
        </button>
      </div>
    </div>

    <div class="toolbar-group">
      <span class="group-label">Move</span>
      <div class="group-controls">
        <button
          bind:this={dragHandleElement}
          class="drag-handle"
          type="button"
          on:pointerdown|preventDefault={(event) =>
            void handleDragPointerDown(event)}
        >
          <span class="grip" aria-hidden="true">||||</span>
          <span>Drag</span>
        </button>
      </div>
    </div>
  </div>

  <div class="status-row">
    {#if snapshot.loadingImage}
      <span class="file-loading" aria-live="polite">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>Loading...</span>
      </span>
    {:else}
      <span class="file-name">{basename(snapshot.imagePath)}</span>
    {/if}
    <span class="readout-text" aria-live="polite">
      {#if snapshot.imageLoaded}
        {snapshot.readouts.scaleText} / {snapshot.readouts.rotationText}
      {/if}
    </span>
  </div>
</div>

<style>
  .toolbar-shell {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    width: 100%;
    height: 100%;
    font-size: 0.82rem;
    padding: 0.6rem 0.7rem 0.7rem;
    background: linear-gradient(
        130deg,
        rgba(212, 214, 125, 0.18),
        transparent 38%
      ),
      radial-gradient(
        circle at top right,
        rgba(242, 162, 90, 0.22),
        transparent 45%
      ),
      var(--toolbar-bg);
    border: 1px solid var(--toolbar-border);
    border-radius: 18px;
    color: var(--toolbar-text);
    backdrop-filter: blur(18px);
    box-shadow:
      0 18px 44px rgba(0, 0, 0, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }

  .toolbar {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }

  .toolbar-group {
    display: flex;
    flex-direction: column;
    gap: 0.26rem;
    padding: 0.4rem 0.48rem 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.045);
  }

  .group-label {
    color: var(--toolbar-muted);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .group-controls {
    display: flex;
    gap: 0.38rem;
    align-items: center;
  }

  .overlay-group {
    flex: 0 0 auto;
  }

  .overlay-controls {
    display: grid;
    grid-template-columns: max-content max-content;
    gap: 0.38rem;
    align-items: center;
  }

  button,
  .opacity-control {
    min-height: 1.92rem;
    padding: 0 0.72rem;
    border: 1px solid var(--toolbar-button-border);
    border-radius: 999px;
    background: var(--toolbar-button);
    color: var(--toolbar-text);
    font-size: 0.76rem;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      opacity 120ms ease;
  }

  button {
    cursor: pointer;
    white-space: nowrap;
  }

  button:hover:enabled,
  button.active:enabled {
    background: var(--toolbar-button-active);
    border-color: rgba(212, 214, 125, 0.36);
  }

  button.primary {
    background: linear-gradient(
      135deg,
      rgba(212, 214, 125, 0.28),
      rgba(242, 162, 90, 0.25)
    );
  }

  button.reset:hover:enabled {
    background: var(--toolbar-danger);
  }

  button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .drag-handle {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    padding-inline: 0.8rem 0.92rem;
  }

  .grip {
    letter-spacing: 0.08rem;
    color: var(--toolbar-accent);
  }

  .opacity-control {
    display: grid;
    grid-template-columns: auto 4.2rem max-content max-content;
    gap: 0.3rem;
    align-items: center;
    min-width: 0;
    padding-inline: 0.64rem 0.22rem;
  }

  .opacity-label {
    color: var(--toolbar-muted);
    font-size: 0.7rem;
  }

  input[type="range"] {
    width: 4.2rem;
    accent-color: var(--toolbar-accent);
  }

  .opacity-value {
    min-width: 2.15rem;
    text-align: right;
    font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
    font-size: 0.74rem;
    font-weight: 700;
  }

  .opacity-toggle {
    min-height: 1.45rem;
    width: 2.8rem;
    padding-inline: 0;
    text-align: center;
    font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
    font-size: 0.72rem;
    border-color: transparent;
    background: transparent;
  }

  .opacity-toggle:hover:enabled,
  .opacity-toggle.active:enabled {
    background: rgba(255, 255, 255, 0.08);
    border-color: transparent;
  }

  .status-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    gap: 0.85rem;
    align-items: center;
    padding: 0 0.15rem 6px;
    min-height: 1.1rem;
    color: var(--toolbar-muted);
    font-size: 0.7rem;
  }

  .file-name,
  .file-loading,
  .readout-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-name {
    color: var(--toolbar-accent);
  }

  .file-loading {
    display: inline-flex;
    gap: 0.38rem;
    align-items: center;
    color: var(--toolbar-accent);
  }

  .loading-spinner {
    width: 0.72rem;
    height: 0.72rem;
    border: 1.5px solid rgba(212, 214, 125, 0.2);
    border-top-color: var(--toolbar-accent);
    border-radius: 999px;
    animation: toolbar-spin 700ms linear infinite;
  }

  .readout-text {
    text-align: right;
    font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
    font-size: 0.68rem;
  }

  @keyframes toolbar-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
