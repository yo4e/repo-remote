# Security

`repo-remote` is a policy boundary around a credential that can modify narrowly allowlisted repository settings, manage narrowly scoped GitHub Wiki pages, and, when the optional cleanup path is enabled, delete narrowly proven branch refs in other repositories. Treat configuration changes to the workflow, command schema, parser, Wiki runtime, branch-cleanup planner, and token permissions as security-sensitive.

## Authentication and minimum permissions

Prefer a fine-grained personal access token with access to only the repositories that `repo-remote` must control. Grant only the permissions required by the operations you enable:

- **Administration: Read and write** for supported repository metadata, template-setting changes, and `delete_branch_on_merge`
- **Contents: Read-only** for `wiki.read` / `wiki.list` when no Wiki write capability is needed
- **Contents: Read and write** for `wiki.upsert` and `branch_cleanup`
- **Pull requests: Read-only** only for `branch_cleanup`, for merged/open PR evidence

`delete_branch_on_merge` uses GitHub's allowlisted Update a repository endpoint and does not directly delete a ref, so enabling or disabling **Automatically delete head branches** does not require Contents write by itself. GitHub documents Contents write as the required permission for [Delete a reference](https://docs.github.com/en/rest/git/refs#delete-a-reference), Contents read for [List branches](https://docs.github.com/en/rest/branches/branches#list-branches), and Pull requests read for [List pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests). Wiki operations use the Wiki's Git repository and therefore require repository Contents access appropriate to the requested read/write behavior. Contents write can modify substantially more repository state than repo-remote exposes. Keep **Selected repositories** as the token's repository access, and treat the schema, parser, fixed Wiki remote derivation, Wiki filename/content guards, pure branch candidate planner, derived endpoint construction, and workflow gates as the narrower allowlist. No arbitrary Contents operation, ref, REST path, Git remote, or filesystem path is accepted.

Store the token as the Actions secret `REPO_REMOTE_TOKEN`. Do not place it in Issues, repository variables, workflow inputs, comments, artifacts, or source files. Prefer a short practical expiry, rotate the token periodically, and revoke it immediately if exposure is suspected. After rotation, replace the `REPO_REMOTE_TOKEN` repository/environment secret before retrying commands. Do not switch from **Selected repositories** to **All repositories** merely to reduce maintenance friction.

A GitHub App should be preferred in the future when its setup cost is justified, because installation tokens can provide a smaller and more revocable blast radius than a long-lived PAT.

## Who may issue commands

A command is considered only when the Issue has the label `repo-remote:command`.

Both the Issue author and the account that triggered the current Issue event must be either:

1. the control repository owner, or
2. explicitly listed in the repository Actions variable `ALLOWED_ACTORS`.

Requiring both prevents an unauthorized collaborator from editing or labeling an authorized user's command Issue and causing that changed packet to execute. Closed Issues are also rejected so the audit trail cannot be re-executed by later edits or label changes. Manual workflow re-runs are rejected as well; retry a failed command by correcting or relabeling the open Issue so a fresh event creates a new run.

`ALLOWED_ACTORS` is a JSON array of GitHub logins, for example:

```text
["alice","octocat"]
```

Leave the variable unset or set it to `[]` to keep the default owner-only policy. Invalid JSON fails closed because the workflow condition cannot authorize the job.

Do not use the label as the only authorization mechanism. The actor allowlist is an independent gate.

## Command validation

Commands use the versioned schema in `schemas/command-v1.schema.json` and must include `"version": 1`. Unknown keys are rejected. The runtime validator intentionally supports only the JSON Schema keywords used by the checked-in schema and refuses unsupported schema keywords, keeping the policy surface small and dependency-free.

Before schema validation proceeds, the raw Issue body is limited to **131,072 UTF-8 bytes** and parsed JSON is limited to **16 levels of depth** and **512 JSON value nodes**. These global guards complement field-specific limits such as topic counts, branch `keep` entries, page names, and Wiki content. Oversized or intentionally complex payloads therefore fail before the PAT-bearing step even when their eventual schema error would otherwise be harmless.

Repository-setting PATCH payloads are built only from individually allowlisted fields. `delete_branch_on_merge` is a strict boolean and therefore cannot be used to inject an arbitrary repository setting, HTTP method, host, or API path. The parser also enforces semantic checks that are awkward to express safely in the schema, including owner matching, allowed homepage protocols, safe `keep` entries, standalone cleanup commands, and explicit `confirm: true` for non-dry-run cleanup. Missing confirmation therefore fails in the PAT-free validation step.

Wiki commands use only the explicit operation names `wiki.upsert`, `wiki.read`, and `wiki.list` plus a bounded `params` object. Wiki commands must be standalone and cannot be mixed with metadata or branch cleanup. `wiki.upsert` may use `dry_run: true` for PAT-free validation; `wiki.read` and `wiki.list` are already read-only and reject `dry_run` to avoid ambiguous execution semantics.

## GitHub Wiki boundary

The Wiki remote is constructed exclusively from the already validated owner/repository as:

```text
https://github.com/<owner>/<repo>.wiki.git
```

Issue input cannot provide or override a Git remote, URL, host, protocol, filesystem path, or branch. The token is passed to Git through process environment configuration for an HTTPS Authorization header, not embedded in the remote URL or command arguments. Git is executed with `spawn` and `shell: false`; Wiki content is written with Node file APIs and is never interpolated into shell commands.

The first implementation supports root-level Markdown pages only. Wiki page names are normalized to a single `.md` filename and reject path separators, traversal-like `..`, hidden-dot filenames, trailing dots, control characters, and GitHub's documented problematic filename characters (`\\ / : * ? " < > |`). The final resolved page path must remain directly inside an ephemeral Wiki checkout. Content is limited to 48,000 UTF-8 bytes and Wiki audit output to 60,000 bytes.

GitHub exposes a Wiki's Git repository only after an initial page has been created. If clone reports that the `.wiki.git` repository is missing, repo-remote fails with explicit instructions to create the first page in the target repository's Wiki tab and retry. For private repositories, the same class of failure can also indicate insufficient token access, which is reported as an access/setup problem rather than causing a fallback to another remote.

`wiki.upsert` does not force-push. After a normal push rejection caused by concurrent movement, repo-remote performs one `pull --rebase` against the cloned Wiki branch and retries once. A real conflict fails closed. The implementation never rewrites Wiki history to win a conflict.

`wiki.rename` and `wiki.delete` are not implemented in this security boundary. They remain future destructive operations and require their own explicit confirmation and review before being enabled.

See [docs/wiki-operations.md](docs/wiki-operations.md) for protocol examples and operator behavior.

## Merged-branch cleanup boundary

`branch_cleanup` supports only `mode: "merged"`. Branch names from the Issue are used only as a validated `keep` list and can never authorize deletion. Candidate branch names come from GitHub's current branch listing, and the deletion endpoint is constructed internally as a URL-encoded `refs/heads/<candidate>` path.

A candidate is eligible only when all of these facts hold:

- it is not the current default branch, protected, or in `keep`;
- it has no open PR whose `head.repo.full_name` and `head.ref` exactly identify that branch in the target repository;
- GitHub records a PR with `merged_at`, an exact same-repository head, the current default as base, and a PR head SHA equal to the current branch SHA.

The SHA equality prevents a merged branch name that was reused or advanced after merge from authorizing deletion of newer commits. Before each DELETE, repo-remote fetches the PR evidence again, checks open PRs again, resolves the current default again, and fetches the current branch head/protection state again. If any fact changed, the branch is skipped. The GitHub endpoint also refuses default-branch deletion, providing a final server-side guard against the unavoidable race between the last check and DELETE.

Git ancestry, branch-name similarity, fork PRs, closed-unmerged PRs, merges into non-default bases, tags, arbitrary refs, explicit PR-less deletions, wildcards, prefixes, and age rules are never deletion evidence. Planning is bounded to 200 current branches and 5,000 PR records, and the Issue audit report is bounded to 60,000 bytes; larger operations fail closed before deletion.

For routine future branch hygiene, prefer `delete_branch_on_merge: true` over repeated cleanup commands. It changes only GitHub's repository-level automatic head-branch deletion setting; it does not retroactively remove already-stale branches and it does not broaden repo-remote to arbitrary ref deletion.

## Secret handling and audit evidence

The workflow first captures bounded audit evidence and then validates the Issue body in steps that do not receive `REPO_REMOTE_TOKEN`. Dry runs also execute without the PAT, and the runtime deliberately discards an accidentally supplied PAT for every dry run. Branch-cleanup dry runs use only public GitHub reads, so a target that is not publicly readable fails rather than receiving the PAT. `wiki.upsert` dry runs are validation-only and do not clone the Wiki. `wiki.read` and `wiki.list` execute in the validated PAT-bearing step so they can read private target Wikis when permitted.

Every run records a SHA-256 fingerprint of the raw Issue body and its UTF-8 byte length before validation. For successful commands, the Issue comment uses the validated target, resolved operation, dry-run status, changed-resource list, fingerprint, and Actions run URL. For failures, it uses only bounded, syntactically safe **unvalidated hints** when they can be extracted without trusting the request. The full command body, Authorization material, raw API responses, and Git credential configuration are not copied into the audit comment.

The payload fingerprint is evidence for correlating an Issue body with an Actions run; it is not a secret-hiding mechanism. Command Issues are already visible according to the control repository's visibility, so secrets must never be placed in the body in the first place.

Runtime errors are reported without stack traces. Token values, Bearer credentials, Basic credentials used by Git HTTPS auth, and Authorization header contents are redacted before log output. Cleanup and Wiki result bodies remain separately bounded before they can be written to an Issue comment.

## Workflow hardening

The command workflow:

- listens only to Issue events;
- requires the explicit `repo-remote:command` label;
- authorizes both the Issue creator and the current event actor before the job runs;
- refuses to execute closed Issues or manual re-runs of an old command event;
- uses minimal `GITHUB_TOKEN` permissions (`contents: read`, `issues: write`);
- captures request evidence before validation without receiving the cross-repository PAT;
- never exposes the cross-repository PAT to pull-request workflows;
- validates before the PAT-bearing step;
- does not provide the PAT to dry runs, and validates destructive confirmation before the PAT-bearing step;
- uses a per-Issue concurrency group and a short job timeout.

For higher-risk installations, configure a protected GitHub Environment with required reviewers and move `REPO_REMOTE_TOKEN` to that environment. This is optional because it adds a human approval gate to every real mutation.

## Repository policy and supply-chain controls

The repository checks in `.github/CODEOWNERS` coverage for the primary policy boundary: `.github/workflows/**`, `scripts/**`, `schemas/**`, `SECURITY.md`, and the policy files themselves. CODEOWNERS records review ownership, but it does **not** enforce review by itself. Enforcement depends on branch-protection or ruleset settings in GitHub.

Recommended protection for `main` is:

- require changes through pull requests for non-trivial code/policy changes;
- require the normal CI status before merge;
- disable force pushes;
- disable branch deletion;
- require Code Owner review only when an independent reviewer is actually available.

For an owner-only repository, forcing Code Owner approval can make the owner unable to approve their own PR. In that case, keep CODEOWNERS as documentation/routing and do not enable a review rule that cannot be satisfied. If maintainership expands, enable required Code Owner review once at least one independent reviewer can reliably serve the protected paths.

Dependency and static-analysis controls are also checked in:

- third-party Actions are pinned to full commit SHAs and a regression test rejects mutable `uses:` refs;
- Dependabot checks the `github-actions` ecosystem weekly so pinned SHAs can be refreshed through reviewable PRs;
- CodeQL analyzes the JavaScript codebase on main/PR activity and on a weekly schedule.

OpenSSF Scorecard is **not enabled by default** for this small repository. It adds another workflow, permissions, and publication/alerting surface, while the immediately useful controls are already covered by full-SHA pins, Dependabot, CodeQL, CODEOWNERS, and CI. Reconsider Scorecard when repo-remote is cut as a broader public release or gains external consumers for whom a published score provides concrete value.

Repository-host settings are deliberately distinct from checked-in policy. The current connector/runtime cannot guarantee that a repository owner has enabled every recommended protection, so deployment reviews should verify those GitHub settings separately.

## Operational risks and maintenance

Each copy of repo-remote runs in its own repository and therefore uses that repository owner's GitHub Actions account and policy. A template/copy does not inherit the original repository's `REPO_REMOTE_TOKEN`. Actions billing, included minutes, and public/private-repository treatment are GitHub service policy and can change; operators should check current GitHub documentation instead of relying on a fixed cost assumption in repo-remote documentation.

The command label and authorization condition prevent unauthorized Issues from reaching the privileged job, but public Issue traffic can still generate webhook/workflow evaluation and notification noise. The five-minute timeout and per-Issue concurrency group bound individual executions, not total public event volume. If event spam becomes material, use GitHub's repository moderation/settings in addition to repo-remote's execution policy.

Use a protected Environment with required reviewers when mutation approval is worth the added friction. Use owner-only `ALLOWED_ACTORS` by default. Review repository access whenever the PAT is rotated or a new target repository is added, and remove repositories that repo-remote no longer needs to control.

## Scope boundaries

The current release supports repository description, homepage, topics, template-setting toggles, the `delete_branch_on_merge` automatic head-branch deletion setting, the fixed merged-branch cleanup described above, and the explicit `wiki.upsert` / `wiki.read` / `wiki.list` family. It does not accept arbitrary REST paths, shell commands, git remotes, repository deletion, visibility changes, transfers, arbitrary branch deletion, user-selected refs, branch protection/ruleset changes, ref updates, tags, arbitrary Contents operations, force pushes, Wiki rename/delete, or arbitrary Wiki filesystem paths.

## Reporting a vulnerability

Do not include secrets or exploit credentials in a public Issue. If a report would expose sensitive material, rotate/revoke the affected credential first and use a private reporting channel supported by the repository owner.
