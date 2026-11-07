# ADR 0016: Public security checks and private AI audits

- **Status**: Accepted 2026-11-05. The private AI audit workflow was removed on 2026-11-07; the publication rule below still applies.
- **Scope**: Dependency upkeep, security checks, and AI audit publication.

## Context

GitHub Actions logs and artifacts in a public repository are readable by the public. Unfixed AI audit findings must remain private.

## Decision

Deterministic checks and dependency bumps based on public advisories run in `oboroxyz/fuda-sh`. The Cloudflare `security-audit` skill runs from the private `oboroxyz/fuda-sh-staff` repository. Audit fixes reach the public repository only after a person decides to publish them.

## Consequences

No AI audit runs from CI. Dependabot PRs exclude the independent Subgraph, Substreams crates, and the Vite+ package group, which require coordinated manual updates. Only direct development dependencies at minor or patch versions merge automatically after CI passes, because a runtime minor update can still change behavior: the `viem` update in #63 brought in an `ox` release that imports a Node built-in in the frontend builds.
