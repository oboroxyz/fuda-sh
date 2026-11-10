# Substreams packages (archived)

These two Rust/Substreams packages are archived: nothing in the product consumes them, and CI no longer builds or tests them. They are kept as they were for the ETHOnline 2026 submission, so each manifest's `doc.url` still names the old `packages/substreams` path. Build and test them with the commands documented in each package; [`SPEC.md`](./SPEC.md) describes their interfaces.

- `erc5564` extracts raw ERC-5564 Announcer events.
- `erc5564-eas-pipeline` composes that reusable output with raw EAS events.

The packaged streams supported live submission and demo flows. Product reads use the independently deployed rights subgraph under `packages/subgraphs/rights`; they never depended on a permanent Substreams sink.
