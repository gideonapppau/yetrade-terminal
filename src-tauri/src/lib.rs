use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_initial_tables",
        sql: "
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS telegram_channels (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          risk_per_trade REAL,
          max_trades_per_day INTEGER
        );

        CREATE TABLE IF NOT EXISTS signals (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL REFERENCES telegram_channels(id),
          symbol TEXT NOT NULL,
          direction TEXT NOT NULL,
          entry REAL,
          stop_loss REAL,
          status TEXT NOT NULL,
          received_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS trades (
          id TEXT PRIMARY KEY,
          signal_id TEXT REFERENCES signals(id),
          symbol TEXT NOT NULL,
          direction TEXT NOT NULL,
          volume REAL NOT NULL,
          entry_price REAL,
          status TEXT NOT NULL
        );
      ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "add_pnl_to_trades",
        sql: "ALTER TABLE trades ADD COLUMN pnl REAL;",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 3,
        description: "create_telegram_messages",
        sql: "
        CREATE TABLE IF NOT EXISTS telegram_messages (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          text TEXT NOT NULL,
          received_at INTEGER NOT NULL,
          edited_at INTEGER
        );
        ",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 4,
        description: "add_closed_at_to_trades",
        sql: "ALTER TABLE trades ADD COLUMN closed_at INTEGER;",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:trading-terminal.db", migrations)
                .build(),
        )
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                Manager,
            };

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            use tauri_plugin_shell::ShellExt;
            
            // Spawn the Python server sidecar
            let sidecar_command = app.shell().sidecar("python-server")
                .expect("failed to create `python-server` binary command");
            let (mut rx, _child) = sidecar_command
                .spawn()
                .expect("Failed to spawn sidecar");
            
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let tauri_plugin_shell::process::CommandEvent::Stdout(line) = event {
                        println!("python-server: {}", String::from_utf8_lossy(&line));
                    }
                }
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
