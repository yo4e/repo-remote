# Changelog

All notable changes to `repo-remote` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and tagged releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Versioned, schema-validated Issue command protocol with owner/actor authorization and dry-run support.
- Allowlisted repository metadata/settings operations, including description, homepage, topics, template mode, and automatic merged-head-branch deletion.
- Safe merged-branch cleanup with explicit confirmation and PR-based merge evidence.
- Git-backed Wiki `list`, `read`, and `upsert` implementation with traversal guards, bounded content, credential redaction, and fixed derived remotes.
- Security documentation, regression tests, and pinned third-party Actions.
- Global command resource limits for Issue-body bytes, JSON depth, and JSON node count.
- Structured audit evidence with validated success metadata, bounded failure hints, payload fingerprints, and run links.
- CODEOWNERS coverage, weekly GitHub Actions Dependabot updates, and CodeQL analysis.

### Changed

- Documentation now distinguishes the feature-complete stable core from retained/deferred capabilities.
- The project is treated as maintenance-mode infrastructure for its current scope: use it, fix defects, and widen the operation allowlist only when a recurring need justifies the additional policy surface.
- Wiki commands remain implemented but are no longer presented as part of the recommended baseline deployment.

### Fixed

- Prevent duplicate command execution when an Issue is created with the command label already attached.

### Deferred

- Live Wiki rollout and further Wiki work remain deferred because the Git-backed path adds token-scope and repository-selection friction for limited current benefit.
- GitHub App authentication remains a future option if repo-remote grows enough that long-lived PAT management becomes operationally awkward.
- Archive/unarchive remains a low-frequency future operation and is intentionally not part of the current allowlist.
- OpenSSF Scorecard remains optional until broader distribution or external-consumer need justifies the extra workflow/publishing surface.

### Release note

No tag or version bump is implied by this maintenance-status cleanup. Release/version decisions remain explicit future actions.
