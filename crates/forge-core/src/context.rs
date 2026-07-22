use crate::contracts::{ContextItem, ContextItemKind, ContextPlan, WorkspaceSnapshot};

fn task_item(task: &str) -> ContextItem {
    ContextItem {
        id: "task".to_owned(),
        kind: ContextItemKind::UserTask,
        locator: "run://task".to_owned(),
        bytes: task.len() as u64,
        reason: "The developer task is authoritative context.".to_owned(),
    }
}

fn file_item(path: &str, bytes: u64) -> ContextItem {
    ContextItem {
        id: format!("file:{path}"),
        kind: ContextItemKind::WorkspaceFile,
        locator: format!("workspace://{path}"),
        bytes,
        reason: "Deterministic workspace inventory selected this file.".to_owned(),
    }
}

fn compare_javascript_strings(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

pub fn compile_context(
    task: &str,
    snapshot: &WorkspaceSnapshot,
    budget_bytes: u64,
) -> Result<ContextPlan, String> {
    if budget_bytes == 0 {
        return Err("Context budget must be a positive integer.".to_owned());
    }
    let mut files = snapshot.files.clone();
    files.sort_by(|left, right| compare_javascript_strings(&left.path, &right.path));
    let mut candidates = Vec::with_capacity(files.len() + 1);
    candidates.push(task_item(task));
    candidates.extend(
        files
            .into_iter()
            .map(|file| file_item(&file.path, file.bytes)),
    );

    let mut selected = Vec::new();
    let mut omitted = Vec::new();
    let mut consumed = 0_u64;
    for candidate in candidates {
        if consumed.saturating_add(candidate.bytes) <= budget_bytes {
            consumed += candidate.bytes;
            selected.push(candidate);
        } else {
            omitted.push(candidate);
        }
    }
    Ok(ContextPlan {
        id: format!("context:{}", snapshot.id),
        budget_bytes,
        selected,
        omitted,
    })
}

pub fn required_context_bytes(task: &str, snapshot: &WorkspaceSnapshot) -> u64 {
    task.len() as u64 + snapshot.files.iter().map(|file| file.bytes).sum::<u64>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::WorkspaceFile;

    #[test]
    fn matches_javascript_utf16_path_order() {
        let snapshot = WorkspaceSnapshot {
            id: "workspace:utf16".to_owned(),
            root_label: "fixture".to_owned(),
            files: vec![
                WorkspaceFile {
                    path: "\u{e000}.ts".to_owned(),
                    bytes: 1,
                },
                WorkspaceFile {
                    path: "\u{10000}.ts".to_owned(),
                    bytes: 1,
                },
            ],
        };
        let plan = compile_context("x", &snapshot, 100).expect("context should compile");
        let locators: Vec<&str> = plan
            .selected
            .iter()
            .map(|item| item.locator.as_str())
            .collect();
        assert_eq!(
            locators,
            vec![
                "run://task",
                "workspace://\u{10000}.ts",
                "workspace://\u{e000}.ts"
            ]
        );
    }
}
