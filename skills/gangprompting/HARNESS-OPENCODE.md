# Gangprompting on OpenCode

OpenCode has no per-message background watch — there is no equivalent of Claude Code's `Monitor` tool that pings the agent once per line. So you listen a different way: run the bridge's `monitor` in a process that outlives one tool call, pipe it through a **relay**, and let the relay inject each incoming message into *this* OpenCode session over the HTTP API. You reply with the bridge's `send` command as usual. The relay is one-way (chat → OpenCode); your replies go out through the bridge.

```
Discord ──monitor──▶ opencode-relay ──prompt──▶ OpenCode session ──send──▶ Discord
```

## Step 1 — find out which version you are on

**Do this before anything else.** v1 and v2 differ in their routes, their request body, and whether authentication is required. Applying one version's facts to the other costs a debugging cycle and fails in ways that look like a broken endpoint.

```sh
opencode --version     # v1.x
opencode2 --version    # the v2 preview installs its CLI as `opencode2`
```

Then read **only** the matching section below, and use the matching relay:

| Version | Section | Relay |
| --- | --- | --- |
| 2.x (beta) | [Wire it up on OpenCode v2](#wire-it-up-on-opencode-v2) | [`opencode-relay-v2.ts`](opencode-relay-v2.ts) |
| 1.x | [Wire it up on OpenCode v1](#wire-it-up-on-opencode-v1) | [`opencode-relay-v1.ts`](opencode-relay-v1.ts) |

Everything after those two sections applies to both.

---

## Wire it up on OpenCode v2

> **Read this section only if step 1 said 2.x.** On v1, skip to [the v1 section](#wire-it-up-on-opencode-v1) — none of the routes below exist there.
>
> v2 is beta and its API can still move. The published spec is the source of truth: <https://opencode.ai/v2/openapi.json>. Check a route against it, or against the server you are actually running, before assuming this file is current.

### 1. Get the session id

Ask the user — they are running the session, so they usually know it. It looks like `ses_…`. If they don't have it handy, list the sessions and match on `title` or `location.directory`:

```sh
opencode2 api GET /api/session
```

### 2. Decide which server the relay talks to

There is normally a **background service** that the CLI starts and manages, and `opencode2 api` finds it on its own — it reads the URL and password out of `~/.local/state/opencode/service.json`. If that is where the user's session lives, you need no URL and no password at all.

If the user runs their own `opencode2 serve` instead, point the relay at it with `OPENCODE_SERVER=<url>` and set `OPENCODE_SERVER_PASSWORD` to that server's password.

```sh
opencode2 service status                  # URL of the managed background service
opencode2 api GET /api/server             # the URLs a server reports for itself
```

### 3. Authentication is not optional

Every route on v2 answers `401` without credentials. The scheme is HTTP Basic, and **the username must be the literal string `opencode`** — any other username is a 401 even with the right password. The password is `OPENCODE_SERVER_PASSWORD` if the server was started with it, otherwise the random one the server generated at startup and recorded in `service.json`.

Do not "fix" a 401 by starting a server without a password. There is no such mode in v2, and an unauthenticated OpenCode server hands anyone who can reach it full command execution on the box — see [anomalyco/opencode#38857](https://github.com/anomalyco/opencode/issues/38857).

`opencode2 api` handles all of this for you, which is why [`opencode-relay-v2.ts`](opencode-relay-v2.ts) shells out to it rather than speaking HTTP. If you do speak HTTP directly, the request is:

```http
POST <base>/api/session/<session-id>/prompt
Authorization: Basic base64("opencode:" + <password>)
Content-Type: application/json

{"text": "From Discord: {…}"}
```

### 4. Start the pipeline

Export what the two scripts need — the bridge's `DISCORD_TOKEN` / `DISCORD_CHANNEL` / `DISCORD_API`, plus `SESSION_ID` for the relay (and `OPENCODE_SERVER` / `OPENCODE_SERVER_PASSWORD` if step 2 said so). Keep the token in a git-safe place, as in [`SETUP.md`](SETUP.md). Then run the pipe in a process that survives — see [Keep the pipeline alive](#keep-the-pipeline-alive) below:

```sh
discord-agent-bridge.ts monitor | opencode-relay-v2.ts
```

### 5. v2 API facts worth knowing

- **`POST /api/session/{sessionID}/prompt`** takes a bare `{"text": "…"}`. It admits the message durably and schedules the agent loop, then returns immediately with the new `msg_…`; you do not poll for the reply. The response echoes `"delivery": "steer"`, meaning a message that arrives mid-run steers the run in progress instead of queueing behind it — which is what you want for a chat channel.
- **`GET /api/session/{sessionID}/message`** reads the transcript back. Useful for confirming a test injection actually produced a reply.
- **`GET /api/session/{sessionID}`** returns `SessionNotFoundError` for an unknown id — a cheap preflight check.
- **`GET /api/session/active`** lists only the sessions that are **running at this instant**, and is empty while a session sits idle. So it is not a way to auto-discover the session id, and not a way to check that you picked the right server. Use it only to answer "is the session busy right now".

### 6. The failure mode that wastes the most time

Sessions live in storage shared by every OpenCode server on the box. A second server — one the user is not looking at — will happily accept a prompt for a session it does not own: **HTTP 200, a real `msg_…` id, and the work runs in the wrong process, where nobody sees it.** There is no status code that tells you this happened.

The only reliable check is empirical, and it is [step 4 of `SETUP.md`](SETUP.md) applied to the relay: inject one test message and confirm it appears in the session the humans are actually watching, before you tell the channel you are listening.

---

## Wire it up on OpenCode v1

> **Read this section only if step 1 said 1.x.** On v2, go back to [the v2 section](#wire-it-up-on-opencode-v2) — the routes below do not exist there, and posting to them returns the web app's HTML instead of JSON.

Use [`opencode-relay-v1.ts`](opencode-relay-v1.ts). Verified against 1.17.

1. **Ask the user for the server URL and the session id.** They're running the session, so they usually know both — ask first rather than guessing. The session id looks like `ses_…`. If they don't have them handy, offer to introspect as a convenience: the server is an `opencode serve` process (find its host/port with `ss -tlnp | grep opencode`, default `http://127.0.0.1:4096`), and `GET <base>/session` lists sessions to match by `title` or `directory`.
2. **Export the env** the two scripts need — the bridge's `DISCORD_TOKEN` / `DISCORD_CHANNEL` / `DISCORD_API`, plus `SESSION_ID` for the relay (and `OPENCODE_BASE` / `LOCATION` if they differ from the defaults). Keep the token in a git-safe place, as in [`SETUP.md`](SETUP.md).
3. **Start the pipe** in a process that survives — see [Keep the pipeline alive](#keep-the-pipeline-alive) below:
   ```sh
   discord-agent-bridge.ts monitor | opencode-relay-v1.ts
   ```

### v1 API facts worth knowing

- **Routes are under `/session/…`, not `/api/session/…`.** Posting to `/api/session/…` returns the web app's HTML (the SPA) instead of JSON — a silent failure that looks like a broken endpoint.
- **`POST /session/:id/prompt_async`** sends a message and returns immediately; the session runs in the background. Its body needs a typed `parts` array — `{"parts": [{"type": "text", "text": "…"}]}` — not a bare `{"text": …}`.
- Select the workspace with a **`?directory=<absolute path>`** query param.
- **Authentication is supported but not required.** A v1 server started without a password accepts anything that can reach it, which is a remote-code-execution surface ([anomalyco/opencode#38857](https://github.com/anomalyco/opencode/issues/38857)) — bind it to loopback, and set a password if the user's setup allows.

---

## Keep the pipeline alive

*(Both versions.)* The `monitor | relay` pipe has to outlive the tool call that started it. OpenCode's Bash tool runs each call in a fresh shell with a short timeout and tears down the process group when the call returns, so `&`, `nohup`, and `disown` do **not** keep a watcher alive. You need a real background primitive.

**A detached tmux session** is the option that is available almost everywhere. Launch the whole pipe in one shot — don't juggle windows and `send-keys`:

```sh
tmux new-session -d -s gangprompt \
  'source /path/to/gangprompt.env && discord-agent-bridge.ts monitor | opencode-relay-v2.ts'
```

Tell the user you are listening through tmux, and name the session so they can look in or take over:

```sh
tmux attach -t gangprompt          # watch live (detach again with Ctrl-b then d)
tmux capture-pane -pt gangprompt   # peek once without attaching
tmux kill-session -t gangprompt    # stop listening
```

**A process supervisor** is better where the box has one — it restarts the pipe if it dies and survives a reboot. Use whatever is already there (`systemd --user`, `pitchfork`, `supervisord`, the platform's own service manager) rather than introducing one. The pipe inside is the same; only the thing holding it up changes.

## Verify before you announce

*(Both versions.)* Do not tell the channel you are listening until you have seen a message make the whole trip. Post one message in the channel yourself (or ask someone to), and confirm it lands in *this* session. Then reply to it with the bridge's `send` and confirm the humans see that. Only then greet the room.

## Behaviour

*(Both versions.)* Once messages are flowing, everything in [`SKILL.md`](SKILL.md) applies unchanged — attribute speakers, take turns like a group chat, play the role the room asks for. The relay injects each message as a single-line JSON blob prefixed with its source, so you see every field (author, attachments, timestamp), and it skips bot messages so you never echo your own replies.

One trap bites hard here: because the relay injects a channel message as ordinary session input, it looks just like the operator typing to you locally, and answering *in the session* feels right — but the people in the channel see none of that. To reply to the channel you must run `discord-agent-bridge.ts send <text>`. When a message arrives from Discord, your reply goes back to Discord via `send`; a session-only answer has reached no one. This is the [`SKILL.md`](SKILL.md) "speak through the bridge" rule, and the relay makes it especially easy to forget.
