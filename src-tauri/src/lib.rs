mod app_config;
mod autostart;
mod bilibili;
mod external_open;
mod instance_id;
mod launch_args;
mod legacy_migration;
mod live_monitor;
mod logging;
mod notifications;
mod portable;
mod single_instance;
mod system_fonts;
mod toast;
mod tray;
mod update_check;
mod window_control;

use tauri::Manager;

#[tauri::command]
fn set_click_through(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    window_control::set_click_through(&app, enabled)
}

#[tauri::command]
async fn open_help_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("help") {
        let _ = window.close();
        // Wait for the window to fully close on all platforms
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let _ =
        tauri::WebviewWindowBuilder::new(&app, "help", tauri::WebviewUrl::App("help.html".into()))
            .title("如何获取房间号")
            .inner_size(420.0, 480.0)
            .resizable(false)
            .center()
            .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = launch_args::LaunchArgs::from_env();
    // 实例身份先于一切初始化：单实例锁、开机自启注册表值、Toast 的 AUMID、开始菜单快捷方式
    // 都要在名字上加同一个后缀。正式版 LiveBell.exe 后缀为空（与老版本完全一致），
    // 测试版换个文件名（如 LiveBell-Test.exe）就自动隔离，可以和正式版同时跑。
    instance_id::init_current_instance();
    // 单实例：已有实例在跑时唤醒它再退出自己。
    let mut instance = if std::env::var_os("LIVEBELL_NO_SINGLE_INSTANCE").is_some() {
        instance_id::bypass_guard()
    } else {
        single_instance::InstanceGuard::acquire(instance_id::suffix())
    };
    if !instance.is_primary() {
        tracing::info!(
            target: "livebell::app",
            suffix = instance_id::suffix(),
            exe = %std::env::current_exe().map(|path| path.display().to_string()).unwrap_or_default(),
            "another instance is running, waking it up"
        );
        std::process::exit(0);
    }

    tauri::Builder::default()
        .manage(bilibili::room_manager::RoomConnectionManager::default())
        .manage(bilibili::filter_runtime::FilterRuntimeState::default())
        .manage(bilibili::send::SendDanmakuState::default())
        .manage(bilibili::recording::DanmakuRecorder::default())
        .manage(args)
        .manage(window_control::EditModeState::default())
        .manage(window_control::StreamerDialogTarget::default())
        .manage(notifications::NotificationHistoryState::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            logging::init(app.handle()).map_err(|e| format!("logging: {e}"))?;
            // 从旧品牌名（EiheiLing / 诶嘿铃）迁移登录态、自启、快捷方式与数据目录。
            // 放在日志初始化之后，失败也能留下记录；不阻塞启动。
            legacy_migration::migrate();
            // 头像是便携目录（exe 旁的 Data/Avatars）里的本地文件，路径随安装位置变化，
            // 静态 scope 覆盖不到，这里在运行时把数据目录加进 asset 协议白名单。
            match portable::data_root() {
                Ok(root) => {
                    if let Err(error) = app.asset_protocol_scope().allow_directory(&root, true) {
                        tracing::warn!(
                            target: "livebell::window",
                            error = %error,
                            "failed to allow asset protocol scope for data dir"
                        );
                    }
                }
                Err(error) => tracing::warn!(
                    target: "livebell::window",
                    error = %error,
                    "failed to resolve data dir for asset protocol scope"
                ),
            }
            tracing::debug!(target: "livebell::update", "tauri updater plugin initialized");
            bilibili::recording::setup(app).map_err(|e| format!("recording: {e}"))?;
            live_monitor::setup(app).map_err(|e| format!("live_monitor: {e}"))?;
            window_control::setup(app).map_err(|e| format!("window_control: {e}"))?;
            tray::setup(app).map_err(|e| format!("tray: {e}"))?;

            // --background（开机自启）只留托盘与开播监听，不弹主窗口。
            if args.background {
                for label in ["main", "control", "home"] {
                    if let Some(window) = app.get_webview_window(label) {
                        let _ = window.hide();
                    }
                }
                tracing::info!(target: "livebell::app", "started in background mode");
            } else {
                // 正常运行（非开机自启）时直接打开主界面，对齐 C# 老版 App.xaml.cs 的 ShowMainWindow()。
                // 建窗要丢到异步运行时：setup 跑在主线程上，同步建窗会与事件循环互等。
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = window_control::open_home_window(handle).await {
                        tracing::warn!(
                            target: "livebell::app",
                            error = %error,
                            "failed to open home window on startup"
                        );
                    }
                });
            }

            // 后启动的实例会把唤醒事件置位；这里监听并弹出主界面。
            if let Some(event) = instance.take_wake_event() {
                let handle = app.handle().clone();
                single_instance::listen(event, move || {
                    // 主界面是运行时创建的，建窗要丢到异步运行时（监听线程不能阻塞）。
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = window_control::open_home_window(handle).await {
                            tracing::warn!(
                                target: "livebell::app",
                                error = %error,
                                "failed to open home window on wake"
                            );
                        }
                    });
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            if label == "main" || label == "control" || label == "home" {
                if matches!(
                    event,
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                ) {
                    // 只在窗口可见时、并且合并掉拖动过程中的连串事件后再落盘。
                    window_control::schedule_window_layout_save(window.app_handle(), label);
                }
                // 主界面和设置窗一样：点关闭只收进托盘，不退出进程。
                tray::prevent_close_to_tray(window, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_config::load_app_config,
            app_config::save_app_config,
            app_config::set_last_send_room_id,
            logging::open_log_dir,
            logging::export_diagnostics,
            system_fonts::list_system_fonts,
            set_click_through,
            tray::hide_window,
            tray::show_window,
            window_control::set_edit_mode,
            window_control::set_edit_mode_shortcut,
            window_control::set_overlay_window_shortcut,
            window_control::set_send_danmaku_shortcut,
            window_control::open_send_danmaku_window,
            window_control::hide_send_danmaku_window,
            window_control::open_connect_room_window,
            window_control::open_streamer_dialog_window,
            window_control::hide_streamer_dialog_window,
            window_control::streamer_dialog_target,
            window_control::hide_connect_room_window,
            window_control::open_home_window,
            window_control::hide_home_window,
            window_control::begin_send_danmaku_window_drag,
            window_control::drag_send_danmaku_window,
            window_control::end_send_danmaku_window_drag,
            window_control::save_window_layout,
            window_control::load_window_layout,
            bilibili::ws::connect_bilibili_room,
            bilibili::ws::disconnect_bilibili_room,
            bilibili::ws::disconnect_all_bilibili_rooms,
            bilibili::ws::get_bilibili_room_sessions,
            bilibili::filter_runtime::get_filter_runtime_status,
            bilibili::filter_runtime::pause_fan_medal_rules_for_session,
            bilibili::recording::get_danmaku_recording_status,
            bilibili::recording::set_danmaku_recording_enabled,
            bilibili::recording::retry_danmaku_recording,
            bilibili::recording::open_danmaku_record_dir,
            bilibili::send::send_bilibili_danmaku,
            bilibili::send::get_send_danmaku_status,
            bilibili::diagnostics::test_bilibili_api,
            bilibili::streamer_search::streamer_search,
            bilibili::avatar_cache::sync_room_avatars,
            bilibili::avatar_cache::refresh_room_avatars,
            bilibili::auth::auth_get_status,
            bilibili::auth::auth_start_qr_login,
            bilibili::auth::auth_poll_qr_login,
            bilibili::auth::auth_validate_session,
            bilibili::auth::auth_logout,
            launch_args::launch_args,
            live_monitor::live_check_now,
            live_monitor::live_check_room,
            autostart::autostart_is_enabled,
            autostart::autostart_set_enabled,
            external_open::open_external_url,
            notifications::notifications_list,
            notifications::notifications_unread_count,
            notifications::notifications_take_pending,
            notifications::notifications_mark_read,
            notifications::notifications_mark_all_read,
            notifications::notifications_clear,
            notifications::notifications_hide_window,
            notifications::notifications_test,
            update_check::get_app_version,
            open_help_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
