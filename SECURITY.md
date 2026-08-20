# Security

`repo-remote` is a policy boundary around a credential that can modify repository metadata in other repositories. Treat configuration changes to the workflow, command schema, parser, and token permissions as security-sensitive.

## Authentication and minimum permissions

Prefer a fine-grained personal access token with access to only the repositories that `repo-remote` must control. Grant only:

- **Administration: Read and write** on those target repositories

Store the token as the Actions secret `REPO_REMOTE_TOKEN`. Do not place it in Issues, repository variables, workflow inputs, comments, artifacts, or source files. Rotate or revoke it immediately if exposure is suspected.

A GitHub App should be preferred in the future when its setup cost is justified, because installation tokens can provide a smaller and more revocable blast radius than a long-lived PAT.

## Who may issue commands

A command is considered only when the Issue has the label `repo-remote:command`.

The Issue author must also be either:

1. the control repository owner, or
2. explicitly listed in the repository Actions variable `ALLOWED_ACTORS`.

`ALLOWED_ACTORS` is a JSON array of GitHub logins, for example:

```text
["alice","octocat"]
```

Leave the variable unset or set it to `[]` to keep the default owner-only policy. Invalid JSON fails closed because the workflow condition cannot authorize the job.

Do not use the label as the only authorization mechanism. The actor allowlist is an independent gate.

## Command validation

Commands use the versioned schema in `schemas/command-v1.schema.json` and must include `"version": 1`. Unknown keys are rejected. The runtime validator intentionally supports only the JSON Schema keywords used by the checked-in schema and refuses unsupported schema keywords, keeping the policy surface small and dependency-free.

The parser also enforces semantic checks that are awkward to express safely in the schema, including owner matching and allowed homepage protocols.

## Secret handling

The workflow validates the Issue body in a step that does not receive `REPO_REMOTE_TOKEN`. Dry runs also execute without the PAT. Only a validated, non-dry-run command reaches the mutation step where the PAT is present.

Runtime errors are reported without stack traces. Token values, Bearer credentials, and Authorization header contents are redacted before log output. Success comments contain only validated target names and operation field names.

## Workflow hardening

The command workflow:

- listens only to Issue events;
- requires the explicit `repo-remote:command` label;
- authorizes the Issue creator before the job runs;
- uses minimal `GITHUB_TOKEN` permissions (`contents: read`, `issues: write`);
- never exposes the cross-repository PAT to pull-request workflows;
- validates before the PAT-bearing step;
- does not provide the PAT to dry runs;
- uses a per-Issue concurrency group and a short job timeout.

For higher-risk installations, configure a protected GitHub Environment with required reviewers and move `REPO_REMOTE_TOKEN` to that environment. This is optional because it adds a human approval gate to every real mutation.

## Scope boundaries

The current release supports repository description, homepage, and topics only. It does not accept arbitrary REST paths, shell commands, git remotes, repository deletion, visibility changes, transfers, or branch operations.

Wiki operations are not implemented yet. When they are added, they must derive the remote exclusively from the validated owner/repository, normalize page filenames, reject traversal and remote URLs, avoid shell interpolation for page contents, and impose explicit page-size limits before any Wiki write capability is enabled.

## Reporting a vulnerability

Do not include secrets or exploit credentials in a public Issue. If a report would expose sensitive material, rotate/revoke the affected credential first and use a private reporting channel supported by the repository owner.
