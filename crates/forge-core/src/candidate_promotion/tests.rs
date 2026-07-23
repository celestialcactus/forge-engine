use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::json;

use super::*;
use crate::{
    CandidateLeaseRegistration, HostPolicyFact, HostPolicyPosture, NoCancellation, UserConsentFact,
    UserConsentStatus,
};

static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    root: PathBuf,
    repository: PathBuf,
    candidate_parent: PathBuf,
    candidate_path: PathBuf,
    service: CandidateLifecycleService,
    record: CandidateLeaseRecord,
    before_text: &'static str,
    after_text: &'static str,
    second_before_text: &'static str,
    second_after_text: &'static str,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "forge-promotion-{}-{}",
            std::process::id(),
            FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let repository = root.join("repo");
        let candidate_parent = root.join("candidates");
        let candidate_path = candidate_parent.join("forge-test");
        fs::create_dir_all(&repository).expect("create fixture repository");
        fs::create_dir_all(&candidate_parent).expect("create candidate parent");
        git(&repository, &["init"]);
        git(&repository, &["config", "user.name", "Forge Test"]);
        git(
            &repository,
            &["config", "user.email", "forge@example.invalid"],
        );
        let before_text = "alpha\n";
        let after_text = "bravo\n";
        let second_before_text = "charlie\n";
        let second_after_text = "delta\n";
        fs::write(repository.join("sample.txt"), before_text).expect("write base file");
        fs::write(repository.join("second.txt"), second_before_text)
            .expect("write second base file");
        git(&repository, &["add", "sample.txt", "second.txt"]);
        git(&repository, &["commit", "-m", "base"]);
        let base_revision = git_text(&repository, &["rev-parse", "HEAD"]);
        git(
            &repository,
            &[
                "worktree",
                "add",
                "--detach",
                candidate_path.to_str().expect("candidate UTF-8"),
                &base_revision,
            ],
        );
        fs::write(candidate_path.join("sample.txt"), after_text).expect("write candidate file");
        fs::write(candidate_path.join("second.txt"), second_after_text)
            .expect("write second candidate file");
        let patch = git_output(
            &candidate_path,
            &["diff", "--no-ext-diff", "--no-color", "--binary", "--", "."],
        );
        let store = FileCandidateLeaseStore::try_new(
            &repository,
            &candidate_parent,
            candidate_parent.join(".forge-leases"),
        )
        .expect("lease store");
        let record = store
            .register_retained(CandidateLeaseRegistration {
                boundary_id: "boundary:test".to_owned(),
                candidate_path: candidate_path.clone(),
                base_revision,
                proposal_id: "change:test".to_owned(),
                snapshot_id: "workspace:test".to_owned(),
                changes: vec![
                    CandidateLeaseChange {
                        path: "sample.txt".to_owned(),
                        before_sha256: digest(before_text.as_bytes()),
                        after_sha256: digest(after_text.as_bytes()),
                    },
                    CandidateLeaseChange {
                        path: "second.txt".to_owned(),
                        before_sha256: digest(second_before_text.as_bytes()),
                        after_sha256: digest(second_after_text.as_bytes()),
                    },
                ],
                final_diff_sha256: digest(&patch),
            })
            .expect("retain candidate");
        let service = CandidateLifecycleService::try_new(CandidateLifecycleConfig::new(
            &repository,
            &candidate_parent,
        ))
        .expect("lifecycle service");
        Self {
            root,
            repository,
            candidate_parent,
            candidate_path,
            service,
            record,
            before_text,
            after_text,
            second_before_text,
            second_after_text,
        }
    }

    fn subject(&self) -> CandidatePromotionSubject {
        self.service
            .inspect(&self.record.candidate_id)
            .expect("inspect candidate")
            .subject
    }

    fn request(&self, subject: CandidatePromotionSubject) -> CandidatePromotionRequest {
        promotion_request(subject, HostPolicyPosture::Allow)
    }

    fn active_text(&self) -> String {
        fs::read_to_string(self.repository.join("sample.txt")).expect("read active file")
    }

    fn second_active_text(&self) -> String {
        fs::read_to_string(self.repository.join("second.txt")).expect("read second active file")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = Command::new("git")
            .current_dir(&self.repository)
            .args(["restore", "--worktree", "--", "sample.txt", "second.txt"])
            .output();
        if self.candidate_path.exists() {
            let _ = Command::new("git")
                .current_dir(&self.repository)
                .args([
                    "worktree",
                    "remove",
                    "--force",
                    self.candidate_path.to_str().unwrap_or_default(),
                ])
                .output();
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn promotion_request(
    subject: CandidatePromotionSubject,
    posture: HostPolicyPosture,
) -> CandidatePromotionRequest {
    let call_id = "call:promotion".to_owned();
    CandidatePromotionRequest {
        promotion_id: "promotion:test".to_owned(),
        call: CapabilityCall {
            id: call_id.clone(),
            capability_id: CANDIDATE_PROMOTE_CAPABILITY_ID.to_owned(),
            input: json!({
                "promotionId": "promotion:test",
                "subject": subject,
            }),
        },
        approval_facts: ApprovalFacts {
            schema_version: 1,
            call_id,
            capability_id: CANDIDATE_PROMOTE_CAPABILITY_ID.to_owned(),
            host_policy: HostPolicyFact {
                posture,
                source: "test.policy".to_owned(),
                reason: "test policy decision".to_owned(),
            },
            user_consent: UserConsentFact {
                status: UserConsentStatus::NotRequired,
                source: "test.policy".to_owned(),
                reason: "not required by test policy".to_owned(),
            },
        },
        subject,
    }
}

fn discard_request(
    subject: CandidatePromotionSubject,
    posture: HostPolicyPosture,
) -> CandidateDiscardRequest {
    let call_id = "call:discard".to_owned();
    CandidateDiscardRequest {
        discard_id: "discard:test".to_owned(),
        call: CapabilityCall {
            id: call_id.clone(),
            capability_id: CANDIDATE_DISCARD_CAPABILITY_ID.to_owned(),
            input: json!({
                "discardId": "discard:test",
                "subject": subject,
            }),
        },
        approval_facts: ApprovalFacts {
            schema_version: 1,
            call_id,
            capability_id: CANDIDATE_DISCARD_CAPABILITY_ID.to_owned(),
            host_policy: HostPolicyFact {
                posture,
                source: "test.policy".to_owned(),
                reason: "test policy decision".to_owned(),
            },
            user_consent: UserConsentFact {
                status: UserConsentStatus::NotRequired,
                source: "test.policy".to_owned(),
                reason: "not required by test policy".to_owned(),
            },
        },
        subject,
    }
}
fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .current_dir(root)
        .args(arguments)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("start Git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_output(root: &Path, arguments: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .current_dir(root)
        .args(arguments)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("start Git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

fn git_text(root: &Path, arguments: &[&str]) -> String {
    String::from_utf8(git_output(root, arguments))
        .expect("Git UTF-8")
        .trim()
        .to_owned()
}

#[test]
fn inspects_promotes_idempotently_and_discards_without_hiding_the_active_diff() {
    let fixture = Fixture::new();
    let inspection = fixture
        .service
        .inspect(&fixture.record.candidate_id)
        .expect("inspect retained");
    assert_eq!(inspection.state, CandidateLeaseState::Retained);
    assert!(inspection.candidate_valid);
    assert!(inspection.active_workspace_clean);
    assert_eq!(
        inspection.final_diff.as_ref().map(|diff| &diff.sha256),
        Some(&fixture.record.final_diff_sha256)
    );

    let request = fixture.request(inspection.subject);
    let promoted = fixture.service.promote(&request, &NoCancellation);
    assert_eq!(promoted.status, CandidatePromotionStatus::Promoted);
    assert_eq!(fixture.active_text(), fixture.after_text);
    assert_eq!(fixture.second_active_text(), fixture.second_after_text);
    assert_eq!(
        fixture
            .service
            .inspect(&fixture.record.candidate_id)
            .expect("inspect promoted")
            .state,
        CandidateLeaseState::Promoted
    );

    let repeated = fixture.service.promote(&request, &NoCancellation);
    assert_eq!(repeated.status, CandidatePromotionStatus::AlreadyPromoted);
    assert_eq!(fixture.active_text(), fixture.after_text);
    assert_eq!(fixture.second_active_text(), fixture.second_after_text);

    let discarded = fixture.service.discard(
        &discard_request(request.subject.clone(), HostPolicyPosture::Allow),
        &NoCancellation,
    );
    assert_eq!(discarded.status, CandidateDiscardStatus::Discarded);
    assert!(!fixture.candidate_path.exists());
    assert_eq!(fixture.active_text(), fixture.after_text);
    assert_eq!(fixture.second_active_text(), fixture.second_after_text);
}

#[test]
fn denial_and_subject_replay_do_not_mutate_the_active_workspace() {
    let fixture = Fixture::new();
    let subject = fixture.subject();
    let denied = fixture.service.promote(
        &promotion_request(subject.clone(), HostPolicyPosture::Deny),
        &NoCancellation,
    );
    assert_eq!(denied.status, CandidatePromotionStatus::NotAuthorized);
    assert_eq!(fixture.active_text(), fixture.before_text);

    let mut replayed_subject = subject;
    replayed_subject.proposal_id = "change:another-candidate".to_owned();
    let replayed = fixture
        .service
        .promote(&fixture.request(replayed_subject), &NoCancellation);
    assert_eq!(replayed.status, CandidatePromotionStatus::Failed);
    assert!(
        replayed
            .failure
            .as_deref()
            .is_some_and(|failure| failure.contains("durable candidate lease"))
    );
    assert_eq!(fixture.active_text(), fixture.before_text);

    let denied_discard = fixture.service.discard(
        &discard_request(fixture.subject(), HostPolicyPosture::Deny),
        &NoCancellation,
    );
    assert_eq!(denied_discard.status, CandidateDiscardStatus::NotAuthorized);
    assert!(fixture.candidate_path.exists());
}

#[test]
fn stale_active_state_and_candidate_tampering_are_rejected_before_mutation() {
    let fixture = Fixture::new();
    let request = fixture.request(fixture.subject());
    fs::write(fixture.repository.join("sample.txt"), "developer edit\n")
        .expect("write active divergence");
    let stale = fixture.service.promote(&request, &NoCancellation);
    assert_eq!(stale.status, CandidatePromotionStatus::Failed);
    assert_eq!(fixture.active_text(), "developer edit\n");

    git(
        &fixture.repository,
        &["restore", "--worktree", "--", "sample.txt"],
    );
    fs::write(fixture.repository.join("sample.txt"), fixture.before_text)
        .expect("restore exact pre-promotion bytes");
    fs::write(
        fixture.candidate_path.join("sample.txt"),
        "candidate tamper\n",
    )
    .expect("tamper candidate");
    let tampered = fixture.service.promote(&request, &NoCancellation);
    assert_eq!(tampered.status, CandidatePromotionStatus::Failed);
    assert!(
        tampered
            .failure
            .as_deref()
            .is_some_and(|failure| failure.contains("digest mismatch"))
    );
    assert_eq!(fixture.active_text(), fixture.before_text);

    fs::write(
        fixture.candidate_path.join("sample.txt"),
        fixture.after_text,
    )
    .expect("restore candidate content");
    fs::write(fixture.candidate_path.join("extra.txt"), "extra\n")
        .expect("add unapproved candidate path");
    let extra = fixture.service.promote(&request, &NoCancellation);
    assert_eq!(extra.status, CandidatePromotionStatus::Failed);
    assert!(
        extra
            .failure
            .as_deref()
            .is_some_and(|failure| failure.contains("untracked"))
    );
    fs::remove_file(fixture.candidate_path.join("extra.txt")).expect("remove extra candidate path");

    fs::remove_file(fixture.candidate_path.join("sample.txt"))
        .expect("remove approved candidate path");
    let missing = fixture.service.promote(&request, &NoCancellation);
    assert_eq!(missing.status, CandidatePromotionStatus::Failed);
    assert_eq!(fixture.active_text(), fixture.before_text);
}

struct FailCandidateApplied;
impl PromotionHook for FailCandidateApplied {
    fn reach(&mut self, point: PromotionHookPoint) -> Result<(), String> {
        if point == PromotionHookPoint::CandidateApplied {
            Err("injected failure after apply".to_owned())
        } else {
            Ok(())
        }
    }
}

#[test]
fn terminal_failure_after_apply_rolls_back_exactly() {
    let fixture = Fixture::new();
    let request = fixture.request(fixture.subject());
    let artifact =
        fixture
            .service
            .promote_with_hook(&request, &NoCancellation, &mut FailCandidateApplied);
    assert_eq!(artifact.status, CandidatePromotionStatus::Recovered);
    assert_eq!(fixture.active_text(), fixture.before_text);
    assert!(
        fixture
            .service
            .workspace_clean(&fixture.repository)
            .unwrap()
    );
    assert_eq!(
        fixture
            .service
            .inspect(&fixture.record.candidate_id)
            .expect("inspect retained after recovery")
            .state,
        CandidateLeaseState::Retained
    );
}

struct FailAfterFirstPath;
impl PromotionHook for FailAfterFirstPath {
    fn reach(&mut self, point: PromotionHookPoint) -> Result<(), String> {
        if point == PromotionHookPoint::PathReplaced(0) {
            Err("injected failure after first path".to_owned())
        } else {
            Ok(())
        }
    }
}

#[test]
fn partial_multi_file_failure_rolls_back_every_promoted_path() {
    let fixture = Fixture::new();
    let request = fixture.request(fixture.subject());
    let artifact =
        fixture
            .service
            .promote_with_hook(&request, &NoCancellation, &mut FailAfterFirstPath);
    assert_eq!(artifact.status, CandidatePromotionStatus::Recovered);
    assert_eq!(fixture.active_text(), fixture.before_text);
    assert_eq!(fixture.second_active_text(), fixture.second_before_text);
    assert!(
        fixture
            .service
            .workspace_clean(&fixture.repository)
            .unwrap()
    );
}
fn leave_interrupted_apply(fixture: &Fixture, subject: CandidatePromotionSubject) {
    let record = fixture
        .service
        .lease_store
        .load(&subject.candidate_id)
        .expect("load retained record");
    let patch = fixture
        .service
        .validate_candidate_bytes(&record)
        .expect("validate candidate patch");
    fixture
        .service
        .prepare_backups(&record)
        .expect("prepare interrupted recovery backup");
    fixture
        .service
        .write_journal(&PromotionJournal {
            schema_version: JOURNAL_SCHEMA_VERSION,
            promotion_id: "promotion:interrupted".to_owned(),
            subject,
            changes: record.changes.clone(),
            created_at_unix_ms: unix_ms().expect("timestamp"),
        })
        .expect("write interrupted journal");
    assert_eq!(digest(&patch), fixture.record.final_diff_sha256);
    fixture
        .service
        .apply_exact_candidate_bytes(&record, &mut NoopPromotionHook)
        .expect("apply interrupted candidate bytes");
}

#[test]
fn restart_reconciles_an_interrupted_apply_before_returning_evidence() {
    let fixture = Fixture::new();
    let subject = fixture.subject();
    leave_interrupted_apply(&fixture, subject);
    assert_eq!(fixture.active_text(), fixture.after_text);
    assert_eq!(fixture.second_active_text(), fixture.second_after_text);

    let restarted = CandidateLifecycleService::try_new(CandidateLifecycleConfig::new(
        &fixture.repository,
        &fixture.candidate_parent,
    ))
    .expect("restart lifecycle service");
    let inspection = restarted
        .inspect(&fixture.record.candidate_id)
        .expect("reconcile interrupted promotion");
    assert!(
        inspection
            .recovery
            .as_ref()
            .is_some_and(|value| value.success)
    );
    assert_eq!(inspection.state, CandidateLeaseState::Retained);
    assert_eq!(fixture.active_text(), fixture.before_text);
    assert!(restarted.workspace_clean(&fixture.repository).unwrap());
}

#[test]
fn restart_recovery_refuses_to_overwrite_divergent_developer_content() {
    let fixture = Fixture::new();
    let subject = fixture.subject();
    leave_interrupted_apply(&fixture, subject);
    fs::write(
        fixture.repository.join("sample.txt"),
        "developer after crash\n",
    )
    .expect("write developer divergence");

    let restarted = CandidateLifecycleService::try_new(CandidateLifecycleConfig::new(
        &fixture.repository,
        &fixture.candidate_parent,
    ))
    .expect("restart lifecycle service");
    let error = restarted
        .inspect(&fixture.record.candidate_id)
        .expect_err("divergent recovery must fail");
    assert!(error.contains("refused to overwrite divergent developer content"));
    assert_eq!(fixture.active_text(), "developer after crash\n");
    assert!(
        restarted
            .journal_path(&fixture.record.candidate_id)
            .expect("journal path")
            .exists()
    );
}
