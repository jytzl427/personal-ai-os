#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::time::Instant;
use tauri::{Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::mem::{size_of, zeroed};
#[cfg(windows)]
use std::ptr::{null, null_mut};

mod embedded_resources;

struct ServerProcess(Arc<Mutex<Option<ManagedChild>>>);

#[cfg(windows)]
type WinHandle = *mut c_void;

#[cfg(windows)]
#[repr(C)]
struct IoCounters {
    read_operations: u64,
    write_operations: u64,
    other_operations: u64,
    read_bytes: u64,
    write_bytes: u64,
    other_bytes: u64,
}

#[cfg(windows)]
#[repr(C)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[cfg(windows)]
#[repr(C)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> WinHandle;
    fn SetInformationJobObject(job: WinHandle, class: u32, info: *mut c_void, length: u32) -> i32;
    fn AssignProcessToJobObject(job: WinHandle, process: WinHandle) -> i32;
    fn CloseHandle(handle: WinHandle) -> i32;
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(hwnd: WinHandle, text: *const u16, caption: *const u16, message_type: u32) -> i32;
}

#[cfg(windows)]
struct ProcessJob(WinHandle);

// Windows kernel handles can be closed from a different thread than the one
// that created them. This handle is only moved behind the Tauri Mutex and is
// never accessed concurrently, so it is safe to mark the owner as movable.
#[cfg(windows)]
unsafe impl Send for ProcessJob {}
#[cfg(windows)]
unsafe impl Sync for ProcessJob {}

#[cfg(windows)]
impl ProcessJob {
    fn attach(child: &Child) -> Result<Self, String> {
        const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
        const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
        let job = unsafe { CreateJobObjectW(null_mut(), null()) };
        if job.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut limits: JobObjectExtendedLimitInformation = unsafe { zeroed() };
        limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                (&mut limits as *mut JobObjectExtendedLimitInformation).cast(),
                size_of::<JobObjectExtendedLimitInformation>() as u32,
            ) != 0
        };
        if !configured {
            unsafe { CloseHandle(job); }
            return Err(std::io::Error::last_os_error().to_string());
        }
        let assigned = unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as WinHandle) != 0 };
        if !assigned {
            unsafe { CloseHandle(job); }
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(Self(job))
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0); }
    }
}

struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    _job: ProcessJob,
}

impl ManagedChild {
    fn attach(mut child: Child) -> Result<Self, String> {
        #[cfg(windows)]
        let job = match ProcessJob::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("无法保护本地服务子进程生命周期: {error}"));
            }
        };
        Ok(Self {
            child,
            #[cfg(windows)]
            _job: job,
        })
    }

    fn kill(&mut self) -> std::io::Result<()> {
        self.child.kill()
    }

    fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait()
    }

    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }
}

fn wait_for_server_start(child: &mut ManagedChild) -> Result<(), String> {
    // A lock conflict or an integrity error normally exits immediately. Give
    // a healthy server a short head start so the desktop shell never opens
    // against an older process that still owns the fixed local port.
    for _ in 0..20 {
        match child.try_wait() {
            Ok(Some(status)) => return Err(format!("本地服务启动失败，退出码: {:?}", status.code())),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(error) => return Err(format!("无法确认本地服务状态: {error}")),
        }
    }
    Ok(())
}

fn monitor_server(process: Arc<Mutex<Option<ManagedChild>>>, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let outcome = match process.lock() {
            Ok(mut guard) => {
                let Some(child) = guard.as_mut() else { return; };
                match child.try_wait() {
                    Ok(Some(status)) => {
                        guard.take();
                        Some(format!("本地服务已退出，退出码: {:?}", status.code()))
                    }
                    Ok(None) => None,
                    Err(error) => Some(format!("无法监视本地服务: {error}")),
                }
            }
            Err(_) => Some("本地服务状态锁已损坏".to_string()),
        };
        if let Some(message) = outcome {
            log_startup(&message);
            app.exit(1);
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    });
}

fn normal_windows_path(path: std::path::PathBuf) -> std::path::PathBuf {
    let value = path.to_string_lossy();
    if let Some(stripped) = value.strip_prefix(r"\\?\") {
        return std::path::PathBuf::from(stripped);
    }
    path
}

fn ensure_embedded_resources(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    ensure_embedded_resources_at(&home_dir)
}

const RUNTIME_VERSION_FILE: &str = "runtime-version.txt";
const RUNTIME_INTEGRITY_FILE: &str = ".integrity-check";
const RUNTIME_LOCK_FILE: &str = ".runtime-update.lock";
const RUNTIME_FULL_CHECK_INTERVAL_SECS: u64 = 7 * 24 * 60 * 60;
const RUNTIME_LOCK_WAIT_ATTEMPTS: usize = 200;
const RUNTIME_LOCK_STALE_SECS: u64 = 5 * 60;

fn embedded_runtime_version() -> &'static str {
    std::str::from_utf8(embedded_resources::VERSION).unwrap_or("").trim()
}

fn runtime_version_matches(root: &Path) -> bool {
    std::fs::read(root.join(RUNTIME_VERSION_FILE))
        .map(|bytes| bytes == embedded_resources::VERSION)
        .unwrap_or(false)
}

fn runtime_metadata_matches(root: &Path) -> bool {
    for resource in embedded_resources::ALL {
        if resource.relative_path == RUNTIME_VERSION_FILE {
            continue;
        }
        let target = root.join(resource.relative_path);
        let Ok(metadata) = std::fs::metadata(target) else {
            return false;
        };
        if metadata.len() != resource.bytes.len() as u64 {
            return false;
        }
    }
    true
}

fn integrity_marker_is_fresh(root: &Path) -> bool {
    let Ok(content) = std::fs::read_to_string(root.join(RUNTIME_INTEGRITY_FILE)) else {
        return false;
    };
    let mut parts = content.trim().split('|');
    let Some(version) = parts.next() else {
        return false;
    };
    let Some(timestamp) = parts.next().and_then(|value| value.parse::<u64>().ok()) else {
        return false;
    };
    if version != embedded_runtime_version() {
        return false;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    now.saturating_sub(timestamp) <= RUNTIME_FULL_CHECK_INTERVAL_SECS
}

fn full_resources_match(root: &Path) -> bool {
    embedded_resources::ALL.iter().all(|resource| {
        std::fs::read(root.join(resource.relative_path))
            .map(|bytes| bytes == resource.bytes)
            .unwrap_or(false)
    })
}

fn write_integrity_marker(root: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let temporary = root.join(".integrity-check.tmp");
    let marker = root.join(RUNTIME_INTEGRITY_FILE);
    let content = format!("{}|{}\n", embedded_runtime_version(), timestamp);
    if std::fs::write(&temporary, content).is_ok() {
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::rename(temporary, marker);
    }
}

fn extract_embedded_resources(root: &Path) -> Result<(), String> {
    for resource in embedded_resources::ALL {
        let target = root.join(resource.relative_path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let temporary = target.with_extension("tmp");
        std::fs::write(&temporary, resource.bytes).map_err(|error| error.to_string())?;
        if target.exists() {
            std::fs::remove_file(&target).map_err(|error| error.to_string())?;
        }
        if let Err(error) = std::fs::rename(&temporary, &target) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error.to_string());
        }
    }
    write_integrity_marker(root);
    Ok(())
}

struct RuntimeUpdateLock {
    path: PathBuf,
    _file: std::fs::File,
}

impl Drop for RuntimeUpdateLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn acquire_runtime_update_lock(root: &Path) -> Result<RuntimeUpdateLock, String> {
    let path = root.join(RUNTIME_LOCK_FILE);
    for _ in 0..RUNTIME_LOCK_WAIT_ATTEMPTS {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok(RuntimeUpdateLock { path, _file: file }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = std::fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .and_then(|modified| modified.elapsed().ok())
                    .map(|age| age.as_secs() > RUNTIME_LOCK_STALE_SECS)
                    .unwrap_or(false);
                if stale {
                    let _ = std::fs::remove_file(&path);
                    continue;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("运行时资源正在被另一个 Personal AI OS 进程更新，请稍后重试".to_string())
}

fn ensure_embedded_resources_at(home_dir: &Path) -> Result<PathBuf, String> {
    let root = home_dir.join(".paios").join("desktop-runtime").join("resources");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let _runtime_lock = acquire_runtime_update_lock(&root)?;

    if runtime_version_matches(&root) && runtime_metadata_matches(&root) {
        if integrity_marker_is_fresh(&root) {
            log_startup("embedded resources fast path");
            return Ok(root);
        }
        if full_resources_match(&root) {
            write_integrity_marker(&root);
            log_startup("embedded resources full check passed");
            return Ok(root);
        }
    }

    log_startup("embedded resources extracting or repairing");
    extract_embedded_resources(&root)?;
    Ok(root)
}

fn log_startup(message: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("paios-desktop.log"))
    {
        let _ = writeln!(file, "{message}");
    }
}

#[cfg(windows)]
fn show_startup_error(message: &str) {
    let text: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
    let caption: Vec<u16> = "Personal AI OS".encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        MessageBoxW(null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
    }
}

#[cfg(not(windows))]
fn show_startup_error(message: &str) {
    eprintln!("{message}");
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        if let Ok(mut process) = self.0.lock() {
            if let Some(mut child) = process.take() {
                let _ = child.kill();
            }
        }
    }
}

#[tauri::command]
fn data_directory(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .home_dir()
        .map(|path| path.join(".paios").to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

fn start_local_server(app: &tauri::AppHandle, command_arg: &str, inherit_stdio: bool) -> Result<ManagedChild, String> {
    let data_dir = std::env::var_os("PAIOS_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(app
            .path()
            .home_dir()
            .map_err(|error| error.to_string())?
            .join(".paios"));
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    let resource_dir = normal_windows_path(app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?);
    let resource_roots = [resource_dir.clone(), resource_dir.join("resources")];
    // The single-file EXE must prefer its embedded runtime. Otherwise an old
    // resources folder next to a copied EXE can silently start an older server.
    // The extracted files are content-checked and reused on later launches.
    let resource_check_started = Instant::now();
    let bundled_root = match ensure_embedded_resources(app) {
        Ok(root) => Some(root),
        Err(error) => {
            log_startup(&format!("embedded resource extraction error={error}"));
            if cfg!(debug_assertions) {
                resource_roots
                    .iter()
                    .find(|root| root.join("node.exe").exists() && root.join("paios-server").join("server.mjs").exists())
                    .cloned()
            } else {
                None
            }
        }
    };
    log_startup(&format!("embedded resource check ms={}", resource_check_started.elapsed().as_millis()));
    let bundled_node = bundled_root.clone().map(|root| root.join("node.exe"));
    let bundled_server_dir = bundled_root.clone().map(|root| root.join("paios-server"));
    let bundled_entry = bundled_server_dir.clone().map(|root| root.join("server.mjs"));
    log_startup(&format!("resource_dir={}", resource_dir.display()));
    log_startup(&format!("bundled_root={}", bundled_root.as_ref().map_or_else(|| "missing".to_string(), |root| root.display().to_string())));

    let mut command;
    if let (Some(bundled_node), Some(bundled_server_dir), Some(bundled_entry)) = (bundled_node, bundled_server_dir, bundled_entry) {
        log_startup("using bundled node server");
        command = Command::new(bundled_node);
        command
            .arg(bundled_entry)
            .arg(command_arg)
            .current_dir(bundled_server_dir);
    } else {
        // Keep a workspace fallback for manually launched development builds.
        let command_name = std::env::var("PAIOS_SERVER_COMMAND").unwrap_or_else(|_| "paios".to_string());
        log_startup(&format!("using fallback server command={command_name}"));
        command = Command::new(command_name);
        command.arg(command_arg);
    }

    let port = std::env::var("PAIOS_PORT").unwrap_or_else(|_| "4738".to_string());
    log_startup(&format!("server bind=127.0.0.1 port={port}"));
    command
        .env("PAIOS_DATA_DIR", &data_dir)
        .env("PAIOS_BIND", "127.0.0.1")
        .env("PAIOS_PORT", port);
    if let Ok(executable) = std::env::current_exe() {
        command.env("PAIOS_MCP_COMMAND", executable);
    }
    if inherit_stdio {
        command
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
    } else {
        let server_log_path = std::env::temp_dir().join("paios-server.log");
        let server_stdout = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&server_log_path)
            .map_err(|error| error.to_string())?;
        let server_stderr = server_stdout.try_clone().map_err(|error| error.to_string())?;
        command
            .stdout(Stdio::from(server_stdout))
            .stderr(Stdio::from(server_stderr));
        log_startup(&format!("server log={}", server_log_path.display()));
    }
    #[cfg(windows)]
    if !inherit_stdio {
        // The bundled Node runtime is a console application. Detach the
        // normal desktop server from every console so Windows cannot create
        // a second command window. MCP mode keeps inherited stdio for the
        // Agent transport.
        command.creation_flags(0x00000008);
    }
    match command.spawn() {
        Ok(child) => {
            log_startup(&format!("server spawned pid={}", child.id()));
            ManagedChild::attach(child)
        }
        Err(error) => {
            log_startup(&format!("server spawn error={error}"));
            Err(error.to_string())
        }
    }
}

fn start_embedded_server_command(command_arg: &str) -> Result<ManagedChild, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "无法确定用户目录".to_string())?;
    let data_dir = std::env::var_os("PAIOS_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.join(".paios"));
    std::fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;

    let runtime_root = ensure_embedded_resources_at(&home_dir)?;
    let node = runtime_root.join("node.exe");
    let server_dir = runtime_root.join("paios-server");
    let entry = server_dir.join("server.mjs");
    if !node.exists() || !entry.exists() {
        return Err("内置 MCP 运行时文件不存在".to_string());
    }

    let mut command = Command::new(node);
    command
        .arg(entry)
        .arg(command_arg)
        .current_dir(server_dir)
        .env("PAIOS_DATA_DIR", &data_dir)
        .env("PAIOS_BIND", "127.0.0.1")
        .env("PAIOS_PORT", std::env::var("PAIOS_PORT").unwrap_or_else(|_| "4738".to_string()));
    if let Ok(executable) = std::env::current_exe() {
        command.env("PAIOS_MCP_COMMAND", executable);
    }
    command
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        // MCP uses inherited pipes for JSON-RPC, but must never create a
        // visible console window when Antigravity launches this process.
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().map_err(|error| error.to_string())?;
    ManagedChild::attach(child)
}

pub fn run_mcp_direct() -> ! {
    let code = match start_embedded_server_command("mcp-direct") {
        Ok(mut child) => child.wait().ok().and_then(|status| status.code()).unwrap_or(1),
        Err(error) => {
            log_startup(&format!("direct MCP startup failed: {error}"));
            1
        }
    };
    std::process::exit(code);
}

/**
 * Run the database-only recovery command without starting Tauri or opening
 * the possibly corrupted main database. This keeps recovery available even
 * when the graphical server cannot boot.
 */
pub fn run_restore_latest() -> ! {
    let code = match start_embedded_server_command("restore-latest") {
        Ok(mut child) => child.wait().ok().and_then(|status| status.code()).unwrap_or(1),
        Err(error) => {
            log_startup(&format!("restore startup failed: {error}"));
            1
        }
    };
    std::process::exit(code);
}

pub fn run() {
    let mcp_mode = std::env::args().any(|argument| argument == "--mcp");
    let builder = tauri::Builder::default();
    // MCP is intentionally allowed to run beside the graphical workbench:
    // an Agent may start the same EXE while the user is looking at the UI.
    // The normal desktop mode keeps single-instance behavior.
    let builder = if mcp_mode {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
    };
    builder
        .manage(ServerProcess(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![data_directory])
        .setup(move |app| {
            if !cfg!(debug_assertions) {
                if mcp_mode {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    match start_local_server(&app.handle(), "mcp-direct", true) {
                        Ok(mut child) => {
                            let handle = app.handle().clone();
                            std::thread::spawn(move || {
                                let code = child.wait().ok().and_then(|status| status.code()).unwrap_or(1);
                                handle.exit(code);
                            });
                        }
                        Err(error) => {
                            log_startup(&format!("direct MCP startup failed: {error}"));
                            app.handle().exit(1);
                        }
                    }
                } else {
                    match start_local_server(&app.handle(), "serve", false) {
                    Ok(mut child) => {
                        if let Err(error) = wait_for_server_start(&mut child) {
                            log_startup(&format!("server startup failed: {error}"));
                            show_startup_error(&format!("本地服务启动失败：{error}\n\n请先关闭旧的 Personal AI OS 或 MCP 进程后再重试。"));
                            app.handle().exit(1);
                        } else {
                            let state: State<ServerProcess> = app.state();
                            let process = state.inner().0.clone();
                            *process.lock().map_err(|_| "server state lock poisoned")? = Some(child);
                            monitor_server(process, app.handle().clone());
                        }
                    }
                    Err(error) => {
                        log_startup(&format!("server startup failed: {error}"));
                        show_startup_error(&format!("本地服务启动失败：{error}\n\n请先关闭旧的 Personal AI OS 或 MCP 进程后再重试。"));
                        app.handle().exit(1);
                    }
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Personal AI OS desktop shell");
}
