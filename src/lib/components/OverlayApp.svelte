<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { emitTo } from '@tauri-apps/api/event'
  import { getCurrentWindow, type CursorIcon } from '@tauri-apps/api/window'
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
  import {
    clampWindowPositionToRect,
    computeInteractionSurfaceSize,
    constrainTransformedBoundsToWorkArea,
    computeInitialFitScale,
    computeTransformedBounds,
    getAnchorSourcePosition,
    isSourcePointInsideImage,
    mapRenderPointToSource,
    mapSourcePointToRender,
    normalizeSourcePoint,
  } from '../math/bounds'
  import { SCREEN_Y_SCALE, createTransformDragSession, projectTransformDrag } from '../math/transform'
  import { loadImageAsset } from '../image/imageLoader'
  import type { Point, Rect, Size, TransformDragSession, TransformedBounds } from '../types'
  import {
    createSnapshot,
    cloneTransformState,
    createDefaultTransformState,
    createEmptySessionState,
  } from '../state/overlayState'
  import {
    TOOLBAR_ACTION_EVENT,
    OVERLAY_STATE_SNAPSHOT_EVENT,
    type ToolbarAction,
  } from '../state/contracts'
  import {
    DEFAULT_TOOLBAR_SIZE,
    TOOLBAR_WINDOW_LABEL,
    computeDockedToolbarPosition,
    createWindowOnTopPromoter,
    createWindowGeometryScheduler,
    createWindowPositionScheduler,
    getAppWindowByLabel,
    getCurrentMonitorWorkArea,
    getWindowLogicalPosition,
    getWindowLogicalSize,
    setOverlayClickThrough,
  } from '../window/windowControl'
  import {
    resolveCssCursor,
    resolveCursorIcon,
    resolveCursorState,
    type OverlayCursorState,
  } from '../window/cursor'

  const overlayWindow = getCurrentWindow()
  const overlayWebview = getCurrentWebviewWindow()
  const geometryScheduler = createWindowGeometryScheduler(overlayWindow)

  let toolbarPositionScheduler: ReturnType<typeof createWindowPositionScheduler> | null = null
  let toolbarOnTopPromoter: ReturnType<typeof createWindowOnTopPromoter> | null = null
  let toolbarSize: Size = DEFAULT_TOOLBAR_SIZE
  let viewportElement: HTMLDivElement | null = null
  let session = createEmptySessionState()
  let bounds: TransformedBounds | null = null
  let dragSession: TransformDragSession | null = null
  let dragPointerId: number | null = null
  let dragWorkArea: Rect | null = null
  let imageSrc: string | null = null
  let preferredOpacity = 0.6
  let anchorHoldActive = false
  let modeBeforeAnchorHold: 'transform' | 'select-anchor' = 'transform'
  let overlayHovered = false
  let overlayCursor: CursorIcon = 'default'
  let overlayCssCursor = 'default'
  let cursorState: OverlayCursorState = 'default'
  let hoverCursorKeepAliveTimer: number | null = null
  let cursorSyncInFlight = false
  let cursorSyncQueued = false
  let lastAppliedCursor: CursorIcon | null = null

  function basename(path: string | null): string {
    if (!path) {
      return ''
    }

    const segments = path.split(/[/\\]/)
    return segments.at(-1) ?? path
  }

  function isOpacityShortcut(event: KeyboardEvent): boolean {
    return (
      event.code === 'Space' &&
      !event.repeat &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    )
  }

  function isAnchorShortcut(event: KeyboardEvent): boolean {
    return (
      event.code === 'KeyA' &&
      !event.repeat &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    )
  }

  async function emitSnapshot(): Promise<void> {
    await emitTo(TOOLBAR_WINDOW_LABEL, OVERLAY_STATE_SNAPSHOT_EVENT, createSnapshot(session))
  }

  async function applyNativeCursor(icon: CursorIcon): Promise<void> {
    await overlayWindow.setCursorIcon(icon)
    await invoke('apply_native_cursor_fallback', {
      icon,
    })
  }

  function stopHoverCursorKeepAlive(): void {
    if (hoverCursorKeepAliveTimer !== null) {
      window.clearInterval(hoverCursorKeepAliveTimer)
      hoverCursorKeepAliveTimer = null
    }
  }

  function startHoverCursorKeepAlive(): void {
    if (hoverCursorKeepAliveTimer !== null) {
      return
    }

    hoverCursorKeepAliveTimer = window.setInterval(() => {
      if (!overlayHovered || overlayCursor === 'default') {
        return
      }

      void syncOverlayCursor(true)
    }, 40)
  }

  async function syncOverlayCursor(force = false): Promise<void> {
    if (!force && lastAppliedCursor === overlayCursor) {
      return
    }

    if (cursorSyncInFlight) {
      cursorSyncQueued = true
      return
    }

    cursorSyncInFlight = true

    try {
      try {
        await applyNativeCursor(overlayCursor)
        lastAppliedCursor = overlayCursor
      } catch {
        lastAppliedCursor = null
      }
    } finally {
      cursorSyncInFlight = false

      if (cursorSyncQueued) {
        cursorSyncQueued = false
        void syncOverlayCursor()
      }
    }
  }

  async function ensureOverlayFocus(): Promise<void> {
    await overlayWindow.setFocus().catch(() => undefined)
    toolbarOnTopPromoter?.schedule()
  }

  function getViewportPoint(event: PointerEvent): Point | null {
    if (!viewportElement) {
      return null
    }

    const rect = viewportElement.getBoundingClientRect()

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  async function dockToolbar(immediate = false): Promise<void> {
    if (!bounds || !toolbarPositionScheduler) {
      return
    }

    const workArea = await getCurrentMonitorWorkArea(overlayWindow)
    const toolbarPosition = computeDockedToolbarPosition(
      session.windowPosition,
      {
        width: bounds.width,
        height: bounds.height,
      },
      toolbarSize,
      workArea,
    )

    if (immediate) {
      await toolbarPositionScheduler.sync(toolbarPosition)
      await toolbarOnTopPromoter?.sync()
      return
    }

    toolbarPositionScheduler.schedule(toolbarPosition)
    toolbarOnTopPromoter?.schedule()
  }

  async function applyOverlayGeometry(
    nextBounds: TransformedBounds,
    nextWindowPosition: Point,
    options: {
      immediate?: boolean
      dockToolbar?: boolean
      showWindow?: boolean
    } = {},
  ): Promise<void> {
    bounds = nextBounds
    session.windowPosition = nextWindowPosition

    const nextGeometry = {
      position: nextWindowPosition,
      size: {
        width: nextBounds.width,
        height: nextBounds.height,
      },
    }

    if (options.immediate) {
      await geometryScheduler.sync(nextGeometry)
    } else {
      geometryScheduler.schedule(nextGeometry)
    }

    if (options.showWindow) {
      await overlayWindow.show()
    }

    if (options.dockToolbar !== false) {
      await dockToolbar(options.immediate)
    }

    if (options.showWindow || options.dockToolbar === false) {
      toolbarOnTopPromoter?.schedule()
    }

    await emitSnapshot()
  }

  async function loadImage(path: string): Promise<void> {
    session.loadingImage = true
    session.statusMessage = ''
    await emitSnapshot()

    try {
      const asset = await loadImageAsset(path)
      const interactionSurfaceSize = computeInteractionSurfaceSize({
        width: asset.sourceWidth,
        height: asset.sourceHeight,
      })
      const monitorReferenceWindow = (await getAppWindowByLabel(TOOLBAR_WINDOW_LABEL)) ?? overlayWindow
      const workArea = await getCurrentMonitorWorkArea(monitorReferenceWindow)
      const initialScale = computeInitialFitScale(
        interactionSurfaceSize,
        workArea,
        0.8,
        SCREEN_Y_SCALE,
      )
      const nextState = createDefaultTransformState()
      nextState.uniformScale = initialScale

      const nextBounds = computeTransformedBounds(
        interactionSurfaceSize,
        nextState.anchor,
        nextState.uniformScale,
        nextState.rotationDeg,
        SCREEN_Y_SCALE,
      )

      const toolbarWindow = await getAppWindowByLabel(TOOLBAR_WINDOW_LABEL)
      const toolbarPosition = toolbarWindow
        ? await getWindowLogicalPosition(toolbarWindow)
        : {
            x: workArea.x + 32,
            y: workArea.y + 32,
          }
      const initialOverlayPosition = clampWindowPositionToRect(
        {
          x: toolbarPosition.x,
          y: toolbarPosition.y + toolbarSize.height + 12,
        },
        {
          width: nextBounds.width,
          height: nextBounds.height,
        },
        workArea,
      )

      session.imagePath = asset.imagePath
      session.renderAssetPath = asset.renderAssetPath
      // Keep the interaction surface bounded so large images do not force enormous
      // transform-origin and translate values during anchor changes.
      session.sourceSize = interactionSurfaceSize
      session.loadingImage = false
      session.state = nextState
      session.loadedState = cloneTransformState(nextState)
      session.activeGrabPointSource = null
      session.statusMessage = basename(asset.imagePath)
      imageSrc = asset.renderSrc
      dragSession = null
      dragWorkArea = null

      await setOverlayClickThrough(overlayWindow, false)
      await applyOverlayGeometry(nextBounds, initialOverlayPosition, {
        immediate: true,
        dockToolbar: true,
        showWindow: true,
      })
    } catch (error) {
      session.statusMessage =
        error instanceof Error ? error.message : 'Failed to load the selected image.'
      imageSrc = null
      session.imagePath = null
      session.renderAssetPath = null
      session.sourceSize = null
      session.loadingImage = false
      session.loadedState = null
      session.state = createDefaultTransformState()
      session.activeGrabPointSource = null
      dragSession = null
      bounds = null
      await overlayWindow.hide()
      await emitSnapshot()
    }
  }

  async function setMode(mode: 'transform' | 'select-anchor'): Promise<void> {
    if (!session.sourceSize) {
      return
    }

    if (anchorHoldActive) {
      modeBeforeAnchorHold = mode
      if (mode === 'select-anchor') {
        session.state = {
          ...session.state,
          mode,
        }
        await emitSnapshot()
      }
      return
    }

    session.state = {
      ...session.state,
      mode,
    }
    session.statusMessage = ''
    await emitSnapshot()
  }

  async function setAnchorHold(active: boolean): Promise<void> {
    if (!session.sourceSize || anchorHoldActive === active) {
      return
    }

    anchorHoldActive = active

    if (active) {
      modeBeforeAnchorHold = session.state.mode
      session.state = {
        ...session.state,
        mode: 'select-anchor',
      }
      await emitSnapshot()
      return
    }

    session.state = {
      ...session.state,
      mode: modeBeforeAnchorHold,
    }
    await emitSnapshot()
  }

  async function setOpacity(opacity: number): Promise<void> {
    if (!session.sourceSize) {
      return
    }

    const nextOpacity = Math.max(0.05, Math.min(1, opacity))

    if (nextOpacity < 0.995) {
      preferredOpacity = nextOpacity
    }

    session.state = {
      ...session.state,
      opacity: nextOpacity,
    }
    session.statusMessage = ''
    await emitSnapshot()
  }

  async function toggleOpacity(): Promise<void> {
    if (!session.sourceSize) {
      return
    }

    const nextOpacity =
      session.state.opacity < 0.995 ? 1 : Math.max(0.05, Math.min(1, preferredOpacity))

    await setOpacity(nextOpacity)
  }

  async function toggleClickThrough(enabled: boolean): Promise<void> {
    if (!session.sourceSize) {
      return
    }

    session.state = {
      ...session.state,
      clickThrough: enabled,
    }
    session.statusMessage = ''
    await setOverlayClickThrough(overlayWindow, enabled)
    await emitSnapshot()
  }

  async function resetOverlay(): Promise<void> {
    if (!session.sourceSize || !session.loadedState) {
      return
    }

    session.state = cloneTransformState(session.loadedState)
    session.activeGrabPointSource = null
    session.statusMessage = ''
    dragSession = null
    dragWorkArea = null

    const nextBounds = computeTransformedBounds(
      session.sourceSize,
      session.state.anchor,
      session.state.uniformScale,
      session.state.rotationDeg,
      SCREEN_Y_SCALE,
    )

    await setOverlayClickThrough(overlayWindow, session.state.clickThrough)
    await applyOverlayGeometry(nextBounds, session.windowPosition, {
      immediate: true,
      dockToolbar: true,
    })
  }

  async function handleToolbarAction(action: ToolbarAction): Promise<void> {
    switch (action.type) {
      case 'request-snapshot':
        await emitSnapshot()
        return
      case 'load-image':
        await loadImage(action.path)
        return
      case 'set-mode':
        await setMode(action.mode)
        return
      case 'set-anchor-hold':
        await setAnchorHold(action.active)
        return
      case 'set-opacity':
        await setOpacity(action.opacity)
        return
      case 'toggle-click-through':
        await toggleClickThrough(action.enabled)
        return
      case 'reset':
        await resetOverlay()
        return
      case 'group-move':
        if (!session.sourceSize) {
          return
        }

        session.windowPosition = action.windowPosition
        await emitSnapshot()
        return
      default:
        return
    }
  }

  async function selectAnchor(sourcePoint: Point, pointerScreen: Point): Promise<void> {
    if (!session.sourceSize) {
      return
    }

    const nextAnchor = normalizeSourcePoint(sourcePoint, session.sourceSize)
    session.state = {
      ...session.state,
      anchor: nextAnchor,
      mode: anchorHoldActive ? 'select-anchor' : 'transform',
    }
    session.activeGrabPointSource = null
    session.statusMessage = ''

    const tightBounds = computeTransformedBounds(
      session.sourceSize,
      session.state.anchor,
      session.state.uniformScale,
      session.state.rotationDeg,
      SCREEN_Y_SCALE,
    )
    const workArea = await getCurrentMonitorWorkArea(overlayWindow)
    const { bounds: nextBounds, windowPosition: nextWindowPosition } =
      constrainTransformedBoundsToWorkArea(tightBounds, workArea, pointerScreen)

    await applyOverlayGeometry(nextBounds, nextWindowPosition, {
      immediate: true,
      dockToolbar: true,
    })
  }

  function endDrag(pointerId?: number): void {
    if (pointerId !== undefined && dragPointerId !== null && dragPointerId !== pointerId) {
      return
    }

    if (dragPointerId !== null && viewportElement?.hasPointerCapture(dragPointerId)) {
      viewportElement.releasePointerCapture(dragPointerId)
    }

    dragPointerId = null
    dragSession = null
    dragWorkArea = null
    session.activeGrabPointSource = null
    session.statusMessage = ''
    void emitSnapshot()
  }

  async function handlePointerDown(event: PointerEvent): Promise<void> {
    if (!bounds || !session.sourceSize || session.state.clickThrough) {
      return
    }

    void ensureOverlayFocus()

    const viewportPoint = getViewportPoint(event)
    if (!viewportPoint) {
      return
    }

    const sourcePoint = mapRenderPointToSource(
      viewportPoint,
      bounds,
      session.sourceSize,
      session.state.anchor,
      session.state.uniformScale,
      session.state.rotationDeg,
      SCREEN_Y_SCALE,
    )

    if (!isSourcePointInsideImage(sourcePoint, session.sourceSize)) {
      return
    }

    if (session.state.mode === 'select-anchor') {
      event.preventDefault()
      await selectAnchor(sourcePoint, {
        x: event.screenX,
        y: event.screenY,
      })
      return
    }

    dragWorkArea = await getCurrentMonitorWorkArea(overlayWindow).catch(() => null)

    const nextDragSession = createTransformDragSession(
      {
        x: session.windowPosition.x + bounds.anchorRenderPosition.x,
        y: session.windowPosition.y + bounds.anchorRenderPosition.y,
      },
      {
        x: event.screenX,
        y: event.screenY,
      },
      session.state.uniformScale,
      session.state.rotationDeg,
      SCREEN_Y_SCALE,
    )

    if (!nextDragSession) {
      dragWorkArea = null
      session.statusMessage = ''
      void emitSnapshot()
      return
    }

    viewportElement?.setPointerCapture(event.pointerId)
    dragPointerId = event.pointerId
    dragSession = nextDragSession
    session.activeGrabPointSource = sourcePoint
    session.statusMessage = ''
    event.preventDefault()
    void emitSnapshot()
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragSession || !bounds || !session.sourceSize) {
      return
    }

    const nextTransform = projectTransformDrag(
      dragSession,
      {
        x: event.screenX,
        y: event.screenY,
      },
      SCREEN_Y_SCALE,
    )
    session.state = {
      ...session.state,
      uniformScale: nextTransform.uniformScale,
      rotationDeg: nextTransform.rotationDeg,
    }

    const tightBounds = computeTransformedBounds(
      session.sourceSize,
      session.state.anchor,
      session.state.uniformScale,
      session.state.rotationDeg,
      SCREEN_Y_SCALE,
    )
    const constrainedGeometry = dragWorkArea
      ? constrainTransformedBoundsToWorkArea(tightBounds, dragWorkArea, dragSession.anchorScreen)
      : null
    const nextBounds = constrainedGeometry?.bounds ?? tightBounds
    const nextWindowPosition = constrainedGeometry?.windowPosition ?? {
      x: dragSession.anchorScreen.x - nextBounds.anchorRenderPosition.x,
      y: dragSession.anchorScreen.y - nextBounds.anchorRenderPosition.y,
    }

    bounds = nextBounds
    session.windowPosition = nextWindowPosition
    geometryScheduler.schedule({
      position: nextWindowPosition,
      size: {
        width: nextBounds.width,
        height: nextBounds.height,
      },
    })
    void dockToolbar(false)
    void emitSnapshot()
  }

  function handleSurfacePointerEnter(): void {
    overlayHovered = true
    startHoverCursorKeepAlive()
    void syncOverlayCursor(true)
  }

  function handleSurfacePointerLeave(): void {
    overlayHovered = false
    stopHoverCursorKeepAlive()
    void syncOverlayCursor(true)
  }

  onMount(() => {
    const disposers: Array<() => void> = []

    void (async () => {
      const toolbarWindow = await getAppWindowByLabel(TOOLBAR_WINDOW_LABEL)
      if (toolbarWindow) {
        toolbarSize = await getWindowLogicalSize(toolbarWindow).catch(() => DEFAULT_TOOLBAR_SIZE)
        toolbarPositionScheduler = createWindowPositionScheduler(toolbarWindow)
        toolbarOnTopPromoter = createWindowOnTopPromoter(toolbarWindow)
      }

      session.windowPosition = await getWindowLogicalPosition(overlayWindow)

      const unlistenToolbarActions = await overlayWebview.listen<ToolbarAction>(
        TOOLBAR_ACTION_EVENT,
        (event) => {
          void handleToolbarAction(event.payload)
        },
      )
      const unlistenOverlayMoved = await overlayWindow.onMoved(() => {
        toolbarOnTopPromoter?.schedule()
      })
      const unlistenOverlayResized = await overlayWindow.onResized(() => {
        toolbarOnTopPromoter?.schedule()
      })
      const unlistenOverlayFocusChanged = await overlayWindow.onFocusChanged((event) => {
        if (event.payload) {
          toolbarOnTopPromoter?.schedule()
        }
      })

      const handleWindowPointerMove = (event: PointerEvent) => {
        handlePointerMove(event)
      }
      const handleWindowPointerUp = (event: PointerEvent) => {
        endDrag(event.pointerId)
      }
      const handleWindowPointerCancel = (event: PointerEvent) => {
        endDrag(event.pointerId)
      }
      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (!session.sourceSize) {
          return
        }

        if (isOpacityShortcut(event)) {
          event.preventDefault()
          event.stopPropagation()
          void toggleOpacity()
          return
        }

        if (isAnchorShortcut(event)) {
          event.preventDefault()
          event.stopPropagation()
          void setAnchorHold(true)
        }
      }
      const handleWindowKeyUp = (event: KeyboardEvent) => {
        if (!session.sourceSize || event.code !== 'KeyA') {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        void setAnchorHold(false)
      }

      window.addEventListener('pointermove', handleWindowPointerMove)
      window.addEventListener('pointerup', handleWindowPointerUp)
      window.addEventListener('pointercancel', handleWindowPointerCancel)
      window.addEventListener('keydown', handleWindowKeyDown, true)
      window.addEventListener('keyup', handleWindowKeyUp, true)

      disposers.push(unlistenToolbarActions)
      disposers.push(unlistenOverlayMoved)
      disposers.push(unlistenOverlayResized)
      disposers.push(unlistenOverlayFocusChanged)
      disposers.push(() => {
        stopHoverCursorKeepAlive()
        window.removeEventListener('pointermove', handleWindowPointerMove)
        window.removeEventListener('pointerup', handleWindowPointerUp)
        window.removeEventListener('pointercancel', handleWindowPointerCancel)
        window.removeEventListener('keydown', handleWindowKeyDown, true)
        window.removeEventListener('keyup', handleWindowKeyUp, true)
        document.body.style.cursor = 'default'
      })

      await syncOverlayCursor(true)
    })()

    return () => {
      for (const dispose of disposers) {
        dispose()
      }
    }
  })

  $: anchorPosition =
    bounds && session.sourceSize
      ? getAnchorSourcePosition(session.sourceSize, session.state.anchor)
      : null

  $: imageStyle =
    bounds && session.sourceSize && anchorPosition
      ? `width:${session.sourceSize.width}px;height:${session.sourceSize.height}px;opacity:${session.state.opacity};transform-origin:${anchorPosition.x}px ${anchorPosition.y}px;transform:translate(${bounds.offsetX}px, ${bounds.offsetY}px) scaleY(${SCREEN_Y_SCALE}) rotate(${session.state.rotationDeg}deg) scale(${session.state.uniformScale});`
      : ''

  $: anchorMarkerStyle =
    bounds
      ? `left:${bounds.anchorRenderPosition.x}px;top:${bounds.anchorRenderPosition.y}px;`
      : ''

  $: grabPointPosition =
    bounds && session.sourceSize && session.activeGrabPointSource
      ? mapSourcePointToRender(
          session.activeGrabPointSource,
          session.sourceSize,
          session.state.anchor,
          session.state.uniformScale,
          session.state.rotationDeg,
          SCREEN_Y_SCALE,
          bounds,
        )
      : null

  $: cursorState = resolveCursorState({
    imageLoaded: Boolean(imageSrc && bounds && session.sourceSize),
    mode: session.state.mode,
    dragging: dragSession !== null,
  })

  $: overlayModeClass =
    cursorState === 'select-anchor'
      ? 'select-anchor'
      : cursorState === 'dragging'
        ? 'transform-dragging'
        : 'transform'

  $: overlayCursor =
    session.state.clickThrough
      ? 'default'
      : cursorState === 'dragging'
        ? resolveCursorIcon(cursorState)
        : overlayHovered
          ? resolveCursorIcon(cursorState)
          : 'default'

  $: overlayCssCursor = resolveCssCursor(overlayCursor)

  $: {
    if (overlayHovered && overlayCursor !== 'default') {
      startHoverCursorKeepAlive()
    } else {
      stopHoverCursorKeepAlive()
    }
  }

  $: if (typeof document !== 'undefined') {
    document.body.style.cursor = overlayCssCursor
  }

  $: void syncOverlayCursor()
</script>

{#if imageSrc && session.sourceSize && bounds}
  <div
    bind:this={viewportElement}
    class={`overlay-surface ${overlayModeClass}`}
    role="application"
    style={`cursor:${overlayCssCursor};`}
    tabindex="-1"
    on:pointerdown|capture={() => void ensureOverlayFocus()}
    on:pointerdown={handlePointerDown}
    on:pointerenter={handleSurfacePointerEnter}
    on:pointerleave={handleSurfacePointerLeave}
  >
    <img alt="Overlay reference" class="overlay-image" draggable="false" src={imageSrc} style={imageStyle} />
    <div class="anchor-marker" style={anchorMarkerStyle}></div>

    {#if grabPointPosition && dragSession}
      <div
        class="grab-point"
        style={`left:${grabPointPosition.x}px;top:${grabPointPosition.y}px;`}
      ></div>
    {/if}
  </div>
{/if}

<style>
  .overlay-surface {
    position: relative;
    width: 100%;
    height: 100%;
    background: transparent;
    isolation: isolate;
  }

  .overlay-surface.transform {
    cursor: -webkit-grab;
    cursor: grab;
  }

  .overlay-surface.transform-dragging {
    cursor: -webkit-grabbing;
    cursor: grabbing;
  }

  .overlay-surface.select-anchor {
    cursor: crosshair;
  }

  .overlay-image {
    position: absolute;
    inset: 0 auto auto 0;
    cursor: inherit;
    pointer-events: none;
    transform-box: fill-box;
    will-change: transform;
  }

  .anchor-marker,
  .grab-point {
    position: absolute;
    width: 18px;
    height: 18px;
    margin-left: -9px;
    margin-top: -9px;
    border-radius: 999px;
    cursor: inherit;
    pointer-events: none;
  }

  .anchor-marker {
    border: 2px solid rgba(12, 14, 11, 0.92);
    background:
      radial-gradient(circle at center, var(--marker-anchor) 0 28%, rgba(255, 241, 115, 0.16) 29% 100%);
    box-shadow:
      0 0 0 2px rgba(255, 241, 115, 0.28),
      0 0 22px rgba(255, 241, 115, 0.42);
  }

  .anchor-marker::before,
  .anchor-marker::after,
  .grab-point::before,
  .grab-point::after {
    position: absolute;
    content: '';
    background: currentColor;
    border-radius: 999px;
  }

  .anchor-marker::before,
  .grab-point::before {
    inset: 8px 0;
  }

  .anchor-marker::after,
  .grab-point::after {
    inset: 0 8px;
  }

  .anchor-marker::before,
  .anchor-marker::after {
    color: rgba(12, 14, 11, 0.88);
  }

  .grab-point {
    border: 2px solid rgba(12, 14, 11, 0.85);
    background:
      radial-gradient(circle at center, var(--marker-grab) 0 35%, rgba(255, 135, 95, 0.16) 36% 100%);
    box-shadow:
      0 0 0 2px rgba(255, 135, 95, 0.24),
      0 0 28px rgba(255, 135, 95, 0.42);
  }

  .grab-point::before,
  .grab-point::after {
    color: rgba(255, 250, 247, 0.88);
  }
</style>
