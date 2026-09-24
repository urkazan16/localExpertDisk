#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use domain::{
    AppError, AppInfo, ErrorCode, ScanIssuePage, ScanSession, StartScanRequest, VolumeInfo,
};
use filesystem::volumes::{LocalVolumes, VolumeProvider};
use services::scans::ScanService;
use tauri::{ipc::Channel, Manager};

struct AppState(Result<ScanService, AppError>);
impl AppState {
    fn service(&self) -> Result<ScanService, AppError> {
        self.0.clone()
    }
}
fn internal() -> AppError {
    AppError::new(ErrorCode::Internal)
}

#[tauri::command]
async fn get_app_info(state: tauri::State<'_, AppState>) -> Result<AppInfo, AppError> {
    let service = state.service()?;
    tauri::async_runtime::spawn_blocking(move || service.app_info())
        .await
        .map_err(|_| internal())?
}
#[tauri::command]
async fn get_volumes() -> Result<Vec<VolumeInfo>, AppError> {
    tauri::async_runtime::spawn_blocking(|| LocalVolumes.volumes())
        .await
        .map_err(|_| internal())
}
#[tauri::command]
async fn start_scan(
    state: tauri::State<'_, AppState>,
    request: StartScanRequest,
    on_progress: Channel<ScanSession>,
) -> Result<ScanSession, AppError> {
    let service = state.service()?;
    tauri::async_runtime::spawn_blocking(move || {
        service.start(request, move |update| on_progress.send(update).is_ok())
    })
    .await
    .map_err(|_| internal())?
}
#[tauri::command]
async fn cancel_scan(
    state: tauri::State<'_, AppState>,
    scan_id: String,
) -> Result<ScanSession, AppError> {
    let service = state.service()?;
    tauri::async_runtime::spawn_blocking(move || service.cancel(&scan_id))
        .await
        .map_err(|_| internal())?
}
#[tauri::command]
async fn get_scan(
    state: tauri::State<'_, AppState>,
    scan_id: Option<String>,
) -> Result<Option<ScanSession>, AppError> {
    let service = state.service()?;
    tauri::async_runtime::spawn_blocking(move || service.get_scan(scan_id.as_deref()))
        .await
        .map_err(|_| internal())?
}
#[tauri::command]
async fn get_scan_issues(
    state: tauri::State<'_, AppState>,
    scan_id: String,
    after_id: Option<String>,
) -> Result<ScanIssuePage, AppError> {
    let service = state.service()?;
    tauri::async_runtime::spawn_blocking(move || service.issues(&scan_id, after_id.as_deref()))
        .await
        .map_err(|_| internal())?
}
fn initialize_storage(app: &tauri::App) -> Result<ScanService, AppError> {
    let unavailable = || AppError::new(ErrorCode::StorageUnavailable);
    let directory = app.path().app_data_dir().map_err(|_| unavailable())?;
    std::fs::create_dir_all(&directory).map_err(|_| unavailable())?;
    ScanService::open(&directory.join("index.db")).map_err(|mut error| {
        error.recoverable = false;
        error
    })
}
fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        get_app_info,
        get_volumes,
        start_scan,
        cancel_scan,
        get_scan,
        get_scan_issues
    ])
}
fn main() {
    tracing_subscriber::fmt().json().with_target(false).init();
    let app = register_commands(tauri::Builder::default())
        .setup(|app| {
            let storage = initialize_storage(app);
            if let Err(error) = &storage {
                tracing::error!(component="desktop",operation="startup",code=?error.code,"Storage initialization failed");
            }
            app.manage(AppState(storage));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Desktop runtime failed");
    app.run(|app,event| {
        if matches!(event,tauri::RunEvent::ExitRequested { .. }) {
            if let Ok(service) = &app.state::<AppState>().0 {
                if let Err(error) = service.shutdown() {
                    tracing::error!(component="desktop",operation="shutdown",code=?error.code,"Scan shutdown failed");
                }
            }
        }
    });
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
        let storage = ScanService::open(&directory.path().join("ipc.db")).unwrap();
        let response = invoke(AppState(Ok(storage))).unwrap();
        assert_eq!(response.schema_version, 2);
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
