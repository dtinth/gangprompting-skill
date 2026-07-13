# gangprompting

An **agent skill** that teaches a coding agent to **loop itself into a team chat channel** (Discord, Slack, a group thread) so several people can prompt it together — a shared secretary, a grilling facilitator, a teammate in the room. It's written to be agent-agnostic, but so far only developed and tested on Claude Code.

> *Gangprompting* — many people prompting one agent together in one channel. Term coined by Dax Raad ([@thdxr](https://x.com/thdxr/status/2064732709579080021)).

## What it does

Say **"loop yourself into `<channel>`"** and the agent joins the channel and works with everyone in it. On first use it sets up a small **bridge** (read / send / monitor, one JSON line per message) and records the how-to in `CLAUDE.md`; after that, looping in is one step. The bundled Discord bridge is [dtinth's `discord-agent-bridge.ts`](https://github.com/dtinth/discord-message-proxy/blob/main/tools/agent-bridge/discord-agent-bridge.ts); other platforms adapt the same three-command interface.

The skill is portable across coding agents: it prescribes the `Monitor` tool only for Claude Code and nudges other harnesses toward an equivalent background watch (or long-polling).

## Install

Install the skill with the [`skills`](https://github.com/mattpocock/skills) CLI, which can add it to Claude Code, Cursor, and other supported agents:

```
npx skills@latest add dtinth/gangprompting-skill
```

Then, in any project, tell the agent to *loop yourself into* a channel link.

## Layout

- `skills/gangprompting/SKILL.md` — the skill: how to loop in, listen, and behave in a group chat
- `skills/gangprompting/SETUP.md` — one-time bridge setup
- `skills/gangprompting/discord-agent-bridge.ts` — the reference Discord bridge
- `skills/gangprompting/HARNESS-OPENCODE.md`, `skills/gangprompting/opencode-relay.ts` — running it on OpenCode (v1.x)

## Notes

- Tested on Claude Code only. Listening needs a background watch that notifies the agent per message — the `Monitor` tool on Claude Code. On other agents that's unverified; the skill tells them to find an equivalent or fall back to long-polling, but this hasn't been exercised. Reports welcome.
