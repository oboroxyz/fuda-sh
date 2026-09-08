# Graph transport consolidation design

Status: proposed for review; behavior-preserving refactor.

## Decision

Use existing `postGraph` from `fetchAnnouncements`. This removes duplicated fetch, HTTP status checks, JSON parsing and Valibot validation without adding a new file or public interface. Keep announcement pagination separate from ID-only pagination: their cursor semantics differ.

## Constraints

- Keep all SDK exports, signatures, error messages, query strings, and PAGE_SIZE = 1000 unchanged.
- Preserve announcement `(afterBlock, afterId)` cursor semantics, inclusive fromBlock behavior, final sorting, and bigint precision.
- Preserve ID-only pagination for rights, attendances, and delegations.
- Preserve AbortSignal forwarding and rejection of GraphQL errors even alongside partial data.
- Add no dependencies, retries, caches, cursor redesign, or workspace packages.

## Acceptance

The existing 25 graph tests and an exact request-envelope assertion pass. Announcement HTTP parsing has one implementation shared with other queries; page extraction and GraphQL-error handling stay with the existing caller. Canonical specifications do not change. Live Graph ordering validation is outside this extraction.
