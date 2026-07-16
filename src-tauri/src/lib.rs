use std::fs;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

/// Project file paths handed to us by the OS (double-click / "Open With") before the frontend's
/// `"open-file"` listener was ready to receive them — drained once via `get_pending_open_files`.
struct PendingOpens(Mutex<Vec<String>>);

fn is_project_path(arg: &str) -> bool {
  arg.ends_with(".voxpaint")
}

/// Routes newly-opened project paths to a running window (via the `"open-file"` event) if one
/// exists, or buffers them for `get_pending_open_files` to drain once the frontend mounts.
fn handle_opened_paths(app: &tauri::AppHandle, paths: Vec<String>) {
  if paths.is_empty() {
    return;
  }
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.set_focus();
    for path in &paths {
      let _ = app.emit("open-file", path.clone());
    }
  } else {
    let state = app.state::<PendingOpens>();
    state.0.lock().unwrap().extend(paths);
  }
}

/// Reads a `.voxpaint` project file at an absolute path chosen by the user (via the open dialog,
/// or handed to us by the OS on double-click/"Open With"). The frontend does the JSON parsing and
/// schema migration (`migrateToCurrent` in `src/engine/persistence/migrations.ts`) — this command
/// only does the filesystem read, so Rust never needs to know the project schema.
#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
  fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Writes serialized project JSON to an absolute path chosen by the user (via the save dialog, or
/// an already-open file on repeat Save). The frontend serializes; this command only does the
/// filesystem write.
#[tauri::command]
fn write_project_file(path: String, contents: String) -> Result<(), String> {
  fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Drains and returns any project paths the OS delivered before the frontend was ready to listen
/// for the `"open-file"` event (the cold-launch double-click race).
#[tauri::command]
fn get_pending_open_files(state: tauri::State<PendingOpens>) -> Vec<String> {
  std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    // Must be the first plugin registered. On Windows/Linux, double-clicking a `.voxpaint` file
    // while VoxPaint is already running launches a second process; this plugin detects that,
    // forwards the new process's argv to the running instance via the callback below, and exits
    // the new process so we never end up with duplicate windows of this single-window app.
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      let paths: Vec<String> = argv.into_iter().skip(1).filter(|a| is_project_path(a)).collect();
      handle_opened_paths(app, paths);
    }))
    .plugin(tauri_plugin_dialog::init())
    .manage(PendingOpens(Mutex::new(Vec::new())))
    .invoke_handler(tauri::generate_handler![
      read_project_file,
      write_project_file,
      get_pending_open_files
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Windows/Linux: a cold launch via double-click passes the file path as argv[1]. (macOS
      // delivers it via `RunEvent::Opened` below instead, on both cold and warm launches.)
      let cold_paths: Vec<String> = std::env::args().skip(1).filter(|a| is_project_path(a)).collect();
      if !cold_paths.is_empty() {
        app.state::<PendingOpens>().0.lock().unwrap().extend(cold_paths);
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    if let RunEvent::Opened { urls } = event {
      let paths: Vec<String> = urls
        .into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect();
      handle_opened_paths(app_handle, paths);
    }
  });
}
