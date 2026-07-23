use std::io::{BufRead, Write};

use serde::Deserialize;
use serde_json::{Value, json};

pub const RUN_PROTOCOL_VERSION: &str = "forge.kernel.bridge.v2";
pub const TRANSACTION_PROTOCOL_VERSION: &str = "forge.kernel.transaction.v1";
pub const CANDIDATE_PROTOCOL_VERSION: &str = "forge.kernel.candidate.v1";
pub const MAX_START_FRAME_BYTES: usize = 24 * 1_048_576;
pub const MAX_CANDIDATE_START_FRAME_BYTES: usize = 512 * 1_024;
pub const MAX_HOST_FRAME_BYTES: usize = 8 * 1_048_576;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDiscriminator {
    #[serde(rename = "type")]
    pub message_type: String,
    pub protocol_version: String,
}

pub fn read_bounded_frame<R: BufRead>(
    reader: &mut R,
    maximum_bytes: usize,
) -> Result<Option<Vec<u8>>, String> {
    let mut frame = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .map_err(|_| "Unable to read protocol input.".to_owned())?;
        if available.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err("Protocol frames must end with a newline.".to_owned())
            };
        }
        if let Some(newline) = available.iter().position(|byte| *byte == b'\n') {
            if frame.len().saturating_add(newline) > maximum_bytes {
                return Err("Protocol frame exceeds the configured byte limit.".to_owned());
            }
            frame.extend_from_slice(&available[..newline]);
            reader.consume(newline + 1);
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            return Ok(Some(frame));
        }
        if frame.len().saturating_add(available.len()) > maximum_bytes {
            return Err("Protocol frame exceeds the configured byte limit.".to_owned());
        }
        let consumed = available.len();
        frame.extend_from_slice(available);
        reader.consume(consumed);
    }
}

pub fn send_json<W: Write>(writer: &mut W, message: &Value) -> Result<(), String> {
    serde_json::to_writer(&mut *writer, message)
        .map_err(|_| "Unable to encode protocol output.".to_owned())?;
    writer
        .write_all(b"\n")
        .map_err(|_| "Unable to write protocol output.".to_owned())?;
    writer
        .flush()
        .map_err(|_| "Unable to flush protocol output.".to_owned())
}

pub fn send_protocol_error<W: Write>(
    writer: &mut W,
    protocol_version: &str,
    request_id: Option<&str>,
    code: &str,
    message: &str,
) {
    let mut payload = json!({
        "type": "protocol.error",
        "protocolVersion": protocol_version,
        "code": code,
        "message": message,
    });
    if let Some(request_id) = request_id {
        payload["requestId"] = Value::String(request_id.to_owned());
    }
    let _ = send_json(writer, &payload);
}

#[cfg(test)]
mod tests {
    use std::io::{BufReader, Cursor};

    use super::read_bounded_frame;

    #[test]
    fn reads_a_newline_delimited_frame_within_the_limit() {
        let mut reader = BufReader::new(Cursor::new(b"{\"type\":\"ok\"}\nnext\n"));
        assert_eq!(
            read_bounded_frame(&mut reader, 32).expect("frame"),
            Some(b"{\"type\":\"ok\"}".to_vec())
        );
        assert_eq!(
            read_bounded_frame(&mut reader, 32).expect("next frame"),
            Some(b"next".to_vec())
        );
    }

    #[test]
    fn rejects_an_oversized_frame_before_reading_the_remainder() {
        let mut reader = BufReader::with_capacity(3, Cursor::new(b"abcdef\n"));
        assert_eq!(
            read_bounded_frame(&mut reader, 5).expect_err("oversized"),
            "Protocol frame exceeds the configured byte limit."
        );
    }

    #[test]
    fn rejects_a_non_terminated_frame() {
        let mut reader = BufReader::new(Cursor::new(b"unterminated"));
        assert_eq!(
            read_bounded_frame(&mut reader, 32).expect_err("missing newline"),
            "Protocol frames must end with a newline."
        );
    }
}
