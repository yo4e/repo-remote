# Contributing

Thanks for helping improve `repo-remote`.

## Development

Requirements:

- Node.js 20+

Install and run checks:

```bash
npm run check
npm test
```

## Security-sensitive scope

This project is a narrow policy boundary around `REPO_REMOTE_TOKEN`. Changes in these files are security-sensitive and should receive extra review:

- `.github/workflows/repo-remote.yml`
- `schemas/command-v1.schema.json`
- `scripts/command.mjs`
- `scripts/apply-command.mjs`
- `scripts/branch-cleanup.mjs`
- `scripts/security.mjs`

Do not add arbitrary REST paths, arbitrary shell execution, arbitrary git remotes, or secret-printing behavior.

## Release process

The project uses semantic versioning. Update `CHANGELOG.md` for user-visible changes and bump `package.json` version when cutting a release.
