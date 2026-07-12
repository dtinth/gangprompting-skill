# gangprompting

A Claude Code plugin that teaches a coding agent to **loop itself into a team chat channel** (Discord, Slack, a group thread) so several people can prompt it together — a shared secretary, a grilling facilitator, a teammate in the room.

> *Gangprompting* — many people prompting one agent together in one channel. Term coined by Dax Raad ([@thdxr](https://x.com/thdxr/status/2073045223752745189)).

## What it does

Say **"loop yourself into `<channel>`"** and the agent joins the channel and works with everyone in it. On first use it sets up a small **bridge** (read / send / monitor, one JSON line per message) and records the how-to in `CLAUDE.md`; after that, looping in is one step. The bundled Discord bridge is [dtinth's `discord-agent-bridge.ts`](https://github.com/dtinth/discord-message-proxy/blob/main/tools/agent-bridge/discord-agent-bridge.ts); other platforms adapt the same three-command interface.

The skill is portable across coding agents: it prescribes the `Monitor` tool only for Claude Code and nudges other harnesses toward an equivalent background watch (or long-polling).

## Install

Agent-agnostic, via the [`skills`](https://github.com/mattpocock/skills) CLI — works across Claude Code, Cursor, and other agents:

```
npx skills@latest add dtinth/gangprompting-skill
```

Or as a Claude Code plugin:

```
/plugin marketplace add dtinth/gangprompting-skill
/plugin install gangprompting@gangprompting-plugins
```

Then, in any project, tell the agent to *loop yourself into* a channel link.

## Layout

- `skills/gangprompting/SKILL.md` — the skill: how to loop in, listen, and behave in a group chat
- `skills/gangprompting/SETUP.md` — one-time bridge setup
- `skills/gangprompting/discord-agent-bridge.ts` — the reference Discord bridge
- `.claude-plugin/plugin.json` — plugin manifest
- `.claude-plugin/marketplace.json` — marketplace catalog

## Notes

- Update `owner` / `author` in `.claude-plugin/*.json` and the repo path in the install command to match wherever you host this.
- The marketplace lists the plugin with a `"./"` source, so it must be added from a git repo or local path (not a raw URL to `marketplace.json`).
