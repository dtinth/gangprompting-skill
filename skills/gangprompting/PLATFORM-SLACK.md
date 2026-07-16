# Gangprompting on Slack

Slack has no bundled bridge — you build one to the same interface as [`discord-agent-bridge.ts`](discord-agent-bridge.ts): the `read` / `send` / `monitor` commands, one JSON object per line. This file covers only the Slack-specific parts — the app and token to create, the scopes to request, and how to subscribe to messages. Everything else (behaviour, memorizing the setup) follows [`SETUP.md`](SETUP.md) and [`SKILL.md`](SKILL.md) unchanged.

## Build an internal app

Create the app at [api.slack.com/apps](https://api.slack.com/apps) as an **internal app** — installed only to your own workspace, not distributed or listed on the Slack Marketplace. This matters for rate limits: internal (and Marketplace-approved) apps keep the standard tiers, while newly-created *distributed* non-Marketplace apps were capped hard on `conversations.history` in 2025 (about 1 request/min). An internal app stays at **Tier 3 — 50+ requests/min**, which is what makes polling comfortable below.

Use the **bot token** (`xoxb-…`), and invite the bot to each channel it should see — Slack only shows a bot the channels it's a member of.

## Scopes

Request the bot scopes for every feature you'll build *upfront* — adding one later means a reinstall:

| Feature | Scopes |
|---|---|
| send | `chat:write` |
| read / monitor / backfill | `channels:history`, `channels:read` (add `groups:history`, `groups:read` for private channels) |
| resolve author ids to display names | `users:read` |
| upload / download files | `files:write`, `files:read` |

`users:read` is the easy one to miss: without it, `users.info` fails with `missing_scope`, and a bridge that catches the error and falls back to the raw user id makes it look like a name-resolver bug rather than a scope gap. Verify what's actually granted before calling the bridge ready — `auth.test` returns the granted scopes in the `x-oauth-scopes` response header; diff that against the table.

## Subscribe: poll by default

The lightweight default is **polling** `conversations.history` on an interval (and `conversations.replies` for threads), tracking the latest seen `ts` and requesting only newer messages each time — exactly as the Discord bridge tracks the last message id. It fits gangprompting well:

- **No central coordinator** — each agent polls its own channel independently.
- **Nothing persistent to keep alive** — just periodic REST calls, the same shape as the Discord bridge's `monitor`.

The cost is delay: messages arrive at most one poll interval late. At Tier 3 (50+/min for an internal app) you can poll every few seconds and stay well within budget, so the lag is a few seconds — fine for a team assistant.

## Optional optimization: Socket Mode

For immediate delivery instead of a poll interval, enable **Socket Mode** — Slack pushes events over a WebSocket as they happen. Offer this as an upgrade once polling works, not as the starting point, because it adds moving parts:

- It needs an **app-level token** (`xapp-…`) with the `connections:write` scope — separate from the bot token, and easy to confuse with the bot scopes above.
- Slack allows **one Socket Mode connection per app**, which doesn't fit "one bridge process per channel." When several channels or agents must share one app, run a single **ingest daemon** that holds the socket and writes every event into a shared store (e.g. SQLite); `read` / `monitor` then become local queries scoped by channel, with no per-consumer subscription bookkeeping. Only reach for this when the one-connection limit actually bites.

(A third mechanism, the **Events API**, pushes events to an HTTP endpoint — but it needs a public HTTPS URL, which an agent in a devbox usually can't provide, so it's rarely the right fit here.)
