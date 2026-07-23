use std::{io::BufWriter, path::PathBuf};

use forge_core::{
    Cancellation, CandidateDiscardRequest, CandidateLifecycleConfig, CandidateLifecycleService,
    CandidatePromotionRequest,
};
use serde::Deserialize;
use serde_json::json;

use crate::protocol::{CANDIDATE_PROTOCOL_VERSION, MAX_CANDIDATE_START_FRAME_BYTES, send_json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    config: CandidateBridgeConfig,
    operation: CandidateOperation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateBridgeConfig {
    repository_root: PathBuf,
    candidate_parent: PathBuf,
    #[serde(default)]
    candidate_lease_root: Option<PathBuf>,
    #[serde(default)]
    git_executable: Option<PathBuf>,
    #[serde(default)]
    max_diff_bytes: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
enum CandidateOperation {
    #[serde(rename = "inspect")]
    Inspect { candidate_id: String },
    #[serde(rename = "promote")]
    Promote {
        request: CandidatePromotionRequest,
        #[serde(default)]
        initial_cancellation_reason: Option<String>,
    },
    #[serde(rename = "discard")]
    Discard {
        request: CandidateDiscardRequest,
        #[serde(default)]
        initial_cancellation_reason: Option<String>,
    },
}

struct InitialCancellation(Option<String>);

impl Cancellation for InitialCancellation {
    fn reason(&self) -> Option<String> {
        self.0.clone()
    }
}

#[derive(Debug)]
pub struct CandidateBridgeFailure {
    pub request_id: Option<String>,
    pub code: &'static str,
    pub message: String,
}

pub fn execute(
    frame: &[u8],
    writer: &mut BufWriter<std::io::Stdout>,
) -> Result<(), CandidateBridgeFailure> {
    if frame.len() > MAX_CANDIDATE_START_FRAME_BYTES {
        return Err(CandidateBridgeFailure {
            request_id: None,
            code: "candidate_start_too_large",
            message: "Candidate lifecycle start frame exceeded the configured limit.".to_owned(),
        });
    }
    let start: CandidateStart =
        serde_json::from_slice(frame).map_err(|_| CandidateBridgeFailure {
            request_id: None,
            code: "invalid_candidate_start",
            message: "Invalid candidate lifecycle start JSON.".to_owned(),
        })?;
    let request_id = Some(start.request_id.clone());
    if start.message_type != "candidate.start"
        || start.protocol_version != CANDIDATE_PROTOCOL_VERSION
        || start.request_id.trim().is_empty()
    {
        return Err(CandidateBridgeFailure {
            request_id,
            code: "invalid_candidate_start",
            message: "Candidate lifecycle start identity is invalid.".to_owned(),
        });
    }
    let mut config =
        CandidateLifecycleConfig::new(start.config.repository_root, start.config.candidate_parent);
    if let Some(value) = start.config.candidate_lease_root {
        config.candidate_lease_root = value;
    }
    if let Some(value) = start.config.git_executable {
        config.git_executable = value;
    }
    if let Some(value) = start.config.max_diff_bytes {
        config.max_diff_bytes = value;
    }
    let service =
        CandidateLifecycleService::try_new(config).map_err(|message| CandidateBridgeFailure {
            request_id: Some(start.request_id.clone()),
            code: "invalid_candidate_config",
            message,
        })?;

    let (operation, payload) = match start.operation {
        CandidateOperation::Inspect { candidate_id } => match service.inspect(&candidate_id) {
            Ok(artifact) => ("inspect", json!({ "success": true, "artifact": artifact })),
            Err(message) => ("inspect", json!({ "success": false, "error": message })),
        },
        CandidateOperation::Promote {
            request,
            initial_cancellation_reason,
        } => {
            let artifact =
                service.promote(&request, &InitialCancellation(initial_cancellation_reason));
            ("promote", json!({ "success": true, "artifact": artifact }))
        }
        CandidateOperation::Discard {
            request,
            initial_cancellation_reason,
        } => {
            let artifact =
                service.discard(&request, &InitialCancellation(initial_cancellation_reason));
            ("discard", json!({ "success": true, "artifact": artifact }))
        }
    };
    send_json(
        writer,
        &json!({
            "type": "candidate.result",
            "protocolVersion": CANDIDATE_PROTOCOL_VERSION,
            "requestId": start.request_id,
            "operation": operation,
            "result": payload,
        }),
    )
    .map_err(|message| CandidateBridgeFailure {
        request_id: None,
        code: "candidate_result_write_failed",
        message,
    })
}
