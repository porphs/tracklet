//! Tracklet's native side. It only moves bytes between the webview and files in the
//! app data folder (ADR 0001). All data logic lives in TypeScript.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

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

/// Absolute path of the data folder, shown in Settings so the user can find their data.
#[tauri::command]
fn data_dir_path(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            db_read,
            db_write,
            backup_create,
            backup_list,
            backup_delete,
            data_dir_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tracklet");
}
