use serde::{Deserialize, Serialize};

use super::{MemoryGrantId, MemoryScope};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCaptureMode {
    Off,
    Ask,
    Auto,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryStandingGrant {
    pub schema_version: u8,
    pub grant_id: MemoryGrantId,
    pub actor_id: String,
    pub scope: MemoryScope,
    pub mode: MemoryCaptureMode,
    pub created_at_millis: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at_millis: Option<i64>,
}
