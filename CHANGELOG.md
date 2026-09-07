# Changelog

All notable changes to `repo-remote` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and tagged releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Versioned, schema-validated Issue command protocol with owner/actor authorization and dry-run support.
- Allowlisted repository metadata/settings operations, including description, homepage, topics, template mode, and automatic merged-head-branch deletion.
- Safe merged-branch cleanup with explicit confirmation and PR-based merge evidence.
- Git-backed Wiki `list`, `read`, and `upsert` operations with traversal guards, bounded content, credential redaction, and fixed derived remotes.
- Security documentation, regression tests, and pinned third-party Actions.
- Global command resource limits for Issue-body bytes, JSON depth, and JSON node count.
- Structured audit evidence with validated success metadata, bounded failure hints, payload fingerprints, and run links.
- CODEOWNERS coverage, weekly GitHub Actions Dependabot updates, and CodeQL analysis.

### Fixed

- Prevent duplicate command execution when an Issue is created with the command label already attached.

### Deferred

- Live Wiki write rollout is intentionally deferred while a lower-friction, lower-blast-radius authentication model is evaluated.
- OpenSSF Scorecard remains optional until a broader public release or external-consumer need justifies the extra workflow/publishing surface.
