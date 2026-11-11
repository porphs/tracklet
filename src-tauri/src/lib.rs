//! Tracklet's native side. It moves bytes between the webview and files in the app data
//! folder (ADR 0001), and owns the menu bar icon and its "Today" popover. All data logic
//! lives in TypeScript.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Rect, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const DB_FILE: &str = "tracklet.db";
const BACKUP_DIR: &str = "backups";

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join(BACKUP_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Backup names come from the frontend; allow only plain file names.
fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && name.ends_with(".db")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..");
    if ok { Ok(name) } else { Err(format!("invalid backup name: {name}")) }
}

/// Writes via a temp file + rename so a crash never leaves a half-written file.
fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("db.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Returns the database file's bytes, or an empty body if there is no file yet.
#[tauri::command]
fn db_read(app: AppHandle) -> Result<Response, String> {
    let path = data_dir(&app)?.join(DB_FILE);
    let bytes = if path.exists() { fs::read(&path).map_err(|e| e.to_string())? } else { Vec::new() };
    Ok(Response::new(bytes))
}

/// Replaces the database file with the raw request body.
#[tauri::command]
fn db_write(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    if bytes.is_empty() {
        return Err("refusing to write an empty database".into());
    }
    atomic_write(&data_dir(&app)?.join(DB_FILE), bytes)
}

/// Copies the current database file into backups/<name>. No-op if there is no database yet.
#[tauri::command]
fn backup_create(app: AppHandle, name: String) -> Result<bool, String> {
    let src = data_dir(&app)?.join(DB_FILE);
    if !src.exists() {
        return Ok(false);
    }
    let dest = backup_dir(&app)?.join(safe_name(&name)?);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Lists backup file names (unsorted; the frontend decides order and pruning).
#[tauri::command]
fn backup_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in fs::read_dir(backup_dir(&app)?).map_err(|e| e.to_string())? {
        let name = entry.map_err(|e| e.to_string())?.file_name().to_string_lossy().to_string();
        if name.ends_with(".db") {
            names.push(name);
        }
    }
    Ok(names)
}

#[tauri::command]
fn backup_delete(app: AppHandle, name: String) -> Result<(), String> {
    let path = backup_dir(&app)?.join(safe_name(&name)?);
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Writes an export file into the user's Downloads folder and returns its full path.
#[tauri::command]
fn export_write(app: AppHandle, name: String, contents: String) -> Result<String, String> {
    let ok = name.starts_with("tracklet-export-")
        && name.ends_with(".json")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && !name.contains("..");
    if !ok {
        return Err(format!("invalid export name: {name}"));
    }
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    let tmp = dir.join(format!("{name}.tmp"));
    fs::write(&tmp, contents.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Shows a file in Finder (macOS `open -R`). Only for paths inside Downloads or the data folder.
#[tauri::command]
fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("not allowed".into());
    }
    let allowed = [app.path().download_dir().ok(), app.path().app_data_dir().ok()];
    if !allowed.iter().flatten().any(|dir| p.starts_with(dir)) {
        return Err("not allowed".into());
    }
    std::process::Command::new("open").arg("-R").arg(&p).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Absolute path of the data folder, shown in Settings so the user can find their data.
#[tauri::command]
fn data_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

// ---------- menu bar icon and the "Today" popover ----------

const MAIN: &str = "main";
const TODAY: &str = "today";
const TODAY_WIDTH: f64 = 340.0;
const TODAY_HEIGHT: f64 = 460.0;

/// When the popover last hid because it lost focus. Clicking the menu bar icon while the
/// popover is open first blurs it; without this the same click would open it again.
#[derive(Default)]
struct TodayState {
    hidden_at: Mutex<Option<Instant>>,
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn hide_today_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(TODAY) {
        let _ = w.hide();
    }
}

/// Shows the popover just below the menu bar icon, kept on the icon's screen.
fn toggle_today(app: &AppHandle, icon: Rect) {
    let Some(win) = app.get_webview_window(TODAY) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    let just_hidden = app
        .state::<TodayState>()
        .hidden_at
        .lock()
        .ok()
        .and_then(|t| *t)
        .is_some_and(|t| t.elapsed() < Duration::from_millis(300));
    if just_hidden {
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos = icon.position.to_physical::<f64>(scale);
    let size = icon.size.to_physical::<f64>(scale);
    let width = TODAY_WIDTH * scale;
    let mut x = pos.x + size.width / 2.0 - width / 2.0;
    let y = pos.y + size.height + 4.0 * scale;
    if let Ok(Some(m)) = win.monitor_from_point(pos.x, pos.y) {
        let area = m.work_area();
        let left = area.position.x as f64 + 8.0 * scale;
        let right = (area.position.x + area.size.width as i32) as f64 - 8.0 * scale;
        x = x.min(right - width).max(left);
    }
    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    let _ = win.show();
    let _ = win.set_focus();
}

/// Popover → main window: shows the main window and opens that task there.
#[tauri::command]
fn open_task(app: AppHandle, id: String) -> Result<(), String> {
    hide_today_window(&app);
    show_main(&app);
    app.emit_to(MAIN, "open-task", id).map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_today(app: AppHandle) {
    hide_today_window(&app);
}

fn setup_today(app: &AppHandle) -> tauri::Result<()> {
    let popover = WebviewWindowBuilder::new(app, TODAY, WebviewUrl::App("index.html".into()))
        .title("Tracklet: Today")
        .inner_size(TODAY_WIDTH, TODAY_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build()?;
    let handle = app.clone();
    popover.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if let Ok(mut t) = handle.state::<TodayState>().hidden_at.lock() {
                *t = Some(Instant::now());
            }
            hide_today_window(&handle);
        }
    });

    let open = MenuItemBuilder::with_id("open", "Open Tracklet").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Tracklet").build(app)?;
    let menu = MenuBuilder::new(app).item(&open).separator().item(&quit).build()?;
    TrayIconBuilder::with_id("tracklet")
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .tooltip("Tracklet: today's tasks")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                toggle_today(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TodayState::default())
        .setup(|app| {
            setup_today(app.handle())?;
            Ok(())
        })
        // Closing the main window hides it, so the menu bar icon keeps working; ⌘Q quits.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_task,
            hide_today,
            db_read,
            db_write,
            backup_create,
            backup_list,
            backup_delete,
            data_dir_path,
            export_write,
            reveal_path
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tracklet")
        .run(|app, event| {
            // Clicking the Dock icon brings a hidden main window back.
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
        });
}
