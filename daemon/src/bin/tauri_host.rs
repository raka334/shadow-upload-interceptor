fn main() {
    let application = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            // Native Messaging is blocking by design. Keep stdin/stdout off Tauri's event loop
            // while Tauri owns the application lifecycle on the main thread.
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
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = application {
        // Chrome sees a disconnect and the extension deliberately fails open.
        eprintln!("SecureIntent failed to initialize Tauri: {error}");
        std::process::exit(1);
    }
}
