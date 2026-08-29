fn main() {
    let application = match tauri::Builder::default().build(tauri::generate_context!()) {
        Ok(application) => application,
        Err(error) => {
            eprintln!("SecureIntent detached daemon failed to initialize Tauri: {error}");
            std::process::exit(1);
        }
    };

    let handle = application.handle().clone();
    if let Err(error) = std::thread::Builder::new()
        .name("secureintent-daemon".to_owned())
        .spawn(move || {
            // The listener starts independently of GUI readiness. Headless Linux sessions are not
            // required to emit a window-system Ready event before local protection becomes active.
            let exit_code = match secureintent_shadow_host::run_daemon() {
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("SecureIntent detached Tauri daemon stopped: {error}");
                    1
                }
            };
            // Client disconnects are handled inside the listener and never reach here. Exit only
            // when the persistent listener itself cannot continue.
            handle.exit(exit_code);
        })
    {
        eprintln!("SecureIntent could not start the detached daemon thread: {error}");
        std::process::exit(1);
    }

    // Tauri owns the main-thread application lifecycle. systemd owns this process; Chrome owns
    // only temporary Native Messaging broker processes.
    application.run(|_, _| {});
}
