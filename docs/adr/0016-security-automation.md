# ADR 0016: Public security checks and private AI audits

- **Status**: Accepted 2026-11-05.
- **Scope**: Dependency upkeep, security checks, and AI audit publication.

## Context

GitHub Actions logs and artifacts in a public repository are readable by the public. Unfixed AI audit findings must remain private.

## Decision

Deterministic checks and dependency bumps based on public advisories run in `oboroxyz/fuda-sh`. The Cloudflare `security-audit` skill runs from the private `oboroxyz/fuda-sh-staff` repository. Audit fixes reach the public repository only after a person decides to publish them.

## Consequences

The AI audit starts on demand. Add a monthly schedule after measuring the first run's cost. Dependabot PRs exclude the independent Subgraph, Substreams crates, and the Vite+ package group, which require coordinated manual updates.
