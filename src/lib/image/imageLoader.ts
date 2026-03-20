import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { LoadedImageAsset, LoadedRenderableImageAsset } from '../types'

export async function loadImageAsset(path: string): Promise<LoadedRenderableImageAsset> {
  const asset = await invoke<LoadedImageAsset>('load_image_asset', { path })

  return {
    ...asset,
    renderSrc: convertFileSrc(asset.renderAssetPath),
  }
}
