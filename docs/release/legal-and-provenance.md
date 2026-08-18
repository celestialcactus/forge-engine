# Trusted alpha legal and provenance gate

Forge-authored distributions now use Apache-2.0. The complete root `LICENSE`, root
`NOTICE`, npm metadata, Cargo metadata, and native package staging are aligned.
That selection does not prove that every existing contribution can be licensed by
the current maintainer: repository administration or commit authorship alone is
not proof of copyright ownership. Contributor/employer/third-party rights
attestation therefore remains a pre-publication gate.

Before publishing a public package or native artifact, the authorized
maintainer must record or verify:

1. authority to license the existing contributions and any employer or third-party
   clearance required;
2. copyright attribution and release scope for the TypeScript and Rust
   components;
3. dependency license compatibility for the exact lockfile versions;
4. generated `NOTICE` content for bundled third-party material; and
5. provenance for each platform artifact, including source commit, toolchain,
   build command, checksum, and signer.

ADR-0032 defines the exact-version native package topology. ADR-0036 accepts
Windows x64 and macOS ARM64/x64 as trusted-alpha targets, with Ubuntu x64 as a
compatibility/CI target rather than a support promise. Hosted evidence and artifact
provenance still have to prove each published target. Until the rights, dependency,
notice, and provenance gates close, describe artifacts as private trusted-alpha
acceptance candidates rather than a generally published release.
