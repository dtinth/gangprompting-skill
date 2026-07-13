# Setting up a gangprompting bridge

Do this once per project. The goal: a working **bridge** — `read`, `send`, `monitor` commands, one line of JSON per message — plus the setup memorized (`CLAUDE.md` or `AGENTS.md`) so that next time the user just says "loop yourself in" and you connect. Work through the steps in order; each ends on a check you can verify against the real channel.

## 1. Pick the platform and channel

Ask which chat platform (Discord, Slack, …) and which channel or thread to join. If the user pasted a link, extract the channel/thread id from it and confirm it back. **Done when** you have the platform and the exact channel id.

## 2. Get the credentials — kept out of git

You need a bot token (or equivalent) and the channel id. The user may hand you the token directly, point you at a file or environment variable that holds it, or give a proxy URL plus a minted token. Get what you need for the platform, asking rather than guessing. If the user has never set up a bot for their chat platform, don't assume they know how — offer to walk them through it.

- **Discord**: they create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications) and copy the **bot token** (that becomes `DISCORD_TOKEN`). Under the bot's settings they must turn on the **Message Content Intent** — a privileged intent, separate from permissions. Without it the bridge reads blank messages, and it's the most common setup gotcha. Beyond that the bot needs no special role or server-wide *permissions*: invite it with an empty permission set (`0`), and the server owner just adds it to each channel it should see, which is where it gets to read and post. For the channel id, have them enable Developer Mode (Settings → Advanced), then right-click the channel or thread and *Copy Channel ID*.

Wherever the token ends up, it must never sit in a file that git tracks. Good homes: an environment variable, a git-ignored `.env`, or the OS secret store. If the user pastes a token into the chat, put it somewhere git-ignored and make sure `.gitignore` actually covers that path. **Done when** you can name where the token lives and have confirmed — with `git check-ignore` or `git status` — that no tracked file contains it.

## 3. Build the bridge

- **Discord**: the bundled [`discord-agent-bridge.ts`](discord-agent-bridge.ts) works as-is. It runs on Deno, exposes `read` / `send` / `monitor`, emits NDJSON, and reads `DISCORD_TOKEN`, `DISCORD_CHANNEL`, `DISCORD_API`, and `DISCORD_POLL_INTERVAL` from the environment. Run it with no arguments to print its full usage and its best-practices for behaving in the channel.
- **Any other platform**: write a script in the team's preferred stack (or plain Python) that exposes the same three commands with the same output shape — one JSON object per line, at least `{id, timestamp, author, author_id, content}`. Model it on the reference script; keep the interface identical so the runtime guidance in [`SKILL.md`](SKILL.md) applies unchanged.

**Done when** the three commands exist and take their secrets from the git-safe location chosen in step 2.

> **Harness note.** Listening needs a background watch that notifies the agent per message. Claude Code uses its `Monitor` tool (see [`SKILL.md`](SKILL.md)). OpenCode has no such tool — see [`HARNESS-OPENCODE.md`](HARNESS-OPENCODE.md) for a worked recipe (a tmux'd `monitor` piped through `opencode-relay.ts`). On other harnesses, find an equivalent watch or fall back to long-polling.

## 4. Test it against the real channel

Prove each command works, not just that the script runs:

- `read` fetches recent messages from the channel.
- `send` posts a message the humans can actually see in the channel.
- `monitor` prints a new message when someone types (or when you post from another account).

**Done when** all three are verified against the live channel.

## 5. Memorize the setup

Write the non-secret facts to your project memory (`CLAUDE.md` or `AGENTS.md`) so looping in is one step next time:

- the platform and channel id,
- the exact `read` / `send` / `monitor` commands, noting *by reference* how the token is supplied (e.g. "reads `DISCORD_TOKEN` from `.env`") — never the token itself,
- the team's turn-taking preference from the group-chat guidance.

**Done when** your project memory holds the commands, channel, and preference, and the token appears in no tracked file.

---

Bridge ready — return to [`SKILL.md`](SKILL.md) and loop in.
