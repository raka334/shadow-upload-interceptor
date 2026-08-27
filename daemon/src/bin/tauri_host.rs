fn main() {
    let application = match tauri::Builder::default().build(tauri::generate_context!()) {
        Ok(application) => application,
        Err(error) => {
            // Chrome sees a disconnect and the extension deliberately fails open.
            eprintln!("SecureIntent failed to initialize Tauri: {error}");
            std::process::exit(1);
        }
    };

    let mut host_started = false;
    application.run(move |handle, event| {
        if !host_started && matches!(event, tauri::RunEvent::Ready) {
            host_started = true;
            let handle = handle.clone();

            // Native Messaging is blocking by design. Starting after RunEvent::Ready avoids an
            // early-exit race while keeping stdin/stdout off Tauri's main event-loop thread.
            tauri::async_runtime::spawn_blocking(move || {
                let exit_code = match secureintent_shadow_host::run_stdio() {
                    Ok(()) => 0,
                    Err(error) => {
                        // stdout is protocol-only; diagnostics must stay on stderr.
                        eprintln!("SecureIntent Tauri native host stopped: {error}");
                        1
                    }
                };
                handle.exit(exit_code);
            });
        }
    });
}
