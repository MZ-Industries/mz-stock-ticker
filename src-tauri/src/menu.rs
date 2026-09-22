//! Native application menu.
//!
//! Update checking itself lives in the frontend, which owns the progress and
//! restart UI, so the items added here only forward the user's intent over
//! events. The "check automatically" preference is stored with the rest of the
//! frontend prefs; [`set_auto_update_check`] mirrors it into the checkbox once
//! that store has loaded.

use std::sync::Mutex;
#[cfg(not(target_os = "macos"))]
use tauri::menu::HELP_SUBMENU_ID;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

/// Emitted when "Check for Updates…" is picked.
pub(crate) const CHECK_FOR_UPDATES_EVENT: &str = "menu:check-for-updates";
/// Emitted with the new checkbox state when automatic checking is toggled.
pub(crate) const AUTO_UPDATE_CHECK_EVENT: &str = "menu:auto-update-check";
/// Emitted when "Settings…" is picked.
pub(crate) const OPEN_PREFERENCES_EVENT: &str = "menu:open-preferences";

const CHECK_NOW_ITEM: &str = "updates-check-now";
const AUTO_CHECK_ITEM: &str = "updates-auto-check";
const PREFERENCES_ITEM: &str = "open-preferences";

/// Handle to the auto-check checkbox, kept so the frontend can mirror the
/// stored preference into it at startup.
pub struct MenuState {
    auto_check: Mutex<Option<CheckMenuItem<Wry>>>,
}

/// Tauri's standard menu with the update and settings items folded in. macOS
/// keeps them in the application menu under About; elsewhere the update items
/// go at the top of Help and Settings at the bottom of Edit, as those platforms
/// expect.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let check_now = MenuItem::with_id(
        app,
        CHECK_NOW_ITEM,
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let auto_check = CheckMenuItem::with_id(
        app,
        AUTO_CHECK_ITEM,
        "Check for Updates Automatically",
        true,
        true,
        None::<&str>,
    )?;
    let preferences = MenuItem::with_id(
        app,
        PREFERENCES_ITEM,
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::default(app)?;

    #[cfg(target_os = "macos")]
    {
        // The application menu is the first submenu, and About its first item.
        let items = menu.items()?;
        if let Some(app_menu) = items.first().and_then(|item| item.as_submenu()) {
            app_menu.insert_items(
                &[
                    &separator,
                    &check_now,
                    &auto_check,
                    &PredefinedMenuItem::separator(app)?,
                    &preferences,
                ],
                1,
            )?;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let help_menu = menu.get(HELP_SUBMENU_ID);
        if let Some(help_menu) = help_menu.as_ref().and_then(|item| item.as_submenu()) {
            help_menu.insert_items(&[&check_now, &auto_check, &separator], 0)?;
        }

        if let Some(edit_menu) = submenu_named(&menu, "Edit")? {
            edit_menu.append_items(&[&PredefinedMenuItem::separator(app)?, &preferences])?;
        }
    }

    app.manage(MenuState {
        auto_check: Mutex::new(Some(auto_check)),
    });

    Ok(menu)
}

/// Locates a submenu by its visible name, since only Window and Help carry a
/// well-known id.
#[cfg(not(target_os = "macos"))]
fn submenu_named(menu: &Menu<Wry>, name: &str) -> tauri::Result<Option<tauri::menu::Submenu<Wry>>> {
    for item in menu.items()? {
        if let Some(submenu) = item.as_submenu() {
            if submenu.text()? == name {
                return Ok(Some(submenu.clone()));
            }
        }
    }

    Ok(None)
}

pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        PREFERENCES_ITEM => {
            let _ = app.emit(OPEN_PREFERENCES_EVENT, ());
        }
        CHECK_NOW_ITEM => {
            let _ = app.emit(CHECK_FOR_UPDATES_EVENT, ());
        }
        AUTO_CHECK_ITEM => {
            // The checkbox flips itself on click, so report what it now shows
            // rather than tracking that state a second time over here.
            if let Some(enabled) = auto_check_state(app) {
                let _ = app.emit(AUTO_UPDATE_CHECK_EVENT, enabled);
            }
        }
        _ => {}
    }
}

fn auto_check_state(app: &AppHandle) -> Option<bool> {
    let state = app.try_state::<MenuState>()?;
    let item = state.auto_check.lock().ok()?;
    item.as_ref()?.is_checked().ok()
}

/// Mirrors the stored preference into the menu checkbox.
#[tauri::command]
pub fn set_auto_update_check(state: State<'_, MenuState>, enabled: bool) -> Result<(), String> {
    let item = state.auto_check.lock().map_err(|err| err.to_string())?;
    if let Some(item) = item.as_ref() {
        item.set_checked(enabled).map_err(|err| err.to_string())?;
    }

    Ok(())
}
