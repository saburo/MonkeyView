#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod image_loading;
mod native_cursor;
mod window_setup;

use image_loading::load_image_asset;
use native_cursor::apply_native_cursor_fallback;
use window_setup::configure_windows;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            configure_windows(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_image_asset,
            apply_native_cursor_fallback
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Monkey View");
}
