---
name: fuda-mcp-setup
description: Connect Claude Code, Codex or OpenCode to a fuda store through fuda's MCP server, so an agent can manage its cards and passes. Use when someone asks to set up, connect, register or re-approve the fuda MCP server, or wants an agent to create fuda cards, issue passes or revoke passes and the fuda tools are not available.
---

# Connect an agent to fuda

Connect one fuda profile to Claude Code, Codex or OpenCode. Two steps need the person, because they use their passkey in a browser: registering the app and approving it. Do the rest yourself, and reply in the language they write in.

Never ask for a passkey, session token or access token. The client ID is not a secret. Other agents are not tested against this server.

Use the row for the agent you are running in, or the one they name.

| Agent       | Return address              | Check               | Approve                            |
| ----------- | --------------------------- | ------------------- | ---------------------------------- |
| Claude Code | `http://localhost/callback` | `claude mcp list`   | `/mcp`, or `claude mcp login fuda` |
| Codex       | `http://127.0.0.1/callback` | `codex mcp list`    | `codex mcp login fuda`             |
| OpenCode    | `http://127.0.0.1/callback` | `opencode mcp list` | `opencode mcp auth fuda`           |

## 1. Check what is already there

Run the agent's check command.

- `fuda` is connected, or logged in with OAuth: go to step 5.
- `fuda` needs authentication, or is not logged in: go to step 4.
- `fuda` is absent: continue. Check they have a fuda account with a profile. They can create one at <https://dash.fuda.sh>.

## 2. Have the person register the app

Ask them to:

1. Open <https://dash.fuda.sh/apps> and sign in with their passkey.
2. Register an app named after the agent, with the return address from the table. Leave the port out: the agent picks a free one each time, and fuda accepts any port on this address.
3. Send you the client ID the page shows. It starts with `app_`.

Only the account that registers the app can approve it, so they must use the account that owns the store.

## 3. Add the server

Keep the URL exactly as written, with no trailing slash, or approval fails. If a `fuda` entry already exists with other values, confirm with the person before replacing it. When editing a config file, keep what is already there.

**Claude Code:**

```bash
claude mcp add --scope user --transport http --client-id <client ID> fuda https://api.fuda.sh/mcp
```

**Codex:** add this to `~/.codex/config.toml`. Do not use `codex mcp add`, which saves a generated callback address that was not registered.

```toml
[mcp_servers.fuda]
url = "https://api.fuda.sh/mcp"
oauth_resource = "https://api.fuda.sh/mcp"
scopes = ["cards:read", "cards:write", "passes:read", "passes:issue", "passes:revoke"]

[mcp_servers.fuda.oauth]
client_id = "<client ID>"
callback_url = "http://127.0.0.1/callback"
```

**OpenCode:** add this to `opencode.json` in the project. If you change the client ID later, run `opencode mcp logout fuda` first, because OpenCode keeps the earlier one.

```json
{
  "mcp": {
    "fuda": {
      "type": "remote",
      "url": "https://api.fuda.sh/mcp",
      "oauth": {
        "clientId": "<client ID>",
        "scope": "cards:read cards:write passes:read passes:issue passes:revoke"
      }
    }
  }
}
```

## 4. Have the person approve it

You cannot finish this step: approving needs an interactive terminal and a browser. Ask them to run the agent's approve command from the table.

On the consent page they choose which profile the agent acts for, then approve. Tell them:

- One approval covers one profile. To work on another, approve again and choose it.
- Revoking passes stays off unless they tick its box. Revoking cannot be undone, so they should tick it only if the agent needs it.
- An approval lasts 30 days, then they repeat this step. They can end it sooner from the Apps page.

## 5. Check it works

Call `list_cards`, then report the profile name and how many cards it has. If the tools are not available yet, ask them to start a new session.

## Using the tools

| Tool                 | Use                                                    |
| -------------------- | ------------------------------------------------------ |
| `list_cards`         | See cards, passes issued, capacity and `claimUrl`      |
| `create_card`        | Create a card. It is published at once                 |
| `update_card_limits` | Change capacity or the claim window                    |
| `list_passes`        | See passes, filtered by card, status or source         |
| `issue_pass`         | Issue one pass for a named guest and get its `passUrl` |
| `revoke_pass`        | Revoke one pass. This cannot be undone                 |

- For flyers, posts and newsletters, share `claimUrl` with `?source=<label>` added, instead of issuing passes. A pass is then issued only when someone claims it.
- Confirm with the person before `create_card` and `revoke_pass`.
- `issue_pass` costs on-chain gas, and a retry can issue a second pass. After an unclear failure, check `list_passes` first.

## When something fails

| What they see | Cause | Fix |
| --- | --- | --- |
| "Only the account that registered this app can approve it" | Signed in with another account | Sign in with the registering account, or register the app under this one |
| "This app sent a return address it did not register" | The registered address differs from the table, for example `localhost` where it should be `127.0.0.1` | Register the address from the table for this agent |
| "This app is not registered with fuda" | Wrong client ID, or the app was deleted | Copy the client ID again from the Apps page |
| "The app asked for access to a server other than fuda" | The URL differs, often a trailing slash | Remove and re-add the server with the exact URL |
| A tool answers `401`, or `fuda` shows `Needs authentication` | The approval expired or was revoked | Repeat step 4 |
| A tool answers `403` `insufficient_scope` | Not approved for that action | Repeat step 4 and approve it |
| `revoke_pass` is missing | The revoke box was not ticked | Repeat step 4 and tick it, if they want this |

The full contract is in [the MCP server specification](https://github.com/oboroxyz/fuda-sh/blob/main/docs/specs/mcp.md).
