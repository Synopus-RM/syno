// Desktop shell: native window, menu, single instance, remembered window size,
// and signed self-updates. The app's screens come from the web app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{AboutMetadataBuilder, MenuBuilder, SubmenuBuilder};
use tauri::Manager;

const CREDIT: &str = "Designed & Developed by Synopus";
const WEBSITE: &str = "https://www.synopus.in";

fn main() {
    tauri::Builder::default()
        // Must be registered first: a second launch focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let info = app.package_info();
            let about = AboutMetadataBuilder::new()
                .name(Some(info.name.clone()))
                .version(Some(info.version.to_string()))
                .copyright(Some(CREDIT))
                .credits(Some(CREDIT))
                .website(Some(WEBSITE))
                .website_label(Some("www.synopus.in"))
                .build();

            let app_menu = SubmenuBuilder::new(app, &info.name)
                .about(Some(about))
                .separator()
                .hide()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .fullscreen()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the desktop app");
}
