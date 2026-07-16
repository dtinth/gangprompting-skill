# gangprompting

An **agent skill** that teaches a coding agent to **loop itself into a team chat channel** (Discord, Slack, a group thread) so several people can prompt it together — a shared secretary, a [grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md) facilitator, a teammate in the room. This skill is agent-agnostic (with specific guidance for Claude Code and OpenCode) and platform-agnostic (with specific guidance for Discord and Slack).

Instead of instructing an agent to run a random script from the internet; **this skill teaches an agent how to build its own bridge,** tailored to your setup.

> *Gangprompting* — many people prompting one agent together in one channel. Term coined by Dax Raad ([@thdxr](https://x.com/thdxr/status/2064732709579080021)).

## What it does

Say **"loop yourself into `<channel>`"** and the agent joins the channel and works with everyone in it.

On first use, it [sets up](./skills/gangprompting/SETUP.md) a small **bridge** (a small script that agent writes to be able to read from / send messages to / monitor a chat channel) and records the how-to in `CLAUDE.md`; after that, looping in is one step. The bundled [`discord-agent-bridge.ts`](./skills/gangprompting/discord-agent-bridge.ts) provided as a reference for agents to adapt to your set up.

## Install

Install the skill with the [`skills`](https://skills.sh) CLI:

```
npx skills@latest add dtinth/gangprompting-skill
```

Then, in any project, tell the agent to *loop yourself into* a channel link.

## Read the skill

- [SKILL.md](./skills/gangprompting/SKILL.md) — how to loop in, listen, and behave in a group chat
- [SETUP.md](./skills/gangprompting/SETUP.md) — one-time bridge setup
- Platform-specific guidance:
    - [PLATFORM-SLACK.md](./skills/gangprompting/PLATFORM-SLACK.md) — running it on Slack (scopes, polling vs Socket Mode)
- Harness-specific guidance:
    - [HARNESS-OPENCODE.md](./skills/gangprompting/HARNESS-OPENCODE.md) — setup guide for OpenCode v1.x
