# Subgraphs

This directory groups independently installed and built Graph subgraphs. Its nested packages are not pnpm
workspace members; use the root `graph:*` scripts, which invoke each package with `--ignore-workspace`.

- `rights` indexes fuda rights, delegations, attendance records, revocations, and raw ERC-5564 announcements.
