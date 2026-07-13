# Gangprompting on OpenCode

> **Applies to OpenCode v1.x** (verified on 1.17). v2.x is in beta and changed the HTTP API substantially — the routes and payloads below likely won't match, so check them against the running server before relying on them.

OpenCode has no per-message background watch — there is no equivalent of Claude Code's `Monitor` tool that pings the agent per line. So you listen a different way: run the bridge's `monitor` in a **persistent tmux terminal**, pipe it through [`opencode-relay.ts`](opencode-relay.ts), and let the relay inject each incoming message into *this* OpenCode session over the HTTP API. You reply with the bridge's `send` command as usual. The relay is one-way (Discord → OpenCode); your replies go out through the bridge.

```
Discord ──monitor──▶ opencode-relay ──prompt_async──▶ OpenCode session ──send──▶ Discord
```

## Wire it up

1. **Ask the user for the server URL and the session id.** They're running the session, so they usually know both — ask first rather than guessing. The session id looks like `ses_…`. If they don't have them handy, offer to introspect as a convenience: the server is an `opencode serve` process (find its host/port with `ss -tlnp | grep opencode`, default `http://127.0.0.1:4096`), and `GET <base>/session` lists sessions to match by `title` or `directory`.
2. **Export the env** the two scripts need — the bridge's `DISCORD_TOKEN` / `DISCORD_CHANNEL` / `DISCORD_API`, plus `SESSION_ID` for the relay (and `OPENCODE_BASE` / `LOCATION` if they differ from the defaults). Keep the token in a git-safe place, as in [`SETUP.md`](SETUP.md).
3. **Start the pipeline in a detached tmux session.** This is mandatory, not a nicety: OpenCode v1 has no tool for running a command in the background at all. Its Bash tool runs each call in a fresh shell with a ~120s timeout and tears down the process group when the call returns, so `&`, `nohup`, and `disown` don't keep a watcher alive. A detached tmux session is the only durable primitive. Launch the whole pipe in one shot — don't juggle windows and `send-keys`:
   ```
   tmux new-session -d -s gangprompt \
     'source /path/to/gangprompt.env && discord-agent-bridge.ts monitor | opencode-relay.ts'
   ```
4. **Tell the user you're now listening through tmux, and name the session** (`gangprompt` above) so they can look in or take over. Give them the handles:
   - watch live: `tmux attach -t gangprompt` (detach again with `Ctrl-b` then `d`)
   - peek once without attaching: `tmux capture-pane -pt gangprompt`
   - stop listening: `tmux kill-session -t gangprompt`
5. **Reply** by calling `discord-agent-bridge.ts send <text>` when you answer in the channel.

## OpenCode API notes

These cost real time to discover, so they're worth stating outright:

- **Routes are under `/session/…`, not `/api/session/…`.** Posting to `/api/session/…` returns the web app's HTML (the SPA) instead of JSON — a silent failure that looks like a broken endpoint.
- **`POST /session/:id/prompt_async`** sends a message and returns immediately; the session runs in the background. Its body needs a typed `parts` array — `{ "parts": [{ "type": "text", "text": "…" }] }` — not a bare `{ "text": … }`.
- Select the workspace with a **`?directory=<absolute path>`** query param.

## Behaviour

Once messages are flowing in, everything in [`SKILL.md`](SKILL.md) applies unchanged — attribute speakers, take turns like a group chat, play the role the room asks for. The relay injects each message as a single-line JSON blob prefixed with its source, so you see every field (author, attachments, timestamp), and it skips bot messages so you never echo your own replies.

One trap bites hard here: because the relay injects a channel message as ordinary session input, it looks just like the operator typing to you locally, and answering *in the session* feels right — but the people in the channel see none of that. To reply to the channel you must run `discord-agent-bridge.ts send <text>`. When a message arrives from Discord, your reply goes back to Discord via `send`; a session-only answer has reached no one. This is the [`SKILL.md`](SKILL.md) "speak through the bridge" rule, and the relay makes it especially easy to forget.
