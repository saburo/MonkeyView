import type { OverlayMode, OverlaySnapshot, Point } from '../types'

export const TOOLBAR_ACTION_EVENT = 'toolbar:action'
export const OVERLAY_STATE_SNAPSHOT_EVENT = 'overlay:state-snapshot'

export type ToolbarAction =
  | { type: 'request-snapshot' }
  | { type: 'load-image'; path: string }
  | { type: 'set-mode'; mode: OverlayMode }
  | { type: 'set-anchor-hold'; active: boolean }
  | { type: 'set-opacity'; opacity: number }
  | { type: 'toggle-click-through'; enabled: boolean }
  | { type: 'reset' }
  | { type: 'group-move'; windowPosition: Point }

export type OverlaySnapshotEvent = OverlaySnapshot
