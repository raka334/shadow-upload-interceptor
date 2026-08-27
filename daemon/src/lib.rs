mod protocol;
mod scan;
mod session;

#[cfg(not(target_endian = "little"))]
compile_error!("SecureIntent Native Messaging framing currently supports little-endian targets");

use std::io::{self, BufReader, BufWriter};

pub use protocol::ProtocolError;

/// Runs one Chrome-owned Native Messaging session on inherited stdin/stdout.
/// stdout is reserved exclusively for Chrome-framed protocol messages.
pub fn run_stdio() -> Result<(), ProtocolError> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    protocol::run_native_host(BufReader::new(stdin.lock()), BufWriter::new(stdout.lock()))
}
