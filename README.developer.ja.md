# Monkey View 開発者向け README

Monkey View は、別アプリの表示内容の上に参照画像を半透明で重ね、手動で位置合わせするための Tauri 2 デスクトップアプリです。  
ユーザー向けの説明は [README.md](README.md) を参照してください。

## 概要

- 透明な常時最前面のオーバーレイウィンドウを表示する
- ツールバーとオーバーレイを別ウィンドウで管理する
- 画像上のアンカーを基準に、ドラッグで拡大縮小と回転を行う
- 画像領域だけクリック透過を有効にし、下にあるアプリを操作できる
- PNG / JPEG / TIFF を読み込める

想定用途は、計測ソフトやカメラビューアなど別アプリの表示に対して、参照画像を目視で重ねて合わせる作業です。

## 対象プラットフォーム

- 本番ターゲット: Windows
- 開発・検証ターゲット: macOS

`src-tauri/Cargo.toml` では macOS の透明ウィンドウ対応のために `macos-private-api` を有効にしています。

## 技術スタック

- フロントエンド: Svelte 5 + TypeScript + Vite
- デスクトップシェル: Tauri 2
- ネイティブ側: Rust
- テスト: Vitest、`cargo test`

## セットアップ

前提:

- Node.js と npm
- Rust stable toolchain
- Tauri 2 の各 OS 向け前提ツール

依存関係をインストール:

```bash
npm install
```

## 開発コマンド

フロントエンドだけ起動:

```bash
npm run dev
```

Tauri アプリとして起動:

```bash
npm run tauri:dev
```

フロントエンドをビルド:

```bash
npm run build
```

型チェック:

```bash
npm run check
```

フロントエンドテスト:

```bash
npm test
```

Rust 側テスト:

```bash
cd src-tauri
cargo test
```

配布ビルド:

```bash
npm run tauri:build
```

## 実装の見どころ

### 2 ウィンドウ構成

- `toolbar` ウィンドウ: 常時表示される操作パネル
- `overlay` ウィンドウ: 画像を描画する透明オーバーレイ

この構成により、オーバーレイをクリック透過にしてもツールバーだけは常に操作可能です。

### 画像変形

オーバーレイの変形はアンカー基準です。

- `Transform` モードでは、画像上をドラッグすると拡大縮小と回転を同時に更新する
- `Anchor` モードでは、クリック位置をアンカーに変更する
- `A` キー押下中は一時的にアンカー選択モードへ切り替える
- `Space` キーで 100% 不透明と設定済み不透明度を切り替える

### ウィンドウ制御

- オーバーレイの外接矩形に合わせてウィンドウサイズを更新する
- ツールバーはオーバーレイ上部にドッキングする
- ドラッグハンドルでツールバーとオーバーレイを一緒に移動できる
- クリック透過は `setIgnoreCursorEvents` を使って画像側だけに適用する

## 主要ファイル

- `src/lib/components/ToolbarApp.svelte`: ツールバー UI と操作イベントの送信
- `src/lib/components/OverlayApp.svelte`: オーバーレイ描画、ドラッグ変形、アンカー選択
- `src/lib/math/bounds.ts`: 変形後バウンディング計算と表示範囲制御
- `src/lib/math/transform.ts`: スケール・回転のドラッグ計算
- `src/lib/window/windowControl.ts`: Tauri ウィンドウ位置・サイズ・最前面制御
- `src-tauri/src/image_loading.rs`: PNG / JPEG / TIFF 読み込みと描画用 PNG キャッシュ生成
- `src-tauri/src/window_setup.rs`: 起動時のウィンドウ初期化

## 画像読み込みの流れ

1. ツールバーで画像ファイルを選択する
2. Rust 側の `load_image_asset` が画像を開く
3. 読み込んだ画像をテンポラリ配下の PNG に変換する
4. フロントエンドは `convertFileSrc` を使ってその PNG を描画する
5. 初期表示時にモニターの作業領域へ収まるスケールを計算する

TIFF を含めて描画経路を揃えるため、読み込み後はいったん PNG に変換してから表示しています。

## テスト方針

- `src/lib/math/*.test.ts`: 幾何計算や変形ロジックの単体テスト
- `src/lib/state/overlayState.test.ts`: スナップショットや表示用 readout の検証
- `src/lib/window/cursor.test.ts`: カーソル状態の解決ロジック
- `src-tauri/src/*.rs` 内の `#[cfg(test)]`: 画像読み込みやカーソル正規化のテスト

UI 全体を通した E2E はまだ入っていません。回帰確認は `npm run tauri:dev` で実際に画像を読み込み、アンカー変更、ドラッグ変形、クリック透過、リセットを一通り触るのが確実です。

## 現状の制約

- 単一画像のみ対応
- 手動アラインのみで自動位置合わせは未対応
- 非等方スケーリングは未対応
- 画像変形中の内部平行移動は未対応
- プリセット保存・復元は未対応

## 開発時のメモ

- 実運用の確認は `npm run tauri:dev` を使うのが前提です。`npm run dev` だけでは複数ウィンドウや Tauri API を伴う挙動は再現できません。
- オーバーレイは画像未読込時に非表示です。起動直後はツールバーだけ見えるのが正常です。
- 画像の一時変換ファイルはテンポラリディレクトリ配下の `monkey-view` フォルダに作成されます。
