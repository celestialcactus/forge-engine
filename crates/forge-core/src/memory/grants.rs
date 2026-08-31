use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{MemoryContractError, MemoryGrantId, bounded_identifier};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCaptureMode {
    Off,
    Ask,
    Auto,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryGrantScope {
    Repository {
        workspace_id: String,
        repository_id: String,
    },
    Developer {
        actor_id: String,
    },
}

impl MemoryGrantScope {
    fn normalized(self) -> Result<Self, MemoryContractError> {
        Ok(match self {
            Self::Repository {
                workspace_id,
                repository_id,
            } => Self::Repository {
                workspace_id: bounded_identifier("workspaceId", workspace_id)?,
                repository_id: bounded_identifier("repositoryId", repository_id)?,
            },
            Self::Developer { actor_id } => Self::Developer {
                actor_id: bounded_identifier("actorId", actor_id)?,
            },
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryStandingGrant {
    pub schema_version: u8,
    pub grant_id: MemoryGrantId,
    pub actor_id: String,
    pub scope: MemoryGrantScope,
    pub mode: MemoryCaptureMode,
    pub created_at_millis: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at_millis: Option<i64>,
}

impl MemoryStandingGrant {
    pub fn new(
        actor_id: String,
        scope: MemoryGrantScope,
        mode: MemoryCaptureMode,
        created_at_millis: i64,
    ) -> Result<Self, MemoryContractError> {
        if created_at_millis < 0 {
            return Err(MemoryContractError::new(
                "memory_grant_time_invalid",
                "memory grant time must be non-negative",
            ));
        }
        let actor_id = bounded_identifier("actorId", actor_id)?;
        let scope = scope.normalized()?;
        if let MemoryGrantScope::Developer {
            actor_id: scope_actor_id,
        } = &scope
            && scope_actor_id != &actor_id
        {
            return Err(MemoryContractError::new(
                "memory_grant_actor_mismatch",
                "developer grant scope must match its actor",
            ));
        }
        let grant_id = grant_id(&actor_id, &scope);
        Ok(Self {
            schema_version: 1,
            grant_id,
            actor_id,
            scope,
            mode,
            created_at_millis,
            revoked_at_millis: None,
        })
    }

    pub fn validate_identity(&self) -> Result<(), MemoryContractError> {
        if self.schema_version != 1 {
            return Err(MemoryContractError::new(
                "memory_grant_schema_unsupported",
                "unsupported memory grant schema",
            ));
        }
        let mut reconstructed = Self::new(
            self.actor_id.clone(),
            self.scope.clone(),
            self.mode.clone(),
            self.created_at_millis,
        )?;
        if let Some(revoked_at_millis) = self.revoked_at_millis {
            if revoked_at_millis < self.created_at_millis {
                return Err(MemoryContractError::new(
                    "memory_grant_time_invalid",
                    "memory grant revocation cannot precede creation",
                ));
            }
            reconstructed.revoked_at_millis = Some(revoked_at_millis);
        }
        if reconstructed == *self {
            Ok(())
        } else {
            Err(MemoryContractError::new(
                "memory_grant_identity_mismatch",
                "memory grant identity does not match its actor and scope",
            ))
        }
    }

    pub fn is_active_auto(&self) -> bool {
        self.revoked_at_millis.is_none() && self.mode == MemoryCaptureMode::Auto
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrantIdentityMaterial<'a> {
    schema_version: u8,
    actor_id: &'a str,
    scope: &'a MemoryGrantScope,
}

fn grant_id(actor_id: &str, scope: &MemoryGrantScope) -> MemoryGrantId {
    let bytes = serde_json::to_vec(&GrantIdentityMaterial {
        schema_version: 1,
        actor_id,
        scope,
    })
    .expect("memory grant identity material serializes");
    let digest = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    MemoryGrantId(format!("memory_grant:v1:sha256:{digest}"))
}
