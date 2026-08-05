use std::io::BufWriter;
use std::path::PathBuf;

use forge_core::inspect_run;
use serde::Deserialize;
use serde_json::json;

use crate::protocol::{RUN_STORE_PROTOCOL_VERSION, send_json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunStoreInspectStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    run_store_root: PathBuf,
    run_id: String,
}

#[derive(Debug)]
pub struct RunStoreBridgeFailure {
    pub request_id: Option<String>,
    pub code: &'static str,
    pub message: String,
}

pub fn execute(
    frame: &[u8],
    writer: &mut BufWriter<std::io::Stdout>,
) -> Result<(), RunStoreBridgeFailure> {
    let start: RunStoreInspectStart =
        serde_json::from_slice(frame).map_err(|_| RunStoreBridgeFailure {
            request_id: None,
            code: "invalid_run_store_inspect",
            message: "Invalid run-store inspection start JSON.".to_owned(),
        })?;
    let request_id = Some(start.request_id.clone());
    if start.message_type != "run_store.inspect"
        || start.protocol_version != RUN_STORE_PROTOCOL_VERSION
        || start.request_id.trim().is_empty()
        || start.run_id.trim().is_empty()
    {
        return Err(RunStoreBridgeFailure {
            request_id,
            code: "invalid_run_store_inspect",
            message: "Run-store inspection identity is invalid.".to_owned(),
        });
    }
    let inspection = inspect_run(&start.run_store_root, &start.run_id).map_err(|message| {
        RunStoreBridgeFailure {
            request_id: Some(start.request_id.clone()),
            code: "run_store_inspection_failed",
            message,
        }
    })?;
    send_json(
        writer,
        &json!({
            "type": "run_store.inspect.result",
            "protocolVersion": RUN_STORE_PROTOCOL_VERSION,
            "requestId": start.request_id,
            "inspection": inspection,
        }),
    )
    .map_err(|message| RunStoreBridgeFailure {
        request_id: None,
        code: "run_store_output_failed",
        message,
    })
}
