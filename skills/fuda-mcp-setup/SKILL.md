---
name: fuda-mcp-setup
description: Connect Claude Code to a fuda store through fuda's MCP server, so an agent can manage its cards and passes. Use when someone asks to set up, connect, register or re-approve the fuda MCP server, or wants an agent to create fuda cards, issue passes or revoke passes and the fuda tools are not available.
---

# Connect Claude Code to fuda

Connect one fuda profile to Claude Code. Two steps need the person, because they use their passkey in a browser: registering the app and approving it. Do the rest yourself, and reply in the language they write in.

Never ask for a passkey, session token or access token. The client ID is not a secret. Other agents are not tested against this server.

## 1. Check what is already there

Run `claude mcp list`.

- `fuda` shows `Connected`: go to step 5.
- `fuda` shows `Needs authentication`: go to step 4.
- `fuda` is absent: continue. Check they have a fuda account with a profile. They can create one at <https://dash.fuda.sh>.

## 2. Have the person register the app

Pick a free local port. Use 8080 unless `ss -ltn` or `lsof -i :8080` shows it taken. Then ask them to:

1. Open <https://dash.fuda.sh/apps> and sign in with their passkey.
2. Register an app named `Claude Code`, with this return address, using the port you picked:

   ```text
   http://localhost:8080/callback
   ```

3. Send you the client ID the page shows. It starts with `app_`.

Only the account that registers the app can approve it, so they must use the account that owns the store.

## 3. Add the server

Use the client ID and the same port. Keep the URL exactly as written, with no trailing slash, or approval fails.

```bash
claude mcp add --scope user --transport http --client-id <client ID> --callback-port 8080 fuda https://api.fuda.sh/mcp
```

If a `fuda` entry already exists with other values, confirm with the person, then run `claude mcp remove fuda --scope user` and add it again.

## 4. Have the person approve it

You cannot finish this step: `claude mcp login` needs an interactive terminal and a browser. Ask them to run `/mcp` in Claude Code, choose `fuda` and authenticate. In a plain terminal, `claude mcp login fuda` does the same.

On the consent page they choose which profile the agent acts for, then approve. Tell them:

- One approval covers one profile. To work on another, approve again and choose it.
- Revoking passes stays off unless they tick its box. Revoking cannot be undone, so they should tick it only if the agent needs it.
- An approval lasts 30 days, then they repeat this step. They can end it sooner from the Apps page.

## 5. Check it works

Call `list_cards`, then report the profile name and how many cards it has. If the tools are not available yet, ask them to run `/mcp` to reconnect, or start a new session.

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
| "This app sent a return address it did not register" | Port differs from the registered address | Make the port in the return address and `--callback-port` match |
| "This app is not registered with fuda" | Wrong client ID, or the app was deleted | Copy the client ID again from the Apps page |
| "The app asked for access to a server other than fuda" | The URL differs, often a trailing slash | Remove and re-add the server with the exact URL |
| A tool answers `401`, or `fuda` shows `Needs authentication` | The approval expired or was revoked | Repeat step 4 |
| A tool answers `403` `insufficient_scope` | Not approved for that action | Repeat step 4 and approve it |
| `revoke_pass` is missing | The revoke box was not ticked | Repeat step 4 and tick it, if they want this |

The full contract is in [the MCP server specification](https://github.com/oboroxyz/fuda-sh/blob/main/docs/specs/mcp.md).
