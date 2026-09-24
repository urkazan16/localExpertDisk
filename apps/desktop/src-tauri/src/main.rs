#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use domain::{AppError, AppInfo, ErrorCode};
use filesystem::LocalPlatform;
use std::sync::Mutex;
use storage::SqliteStorage;
use tauri::Manager;

struct AppState(Result<Mutex<SqliteStorage>, AppError>);

#[tauri::command]
fn get_app_info(state: tauri::State<'_, AppState>) -> Result<AppInfo, AppError> {
    let storage = state.0.as_ref().map_err(Clone::clone)?;
    let storage = storage.lock().map_err(|_| AppError {
        code: ErrorCode::Internal,
        user_message_key: "errors.internal".into(),
        recoverable: false,
    })?;
    services::get_app_info(&*storage, &LocalPlatform)
}

fn initialize_storage(app: &tauri::App) -> Result<Mutex<SqliteStorage>, AppError> {
    let unavailable = || AppError {
        code: ErrorCode::StorageUnavailable,
        user_message_key: "errors.storage_unavailable".into(),
        recoverable: false,
    };
    let directory = app.path().app_data_dir().map_err(|_| unavailable())?;
    std::fs::create_dir_all(&directory).map_err(|_| unavailable())?;
    SqliteStorage::open(&directory.join("index.db"))
        .map(Mutex::new)
        .map_err(|mut error| {
            // Initialization is retried on restart, not by repeating the status query.
            error.recoverable = false;
            error
        })
}

fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![get_app_info])
}

fn main() {
    tracing_subscriber::fmt().json().with_target(false).init();
    register_commands(tauri::Builder::default())
        .setup(|app| {
            let storage = initialize_storage(app);
            if let Err(error) = &storage {
                tracing::error!(component = "desktop", operation = "startup", code = ?error.code, "Storage initialization failed");
            }
            app.manage(AppState(storage));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Desktop runtime failed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};

    fn invoke(state: AppState) -> Result<AppInfo, serde_json::Value> {
        let app = register_commands(mock_builder())
            .manage(state)
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "get_app_info".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map(|response| response.deserialize().unwrap())
    }

    #[test]
    fn ipc_command_returns_real_service_and_database_response() {
        let directory = tempfile::tempdir().unwrap();
        let storage = SqliteStorage::open(&directory.path().join("ipc.db")).unwrap();
        let response = invoke(AppState(Ok(Mutex::new(storage)))).unwrap();
        assert_eq!(response.schema_version, 1);
        assert_eq!(response.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(response.capabilities, Default::default());
    }

    #[test]
    fn startup_failure_rejects_ipc_with_safe_error() {
        let error = AppError {
            code: ErrorCode::UnsupportedSchema,
            user_message_key: "errors.unsupported_schema".into(),
            recoverable: false,
        };
        let response = invoke(AppState(Err(error.clone()))).unwrap_err();
        assert_eq!(response, serde_json::to_value(error).unwrap());
    }
}
