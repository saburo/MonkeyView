import type { CursorIcon } from '@tauri-apps/api/window'
import type { OverlayMode } from '../types'

export type OverlayCursorState = 'default' | 'transform' | 'dragging' | 'select-anchor'

export function resolveCursorState(options: {
  imageLoaded: boolean
  mode: OverlayMode
  dragging: boolean
}): OverlayCursorState {
  if (!options.imageLoaded) {
    return 'default'
  }

  if (options.mode === 'select-anchor') {
    return 'select-anchor'
  }

  if (options.dragging) {
    return 'dragging'
  }

  return 'transform'
}

export function resolveCursorIcon(cursorState: OverlayCursorState): CursorIcon {
  switch (cursorState) {
    case 'select-anchor':
      return 'crosshair'
    case 'dragging':
      return 'grabbing'
    case 'transform':
      return 'grab'
    default:
      return 'default'
  }
}

export function resolveCssCursor(cursorIcon: CursorIcon): string {
  if (cursorIcon === 'allScroll') {
    return 'all-scroll'
  }

  return cursorIcon
}
