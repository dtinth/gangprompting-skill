---
name: gangprompting
description: Loop yourself into a team's Discord or Slack channel so several people can prompt you together in one shared thread. Use when the user says "loop yourself into <channel>", pastes a channel or thread link for you to join, or wants to set up gangprompting for their team.
---

Gangprompting is many people prompting one agent together in a shared channel — Discord, Slack, a group thread. When someone says **"loop yourself into `<channel>`"**, you join that channel and work with everyone in it. You are a participant in a **group chat**, not a private one-to-one assistant, and everything below follows from that.

## First: is the bridge set up?

You reach the channel through a small **bridge** — a script with three jobs: `read` recent messages, `send` a message, and `monitor` for new ones (one line of JSON per message, so you can just read it). Check whether this project already has one: look in `CLAUDE.md` or the project's notes for a recorded bridge command and channel id.

- **Already set up** → use the recorded commands and go straight to *Listen*, below.
- **Not yet** → follow [`SETUP.md`](SETUP.md) to build and test a bridge, then come back here. Everything past this point assumes a working bridge.

## Listen without blocking

The `monitor` command runs forever, streaming one JSON line per new message. Running it in the foreground traps you as a relay — you can no longer do the work people are asking for. Run it in the background so you stay free and get pinged per message.

- **Claude Code**: run the `monitor` command with the **Monitor** tool and `persistent: true`. Monitor runs a shell command in the background and delivers each stdout line to you as a chat notification, so you keep working and hear about each new message as it lands. (Bash `run_in_background` is wrong here — its short timeout kills a watch that must run all session.)
- **Other harnesses**: find the equivalent — any background watch that notifies you per output line. If your harness has none, fall back to long-polling: run the `read` command yourself every so often to catch up. (OpenCode has no such tool — see [`HARNESS-OPENCODE.md`](HARNESS-OPENCODE.md) for a worked recipe.)

Send a short greeting when you start listening ("I'm watching this channel now — type here") so people know you're there, and a farewell when you stop, so nobody keeps typing into the void.

## Behave like you're in a group chat

- **Attribute.** Every message carries `author` and `author_id`. Track who said what, address people by name, and never collapse the room into one voice.
- **Take turns — on the team's terms.** Turn-taking is a team preference, recorded at setup. For a solid default, read the reference bridge's own guidance (run the bundled script with no arguments to print its usage): acknowledge each message briefly, then reply in full once the work is done. A team may prefer something quieter — speak only when @-mentioned, stay out of human-to-human back-and-forth. Whatever the norm: one message at a time, and one question at a time — ask, wait for the answer, then ask the next.
- **Play whatever role the room needs.** Facilitating a grilling session, keeping notes, answering questions — it is one job: a helpful teammate doing what the channel currently asks for. Let the humans tell you the role; don't invent fixed modes.
- **The channel is the log.** To recover context after a restart or a compaction, re-read recent messages with the `read` command. Don't keep a separate notes file shadowing the channel — it only drifts.

---

The term *gangprompting* was coined by Dax Raad ([@thdxr](https://x.com/thdxr/status/2064732709579080021)). The bundled Discord bridge is [dtinth's `discord-agent-bridge.ts`](https://github.com/dtinth/discord-message-proxy/blob/main/tools/agent-bridge/discord-agent-bridge.ts).
