mod protocol;
mod scan;
mod session;

use std::io::{self, BufReader, BufWriter};

#[cfg(feature = "tauri-host")]
fn main() {
    let application = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("secureintent-native-messaging".into())
                .spawn(move || {
                    let stdin = io::stdin();
                    let stdout = io::stdout();
                    let result = protocol::run_native_host(
                        BufReader::new(stdin.lock()),
                        BufWriter::new(stdout.lock()),
                    );
                    match result {
                        Ok(()) => handle.exit(0),
                        Err(error) => {
                            // stdout is reserved exclusively for framed Native Messaging JSON.
                            eprintln!("SecureIntent native host stopped: {error}");
                            handle.exit(1);
                        }
                    }
                })
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = application {
        // Chrome observes a disconnect; the extension deliberately fails open.
        eprintln!("SecureIntent failed to initialize Tauri: {error}");
    }
}

/// Minimal-CI mode keeps scanner/protocol tests runnable without Linux WebKit headers.
/// The installer always enables `tauri-host`; this path is also useful for protocol debugging.
#[cfg(not(feature = "tauri-host"))]
fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    if let Err(error) =
        protocol::run_native_host(BufReader::new(stdin.lock()), BufWriter::new(stdout.lock()))
    {
        eprintln!("SecureIntent native host stopped: {error}");
        std::process::exit(1);
    }
}
