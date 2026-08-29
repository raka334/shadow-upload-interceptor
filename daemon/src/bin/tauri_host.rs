fn main() {
    let application = match tauri::Builder::default().build(tauri::generate_context!()) {
        Ok(application) => application,
        Err(error) => {
            eprintln!("SecureIntent detached daemon failed to initialize Tauri: {error}");
            std::process::exit(1);
        }
    };

    let mut daemon_started = false;
    application.run(move |handle, event| {
        if !daemon_started && matches!(event, tauri::RunEvent::Ready) {
            daemon_started = true;
            let handle = handle.clone();

            // The Unix listener is deliberately independent of Chrome's stdio and process
            // lifetime. systemd owns this Tauri process; each Chrome-launched broker is temporary.
            tauri::async_runtime::spawn_blocking(move || {
                let exit_code = match secureintent_shadow_host::run_daemon() {
                    Ok(()) => 0,
                    Err(error) => {
                        eprintln!("SecureIntent detached Tauri daemon stopped: {error}");
                        1
                    }
                };
                // Client disconnects are handled inside the listener and never reach here. Exit
                // only when the persistent listener itself cannot continue.
                handle.exit(exit_code);
            });
        }
    });
}
