---
name: gangprompting
description: Loop yourself into a team's Discord or Slack channel so several people can prompt you together in one shared thread. Use when the user says "loop yourself into <channel>", pastes a channel or thread link for you to join, or wants to set up gangprompting for their team.
---

Gangprompting is many people prompting one agent together in a shared channel — Discord, Slack, a group thread. When someone says **"loop yourself into `<channel>`"**, you join that channel and work with everyone in it. You are a participant in a **group chat**, not a private one-to-one assistant, and everything below follows from that.

## First: is the bridge set up?

You reach the channel through a small **bridge** — a script with three jobs: `read` recent messages, `send` a message, and `long-poll` — wait for new ones (one line of JSON per message, so you can just read it). Check whether this project already has one: look in your project memory (`CLAUDE.md` or `AGENTS.md`) for a recorded bridge command and channel id.

- **Already set up** → use the recorded commands and go straight to *Listen*, below.
- **Not yet** → follow [`SETUP.md`](SETUP.md) to build and test a bridge, then come back here. Everything past this point assumes a working bridge.

## Listen in a loop

The `long-poll` command waits until a new message arrives. Then it prints the message and exits. Run it as a **background command**: you stay free to work, and your harness tells you when the command exits.

1. Run `read`. It shows the recent conversation. Keep the id of the newest message.
2. Run `long-poll --after <id>` as a background command:
   - **Claude Code**: the Bash tool with `run_in_background: true`.
   - **OpenCode**: the shell tool with `background: true`.
   - **Other harnesses**: any way to run a command in the background and be told when it exits.
3. When it exits, run `long-poll` again at once, with `--after` set to the id of the **last message it printed**. Then read the messages and do the work. Reply with `send`.

**Always start `long-poll` again.** You hear the channel only while `long-poll` runs. If you forget to start it again, you hear nothing more, and the people in the channel wait for a reply that does not come.

Some rules for the loop:

- **Use the id of the last message you received**, not the id of a message you sent. With the id of your own message, you lose the messages that arrived before it.
- No message is lost between two runs of `long-poll`. If messages arrived after the `--after` id, `long-poll` prints them at once.
- **One `long-poll` per channel.** To listen to several channels, run one `long-poll --channel <id>` for each channel.
- If your harness stops background commands after some time, add `--timeout <seconds>` with a shorter time. When the time ends and no message came, `long-poll` exits with code 0 and prints `no new messages after N seconds`. Then run it again with the same `--after` id.
- If your harness cannot run a command in the background, run `read --after <id>` from time to time between tasks.

Send a short greeting when you start listening ("I'm watching this channel now — type here") so people know you're there, and a farewell when you stop, so nobody keeps typing into the void.

## Behave like you're in a group chat

- **Speak through the bridge, or you're talking to yourself.** The room hears you only through the `send` command. Your ordinary replies — in-session text, tool output, thinking — never reach them. Every time you mean to answer the channel, actually call `send`; "replied" and "sent" are the same thing, and if you only wrote a reply you have said nothing. This trap is sharpest when a message arrives looking like normal local input (e.g. the output of a background command): answering in place feels natural and reaches no one.
- **Attribute.** Every message carries `author` and `author_id`. Track who said what, address people by name, and never collapse the room into one voice.
- **In several channels at once, the room is part of the attribution.** Every message also carries `channel_id`. Two channels are two different rooms with two different sets of people: reply to the `channel_id` the message came from — pass it to `send` explicitly rather than relying on the ambient default — and don't carry what was said in one room into another unless someone asks you to. Getting this wrong posts publicly to the wrong audience, so treat the channel as something you read off each message, never something you remember.
- **Take turns — on the team's terms.** Turn-taking is a team preference, recorded at setup. For a solid default, read the reference bridge's own guidance (run the bundled script with no arguments to print its usage): acknowledge each message briefly, then reply in full once the work is done. A team may prefer something quieter — speak only when @-mentioned, stay out of human-to-human back-and-forth. Whatever the norm: one message at a time, and one question at a time — ask, wait for the answer, then ask the next.
- **Play whatever role the room needs.** Facilitating a grilling session, keeping notes, answering questions — it is one job: a helpful teammate doing what the channel currently asks for. Let the humans tell you the role; don't invent fixed modes.
- **The channel is the log.** To recover context after a restart or a compaction, re-read recent messages with the `read` command. Don't keep a separate notes file shadowing the channel — it only drifts.

---

The term *gangprompting* was coined by Dax Raad ([@thdxr](https://x.com/thdxr/status/2064732709579080021)). The bundled Discord bridge is [dtinth's `discord-agent-bridge.ts`](https://github.com/dtinth/discord-message-proxy/blob/main/tools/agent-bridge/discord-agent-bridge.ts).
