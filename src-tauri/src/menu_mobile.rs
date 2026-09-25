//! Mobile stand-in for the native menu module. There is no menu bar on
//! mobile, but the frontend's command surface stays the same on every
//! platform.

/// No-op: there is no menu checkbox to mirror the preference into.
#[tauri::command]
pub fn set_auto_update_check(_enabled: bool) -> Result<(), String> {
    Ok(())
}
