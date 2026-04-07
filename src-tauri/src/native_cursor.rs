use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
use objc2_app_kit::NSCursor;

fn normalize_cursor_name(icon: &str) -> &str {
    match icon {
        "crosshair" => "crosshair",
        "grabbing" => "grabbing",
        "grab" => "grab",
        "hand" => "hand",
        "allScroll" => "allScroll",
        "move" => "move",
        _ => "default",
    }
}

#[cfg(target_os = "macos")]
fn apply_native_cursor(icon: &str) {
    let cursor = match normalize_cursor_name(icon) {
        "crosshair" => NSCursor::crosshairCursor(),
        "grabbing" => NSCursor::closedHandCursor(),
        "grab" => NSCursor::openHandCursor(),
        "hand" => NSCursor::pointingHandCursor(),
        "allScroll" | "move" => return,
        _ => NSCursor::arrowCursor(),
    };

    cursor.set();
}

#[cfg(not(target_os = "macos"))]
fn apply_native_cursor(_icon: &str) {}

#[tauri::command]
pub fn apply_native_cursor_fallback<R: Runtime>(
    app: AppHandle<R>,
    icon: String,
) -> Result<(), String> {
    let normalized_icon = normalize_cursor_name(&icon).to_string();

    app.run_on_main_thread(move || {
        apply_native_cursor(&normalized_icon);
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::normalize_cursor_name;

    #[test]
    fn normalizes_supported_cursor_names() {
        assert_eq!(normalize_cursor_name("hand"), "hand");
        assert_eq!(normalize_cursor_name("grabbing"), "grabbing");
        assert_eq!(normalize_cursor_name("crosshair"), "crosshair");
        assert_eq!(normalize_cursor_name("allScroll"), "allScroll");
        assert_eq!(normalize_cursor_name("move"), "move");
    }

    #[test]
    fn falls_back_to_default_for_unknown_values() {
        assert_eq!(normalize_cursor_name("pointer"), "default");
        assert_eq!(normalize_cursor_name(""), "default");
    }
}
