use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::{
    scan::Decision,
    session::{ScanSession, SessionError},
};

// A 256 KiB raw chunk becomes about 342 KiB of base64 plus a small JSON envelope.
const MAX_FRAME_BYTES: usize = 512 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum NativeRequest<'a> {
    ScanBegin {
        id: &'a str,
        #[serde(rename = "name")]
        _name: &'a str,
        size: u64,
    },
    ScanChunk {
        id: &'a str,
        offset: u64,
        data: &'a str,
    },
    ScanEnd {
        id: &'a str,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum NativeResponse<'a> {
    Verdict {
        id: &'a str,
        decision: &'static str,
        rule: Option<&'static str>,
    },
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("native message I/O failed: {0}")]
    Io(#[from] io::Error),
    #[error("native message frame is empty or too large")]
    InvalidFrameLength,
    #[error("native message JSON is invalid: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("scan protocol is invalid: {0}")]
    InvalidSession(#[from] SessionError),
}

fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Zeroizing<Vec<u8>>>, ProtocolError> {
    let mut length = [0_u8; 4];
    match reader.read(&mut length[..1])? {
        0 => return Ok(None),
        1 => reader.read_exact(&mut length[1..])?,
        _ => unreachable!("a one-byte buffer cannot receive more than one byte"),
    }
    // Chrome specifies native byte order; supported demo platforms are little-endian.
    let length = u32::from_ne_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(ProtocolError::InvalidFrameLength);
    }
    let mut payload = Zeroizing::new(vec![0_u8; length]);
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame<W: Write, T: Serialize>(writer: &mut W, message: &T) -> Result<(), ProtocolError> {
    let payload = serde_json::to_vec(message)?;
    let length = u32::try_from(payload.len()).map_err(|_| ProtocolError::InvalidFrameLength)?;
    writer.write_all(&length.to_ne_bytes())?;
    writer.write_all(&payload)?;
    writer.flush()?;
    Ok(())
}

pub fn run_native_host<R: Read, W: Write>(
    mut reader: R,
    mut writer: W,
) -> Result<(), ProtocolError> {
    let mut session = ScanSession::default();
    while let Some(payload) = read_frame(&mut reader)? {
        // Borrowing fields avoids copying the base64 text out of this zeroizing frame.
        let request: NativeRequest<'_> = serde_json::from_slice(&payload)?;
        match request {
            NativeRequest::ScanBegin { id, size, .. } => session.begin(id, size)?,
            NativeRequest::ScanChunk { id, offset, data } => {
                session.append_base64(id, offset, data)?
            }
            NativeRequest::ScanEnd { id } => {
                let decision = session.finish(id)?;
                let response = match decision {
                    Decision::Block => NativeResponse::Verdict {
                        id,
                        decision: "block",
                        rule: Some("pem_private_key"),
                    },
                    Decision::Allow => NativeResponse::Verdict {
                        id,
                        decision: "allow",
                        rule: None,
                    },
                };
                write_frame(&mut writer, &response)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use serde_json::json;

    use super::{read_frame, run_native_host};

    fn append_request(output: &mut Vec<u8>, message: serde_json::Value) {
        let payload = serde_json::to_vec(&message).expect("request should serialize");
        output.extend_from_slice(&(payload.len() as u32).to_ne_bytes());
        output.extend_from_slice(&payload);
    }

    #[test]
    fn framed_protocol_returns_only_the_verdict() {
        let bytes = b"safe prefix BEGIN RSA PRIVATE KEY safe suffix";
        let mut input = Vec::new();
        append_request(
            &mut input,
            json!({ "type": "scan_begin", "id": "scan-1", "name": "fake.pem", "size": bytes.len() }),
        );
        append_request(
            &mut input,
            json!({ "type": "scan_chunk", "id": "scan-1", "offset": 0, "data": STANDARD.encode(bytes) }),
        );
        append_request(&mut input, json!({ "type": "scan_end", "id": "scan-1" }));

        let mut output = Vec::new();
        run_native_host(Cursor::new(input), &mut output).expect("protocol should complete");

        let frame = read_frame(&mut Cursor::new(output))
            .expect("response frame should be valid")
            .expect("response should exist");
        let response: serde_json::Value =
            serde_json::from_slice(&frame).expect("response should deserialize");
        assert_eq!(
            response,
            json!({
                "type": "verdict",
                "id": "scan-1",
                "decision": "block",
                "rule": "pem_private_key"
            })
        );
    }
}
