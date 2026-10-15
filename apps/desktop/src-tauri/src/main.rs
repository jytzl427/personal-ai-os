#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--mcp") {
        paios_desktop_lib::run_mcp_direct();
    }
    if std::env::args().any(|argument| argument == "--restore-latest") {
        paios_desktop_lib::run_restore_latest();
    }
    paios_desktop_lib::run()
}
