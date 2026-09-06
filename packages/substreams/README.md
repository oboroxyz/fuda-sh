# Substreams packages

This directory groups independently built Rust/Substreams packages. Its children are not pnpm workspace
packages; build and test them with the commands documented in each package.

- `erc5564` extracts raw ERC-5564 Announcer events.
- `erc5564-eas-pipeline` composes that reusable output with raw EAS events.

The packaged streams support live submission and demo flows. Product reads use the independently deployed
rights subgraph under `subgraphs/rights`; they do not depend on a permanent Substreams sink.
