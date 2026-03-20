use tauri::{AppHandle, Manager, Runtime};

pub const TOOLBAR_WINDOW_LABEL: &str = "toolbar";
pub const OVERLAY_WINDOW_LABEL: &str = "overlay";

pub fn configure_windows<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(toolbar_window) = app.get_webview_window(TOOLBAR_WINDOW_LABEL) {
        let _ = toolbar_window.set_always_on_top(true);
        let _ = toolbar_window.set_shadow(false);
    }

    if let Some(overlay_window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let _ = overlay_window.set_always_on_top(true);
        let _ = overlay_window.set_shadow(false);
        let _ = overlay_window.hide();
        let _ = overlay_window.set_ignore_cursor_events(false);
    }

    Ok(())
}
