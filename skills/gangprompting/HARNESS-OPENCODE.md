# Gangprompting on OpenCode

> **Applies to OpenCode v1.x** (verified on 1.17). v2.x is in beta and changed the HTTP API substantially — the routes and payloads below likely won't match, so check them against the running server before relying on them.

OpenCode has no per-message background watch — there is no equivalent of Claude Code's `Monitor` tool that pings the agent per line. So you listen a different way: run the bridge's `monitor` in a **persistent tmux terminal**, pipe it through [`opencode-relay.ts`](opencode-relay.ts), and let the relay inject each incoming message into *this* OpenCode session over the HTTP API. You reply with the bridge's `send` command as usual. The relay is one-way (Discord → OpenCode); your replies go out through the bridge.

```
Discord ──monitor──▶ opencode-relay ──prompt_async──▶ OpenCode session ──send──▶ Discord
```

## Wire it up

1. **Find this session's id and the server.** OpenCode serves on `http://127.0.0.1:4096` by default. Your session id looks like `ses_…`; get it from the OpenCode client, or from `GET /session` (match on title or `directory`).
2. **Export the env** the two scripts need — the bridge's `DISCORD_TOKEN` / `DISCORD_CHANNEL` / `DISCORD_API`, plus `SESSION_ID` for the relay (and `OPENCODE_BASE` / `LOCATION` if they differ from the defaults). Keep the token in a git-safe place, as in [`SETUP.md`](SETUP.md).
3. **Start the pipeline in tmux** so it survives while you work — OpenCode's terminal tool won't hold a foreground pipe open for you:
   ```
   discord-agent-bridge.ts monitor | opencode-relay.ts
   ```
4. **Reply** by calling `discord-agent-bridge.ts send <text>` when you answer in the channel.

## OpenCode API notes

These cost real time to discover, so they're worth stating outright:

- **Routes are under `/session/…`, not `/api/session/…`.** Posting to `/api/session/…` returns the web app's HTML (the SPA) instead of JSON — a silent failure that looks like a broken endpoint.
- **`POST /session/:id/prompt_async`** sends a message and returns immediately; the session runs in the background. Its body needs a typed `parts` array — `{ "parts": [{ "type": "text", "text": "…" }] }` — not a bare `{ "text": … }`.
- Select the workspace with a **`?directory=<absolute path>`** query param.

## Behaviour

Once messages are flowing in, everything in [`SKILL.md`](SKILL.md) applies unchanged — attribute speakers, take turns like a group chat, play the role the room asks for. The relay injects each message as a single-line JSON blob prefixed with its source, so you see every field (author, attachments, timestamp), and it skips bot messages so you never echo your own replies.
