# Setting up a gangprompting bridge

Do this once per project. The goal: a working **bridge** — `read`, `send`, `monitor` commands, one line of JSON per message — plus the setup memorized (`CLAUDE.md` or `AGENTS.md`) so that next time the user just says "loop yourself in" and you connect. Work through the steps in order; each ends on a check you can verify against the real channel.

**Read the reference first — whatever platform or harness you're on.** Start with the bundled [`discord-agent-bridge.ts`](discord-agent-bridge.ts): it defines the bridge every platform mirrors (the `read` / `send` / `monitor` commands and the one-JSON-object-per-line output), and its usage text — run it with no arguments — carries channel-behaviour best-practices that apply everywhere. These steps and that script are written for **Discord + Claude Code**, the bundled baseline; two axes vary from there:

- **Platform** (the chat side): Discord is the reference. For Slack, see [`PLATFORM-SLACK.md`](PLATFORM-SLACK.md). Any other platform — build a bridge to the same interface.
- **Harness** (how the agent listens): Claude Code uses its `Monitor` tool. For OpenCode, see [`HARNESS-OPENCODE.md`](HARNESS-OPENCODE.md). Any other harness — find an equivalent background watch, or fall back to long-polling.

## 1. Pick the platform and channel

Ask which chat platform (Discord, Slack, …) and which channel or thread to join. If the user pasted a link, extract the channel/thread id from it and confirm it back. **Done when** you have the platform and the exact channel id.

## 2. Get the credentials — kept out of git

You need a bot token (or equivalent) and the channel id. The user may hand you the token directly, point you at a file or environment variable that holds it, or give a proxy URL plus a minted token. Get what you need for the platform, asking rather than guessing. If the user has never set up a bot for their chat platform, don't assume they know how — offer to walk them through it.

- **Discord**: they create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications) and copy the **bot token** (that becomes `DISCORD_TOKEN`). Under the bot's settings they must turn on the **Message Content Intent** — a privileged intent, separate from permissions. Without it the bridge reads blank messages, and it's the most common setup gotcha. Beyond that the bot needs no special role or server-wide *permissions*: invite it with an empty permission set (`0`), and the server owner just adds it to each channel it should see, which is where it gets to read and post. For the channel id, have them enable Developer Mode (Settings → Advanced), then right-click the channel or thread and *Copy Channel ID*.
- **Slack**: the token and the scopes to request are their own topic — see [`PLATFORM-SLACK.md`](PLATFORM-SLACK.md). The short version: a bot token (`xoxb-…`) on an *internal* app, with all the scopes for the features you'll build requested upfront (adding one later means a reinstall).

Wherever the token ends up, it must never sit in a file that git tracks. Good homes: an environment variable, a git-ignored `.env`, or the OS secret store. If the user pastes a token into the chat, put it somewhere git-ignored and make sure `.gitignore` actually covers that path. **Done when** you can name where the token lives and have confirmed — with `git check-ignore` or `git status` — that no tracked file contains it.

## 3. Build the bridge

- **Discord**: the bundled [`discord-agent-bridge.ts`](discord-agent-bridge.ts) works as-is. It runs on Deno, exposes `read` / `send` / `monitor`, emits NDJSON, and reads `DISCORD_TOKEN`, `DISCORD_CHANNEL`, `DISCORD_API`, and `DISCORD_POLL_INTERVAL` from the environment. Run it with no arguments to print its full usage and its best-practices for behaving in the channel. (`monitor` polls over REST; for immediate delivery you could instead use Discord's **Gateway** WebSocket — snappier, but a persistent connection and more moving parts. Optional, and not needed for a working bridge.)
- **Any other platform**: write a script in the team's preferred stack (or plain Python) that exposes the same three commands with the same output shape — one JSON object per line, at least `{id, timestamp, author, author_id, content}`. Model it on the reference script; keep the interface identical so the runtime guidance in [`SKILL.md`](SKILL.md) applies unchanged. For Slack, [`PLATFORM-SLACK.md`](PLATFORM-SLACK.md) covers the specifics (poll by default, Socket Mode as an optional optimization).

**Done when** the three commands exist and take their secrets from the git-safe location chosen in step 2.

> **Harness note.** Listening needs a background watch that notifies the agent per message. Claude Code uses its `Monitor` tool (see [`SKILL.md`](SKILL.md)). OpenCode has no such tool — see [`HARNESS-OPENCODE.md`](HARNESS-OPENCODE.md) for a worked recipe (a tmux'd `monitor` piped through `opencode-relay.ts`). On other harnesses, find an equivalent watch or fall back to long-polling.

## 4. Test it against the real channel

Prove each command works, not just that the script runs:

- `read` fetches recent messages from the channel.
- `send` posts a message the humans can actually see in the channel.
- `monitor` prints a new message when someone types (or when you post from another account).

On any platform with a permission model, also confirm the **full** set of scopes/permissions for the features you'll use is granted *now* — don't discover gaps one failed call at a time, since a missing scope often fails silently. Call the platform's "am I authorized" endpoint and diff against your feature list: Slack's `auth.test` returns the granted scopes in the `x-oauth-scopes` response header; Discord's analog is the Message Content Intent plus the channel permissions from step 2.

**Done when** all three commands are verified against the live channel and the permission surface for your features is confirmed granted.

## 5. Memorize the setup

Write the non-secret facts to your project memory (`CLAUDE.md` or `AGENTS.md`) so looping in is one step next time:

- the platform and channel id,
- the exact `read` / `send` / `monitor` commands, noting *by reference* how the token is supplied (e.g. "reads `DISCORD_TOKEN` from `.env`") — never the token itself,
- the team's turn-taking preference from the group-chat guidance.

**Done when** your project memory holds the commands, channel, and preference, and the token appears in no tracked file.

---

Bridge ready — return to [`SKILL.md`](SKILL.md) and loop in.
