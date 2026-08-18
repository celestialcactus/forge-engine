# ForgeEngine release profiles and permitted claims

**Status:** authoritative delivery vocabulary for ForgeEngine V1
**Date:** 2026-08-17

Forge must describe the product a developer actually receives. Passing a stronger
gate in one provider or operating system does not silently upgrade another profile.

| Profile | Intended users | Installation | Mutation and providers | Containment claim | Minimum exit gate |
| --- | --- | --- | --- | --- | --- |
| Source dogfood | Forge contributors | Repository checkout and locally built Rust/TypeScript artifacts | Governed changes through accepted transaction authority; explicitly selected local/cloud inference | None. Runs inherit the launching user's host permissions in `trusted` mode. | Documented source setup, local checks, exact limitations, and recoverable test workflow. |
| Trusted developer alpha | Invited external developers | Clean, versioned install on the declared Windows/macOS target matrix | Governed read/change/test workflow; local inference first-class and cloud escalation explicit | None. `trusted` is not a sandbox. `host_managed` and `restricted` remain unavailable unless separately accepted. | Install/run/update/uninstall smoke, actionable `doctor`, effective-config output, tester kit, hosted target checks, root license/provenance, and truthful documentation. |
| Restricted beta | Developers evaluating native containment | Versioned and preferably signed packages for each accepted provider/OS pair | Same Forge capability, policy, transaction, and evidence contracts as trusted mode | Only the exact provider/OS/control combination that passed adversarial and lifecycle gates. No fallback to trusted execution. | Provider setup/upgrade/uninstall, filesystem/network/credential/descendant/resource controls, cancellation/recovery/residue, compatibility, performance, and negative-selection tests pass. |
| Enterprise pilot | Organization-managed pilot users | Managed, version-pinned distribution with rollback and audit export | Host policy facts may tighten Forge policy; local/cloud routing remains explicit and attributable | Restricted-provider claims plus the named organizational controls. Host assertions alone are not containment. | Restricted beta plus policy distribution, durable audit export, credential integration, upgrade/rollback, support matrix, threat model, and organization acceptance. |

## Cross-profile rules

- The Rust runtime remains the decision and evidence authority in every profile.
- TypeScript, MCP, IDE, and provider adapters report facts and present workflows;
  they do not manufacture a stronger posture.
- A trusted-alpha success is not restricted-beta evidence.
- A restricted result is accepted only for the exact provider version, platform,
  controls, policy digest, and lifecycle receipt tested.
- Local inference is not sandboxed by default. The sandbox wraps governed
  capability execution unless a future profile explicitly says otherwise.
- Unsupported or unavailable containment fails closed. There is no silent fallback.
- Public documentation must name signing, notarization, provenance, and support
  status rather than imply them from a package format.

## Accepted trusted-alpha target matrix

This matrix bounds package publication and hosted acceptance. A native package
template or successful ad hoc build does not create a support promise.

| Target | Alpha support | Native payload | Hosted clean-install evidence | Signing/notarization | Owner |
| --- | --- | --- | --- | --- | --- |
| Windows x64 | Supported for alpha after gate | Required | Pending replay/hosted gate | Pending/not claimed | Release lane |
| Windows ARM64 | Deferred/unsupported | Do not publish | Not required | Not claimed | Future evidence gate |
| macOS ARM64 | Supported for alpha after gate | Required | Pending hosted gate | Pending/not claimed | Release lane |
| macOS x64 | Supported for alpha after gate | Required | Pending hosted gate | Pending/not claimed | Release lane |
| Ubuntu x64 | Compatibility/CI only | CI artifact permitted; no alpha support promise | Pending replay/hosted gate | Not claimed | Release lane |
| Linux ARM64 | Deferred/unsupported | Do not publish | Not required | Not claimed | Future evidence gate |

An unchecked target is unsupported, not best-effort supported.

## License and rights posture

Forge-authored distributions use Apache-2.0, and root/npm/Cargo/native-package
metadata must remain consistent. Before public publication, the maintainer still
must attest that they are authorized to license every existing contribution and
identify any employer or third-party rights requiring clearance. License selection
does not prove ownership.
