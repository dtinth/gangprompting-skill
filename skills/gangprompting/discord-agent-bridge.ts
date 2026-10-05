#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * discord-agent-bridge.ts — a tiny CLI for reading and posting Discord channel messages.
 *
 * Completely independent from discord-message-proxy.ts, but designed to pair with it:
 * by default it talks straight to Discord with a bot token, and pointing DISCORD_API
 * at a running proxy (with a proxy-minted JWT as DISCORD_TOKEN) works identically.
 *
 * Output is NDJSON — exactly one line per message — so an agent or a script can read it
 * line by line. Messages authored by bots are skipped unless --include-bots is passed.
 * long-poll adds plain-text lines that start with ">>>": a reminder to start long-poll again
 * before acting on the messages, and the exact command to run next.
 *
 * To listen, an agent runs `long-poll --after <id>` as a background command. It waits
 * until a new message arrives, prints it, and exits — so the harness tells the agent when
 * it completes. The agent handles the messages, then runs long-poll again. This works
 * with any harness that can run a command in the background and report when it exits.
 *
 * Every record carries its own channel_id, and every command takes --channel, so one agent
 * can work several channels at once: the lines stay distinguishable in the agent's context,
 * and a reply names its target instead of inheriting whatever DISCORD_CHANNEL happens to
 * be set in the surrounding shell.
 *
 * Meant for looping teammates into a session over Discord — see the "Best practices"
 * section of the usage text (run with no arguments) for how an agent should behave
 * around greeting, acknowledging, and signing off.
 *
 * ── Commands ─────────────────────────────────────────────────────────────────
 *   (none)                                        print usage
 *   send [text...] [--file <path>] [--attach <p>] send a message (no text: read stdin);
 *                                                  --attach uploads a file, repeatable
 *   edit <messageId> [text...] [--file <path>]    edit a message this bot sent
 *   delete <messageId>                            delete a message
 *   read [--limit N] [--before <id>] [--after <id>] [--include-bots]
 *                                                 fetch messages once, oldest first
 *   long-poll --after <id> [--timeout <s>] [--include-bots]
 *                                                 wait for messages after <id>, print them, exit
 *   monitor                                       removed; exits 1 and points to long-poll
 *
 * ── Config (env) ─────────────────────────────────────────────────────────────
 *   DISCORD_TOKEN          (required)  bot token or proxy JWT; sent as "Bot <token>"
 *   DISCORD_CHANNEL        (required unless --channel is passed)  default channel id
 *   DISCORD_API            (optional)  API base, default "https://discord.com/api/v10"
 *   DISCORD_POLL_INTERVAL  (optional)  long-poll poll interval in seconds, default 20
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   deno run --allow-net --allow-env --allow-read discord-agent-bridge.ts
 *   # or straight from a public URL, no checkout or env vars needed to see usage:
 *   deno run --allow-net --allow-env --allow-read \
 *     https://raw.githubusercontent.com/dtinth/discord-message-proxy/main/tools/agent-bridge/discord-agent-bridge.ts
 */

const USAGE = `discord-agent-bridge — read and post Discord channel messages, one NDJSON line per message

Every command takes --channel <id> to override DISCORD_CHANNEL for that one call. Use it
whenever you work more than one channel: reply to the channel_id you were addressed from
rather than trusting the ambient DISCORD_CHANNEL.

Usage:
  discord-agent-bridge.ts send [text...] [--file <path>] [--attach <path>]...
      Send a message. Text comes from the arguments, --file, or stdin (in that order
      of preference). --attach uploads a file as an attachment and may be repeated to
      attach several; with at least one attachment the message text may be empty.
      Note: --file sets the message TEXT from a file, --attach uploads the file itself.
      Prints the created message, so you can capture its id.
  discord-agent-bridge.ts edit <messageId> [text...] [--file <path>]
      Edit a message this bot previously sent. Text sources as with send.
  discord-agent-bridge.ts delete <messageId>
      Delete a message. Prints {"deleted":"<id>"}.
  discord-agent-bridge.ts read [--limit N] [--before <id>] [--after <id>] [--include-bots]
      Fetch up to N messages (default 50, max 100) once, oldest first. With no --before
      and no --after, you get the newest N messages. With --after, you get the first N
      messages after that id. With --before, you get the last N messages before that id.
      Messages from bots are skipped unless --include-bots is passed.
  discord-agent-bridge.ts long-poll --after <id> [--timeout <seconds>] [--include-bots]
      Wait until 1 or more messages arrive after <id>. Then print them (as read does) and
      exit with code 0. If there are already messages after <id>, it prints them at once.
      Messages from bots do not end the wait unless --include-bots is passed, so your own
      replies do not wake you up. Transient errors are retried.
      With --timeout, it also exits with code 0 when the time ends and no message came.
      The messages come between 2 lines that start with ">>>". The last line gives the
      exact long-poll command to run next. On timeout, one ">>>" line gives it.
  discord-agent-bridge.ts monitor
      Removed. Use long-poll. This command exits with code 1.

How to listen:
  1. Run read. It gives you the recent conversation. Keep the id of the newest message.
     (read skips bot messages. If you need the id of the newest message of all, use
     read --include-bots.)
  2. Run long-poll --after <that id> as a BACKGROUND command. Use your harness's way to
     run a command in the background and be told when it exits. In Claude Code, this is
     the Bash tool with run_in_background: true.
  3. When long-poll exits, run it again at once: its last ">>>" line gives the command,
     with --after set to the id of the LAST message it printed. Add the same prefix that
     you used to run this script. Then handle the messages, and reply with send.
     Do not use the id of a message you sent: a message that arrived before your reply
     would then be lost.
  Do step 3 every time. If you do not start long-poll again, you hear nothing more.

Environment:
  DISCORD_TOKEN          (required)  bot token or proxy JWT; sent as "Authorization: Bot <token>"
  DISCORD_CHANNEL        (required unless --channel is passed)  default channel id
  DISCORD_API            (optional)  API base URL, default https://discord.com/api/v10
                                     (point this at a discord-message-proxy to use a scoped JWT)
  DISCORD_POLL_INTERVAL  (optional)  long-poll poll interval in seconds, default 20

  If you don't have DISCORD_TOKEN / DISCORD_CHANNEL yet, ask the user for them instead of
  guessing — they may hand you a bot token and channel id directly, or a proxy URL plus a
  token minted from a discord-message-proxy (see DISCORD_API above).

Output format (NDJSON, one message per line):
  {"id":"…","channel_id":"…","timestamp":"2026-01-01T00:00:00.000000+00:00","author":"name","author_id":"…","bot":false,"content":"hi"}
"attachments" (array of URLs) and "edited_timestamp" appear only when present.
long-poll also prints instruction lines that start with ">>>". They are not JSON. A message
cannot make such a line, because each message is one JSON line.

Best practices (for agents using this to loop teammates into a session over Discord):
  - When you start to listen, send a greeting first (e.g. "You can type here — I'm watching
    this channel now") so people know you're listening before they bother typing anything.
  - When a message arrives, acknowledge it with a short reply before starting work: say what
    you understood and what you'll do next. For long-running work, don't leave that "got it"
    as the only reply — send a second one once the work is actually done.
  - When you stop listening, send a farewell (e.g. "No longer monitoring this channel") so
    people don't keep typing expecting a reply.
  - When you watch more than one channel, treat channel_id as part of who is speaking. Reply
    to the channel the message came from, with --channel, and never carry what was said in
    one channel into another unless someone asks you to.
  - When asking a question, favor being easy to understand over being terse — a teammate
    reading on their phone won't have your context, so spell out what you're asking and why.
    A concrete example or two of the options often makes it click faster than more prose.
  - Ask one question at a time, not a batch. Batched questions overwhelm the reader, and one
    answer can change whether a later question even makes sense. Ask, wait for the reply,
    then ask the next one — building up a clear decision tree instead of a wall of text.`;

const UA = "DiscordBot (https://github.com/dtinth/discord-message-proxy, 1.0) discord-agent-bridge";

async function main(): Promise<void> {
  const args = [...Deno.args];
  const command = args.shift();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  switch (command) {
    case "send":
      return await send(args);
    case "edit":
      return await edit(args);
    case "delete":
      return await remove(args);
    case "read":
      return await read(args);
    case "long-poll":
      return await longPoll(args);
    case "monitor":
      return monitorRemoved();
    default:
      console.error(`unknown command: ${command}\n`);
      console.error(USAGE);
      Deno.exit(1);
  }
}

// ── commands ───────────────────────────────────────────────────────────────

async function send(args: string[]): Promise<void> {
  const { options, multi, positional } = parseArgs(args, [], ["file", "channel"], ["attach"]);
  const channel = resolveChannel(options.channel);
  const attachments = multi.attach ?? [];
  const content = await resolveContent(positional, options.file, attachments.length > 0);
  const body = attachments.length > 0
    ? await buildUpload(content, attachments)
    : { content };
  const msg = await api("POST", `/channels/${channel}/messages`, body) as Message;
  console.log(JSON.stringify(toRecord(msg, channel)));
}

/** Build a multipart body that uploads files[] alongside the message JSON. */
async function buildUpload(content: string, paths: string[]): Promise<FormData> {
  const form = new FormData();
  const meta = paths.map((p, i) => ({ id: i, filename: basename(p) }));
  form.append("payload_json", JSON.stringify({ content, attachments: meta }));
  for (let i = 0; i < paths.length; i++) {
    let data: Uint8Array;
    try {
      data = await Deno.readFile(paths[i]);
    } catch (err) {
      fatal(`--attach: cannot read ${paths[i]}: ${err instanceof Error ? err.message : err}`);
    }
    // Copy into a fresh ArrayBuffer-backed array so the Blob part is a plain ArrayBuffer.
    const bytes = new Uint8Array(data);
    form.append(`files[${i}]`, new Blob([bytes]), basename(paths[i]));
  }
  return form;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

async function edit(args: string[]): Promise<void> {
  const { options, positional } = parseArgs(args, [], ["file", "channel"]);
  const channel = resolveChannel(options.channel);
  const messageId = positional.shift();
  if (!messageId || !/^\d+$/.test(messageId)) fatal("edit: first argument must be a message id");
  const content = await resolveContent(positional, options.file);
  const msg = await api("PATCH", `/channels/${channel}/messages/${messageId}`, { content }) as Message;
  console.log(JSON.stringify(toRecord(msg, channel)));
}

async function remove(args: string[]): Promise<void> {
  const { options, positional } = parseArgs(args, [], ["channel"]);
  const channel = resolveChannel(options.channel);
  const messageId = positional[0];
  if (!messageId || !/^\d+$/.test(messageId)) fatal("delete: first argument must be a message id");
  await api("DELETE", `/channels/${channel}/messages/${messageId}`);
  console.log(JSON.stringify({ deleted: messageId, channel_id: channel }));
}

async function read(args: string[]): Promise<void> {
  const { flags, options } = parseArgs(args, ["include-bots"], ["limit", "channel", "before", "after"]);
  const channel = resolveChannel(options.channel);
  const limit = Number(options.limit ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fatal("read: --limit must be 1..100");
  const before = parseId("--before", options.before);
  const after = parseId("--after", options.after);
  for (const msg of await fetchPage(channel, limit, before, after)) {
    if (msg.author?.bot && !flags["include-bots"]) continue;
    console.log(JSON.stringify(toRecord(msg, channel)));
  }
}

async function longPoll(args: string[]): Promise<void> {
  const { flags, options } = parseArgs(args, ["include-bots"], ["after", "timeout", "channel"]);
  const channel = resolveChannel(options.channel);
  const after = parseId("--after", options.after);
  if (after === undefined) {
    fatal(
      "long-poll: --after <id> is required. Use the id of the newest message you have seen " +
        "(the last line of `read`). Without it, a message that arrives before long-poll starts is lost.",
    );
  }
  const timeoutSec = options.timeout === undefined ? undefined : Number(options.timeout);
  if (timeoutSec !== undefined && (!Number.isFinite(timeoutSec) || timeoutSec <= 0)) {
    fatal("long-poll: --timeout must be a number of seconds > 0");
  }
  const intervalSec = Number(Deno.env.get("DISCORD_POLL_INTERVAL") ?? "20");
  if (!Number.isFinite(intervalSec) || intervalSec < 1) fatal("DISCORD_POLL_INTERVAL must be ≥ 1 second");
  const deadline = timeoutSec === undefined ? Infinity : Date.now() + timeoutSec * 1000;

  // The command to run next, with every option of this run except --after. Printed on stdout,
  // not stderr, because it is an instruction to the agent: see "How to listen" in the usage.
  const next = (id: string) =>
    [
      "long-poll",
      `--after ${id}`,
      options.channel !== undefined ? `--channel ${options.channel}` : "",
      timeoutSec !== undefined ? `--timeout ${options.timeout}` : "",
      flags["include-bots"] ? "--include-bots" : "",
    ].filter(Boolean).join(" ");

  let cursor = after;
  console.error(
    `waiting for messages in channel ${channel} after ${after} (poll every ${intervalSec}s` +
      `${timeoutSec === undefined ? "" : `, timeout ${timeoutSec}s`})`,
  );

  while (true) {
    // Poll first, sleep after: messages that arrived since `read` come back at once.
    let batch: Message[] = [];
    try {
      batch = await fetchPage(channel, 100, undefined, cursor);
    } catch (err) {
      // Transient failure (network, 5xx, rate limit past its retry): log and keep polling.
      console.error(`poll failed: ${err instanceof Error ? err.message : err}`);
    }
    const found: Message[] = [];
    for (const msg of batch) {
      cursor = msg.id; // advance past bot messages too, or we'd refetch them forever
      if (msg.author?.bot && !flags["include-bots"]) continue;
      found.push(msg);
    }
    if (found.length > 0) {
      // The reminder goes both before and after the messages: harnesses cut long output at
      // different ends (OpenCode keeps the end, Claude Code's Read keeps the start).
      console.log(
        ">>> NEW MESSAGES. Before you act on them, start long-poll again in the background. " +
          "The command is at the end.",
      );
      for (const msg of found) console.log(JSON.stringify(toRecord(msg, channel)));
      console.log(
        `>>> Start this now, in the background, before anything else: ${next(found[found.length - 1].id)}`,
      );
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      console.log(
        `>>> No new messages after ${timeoutSec} seconds. Start this now, in the background: ${next(cursor)}`,
      );
      return;
    }
    await sleep(Math.min(intervalSec * 1000, remaining));
  }
}

function monitorRemoved(): never {
  fatal(
    "monitor was removed. Use long-poll instead: run `read` and keep the id of the newest " +
      "message, then run `long-poll --after <id>` as a background command. When it exits, " +
      "handle what it printed, and run it again with the id of the last message it printed. " +
      "Run with no arguments for the full usage.",
  );
}

// ── Discord plumbing ───────────────────────────────────────────────────────

interface Message {
  id: string;
  channel_id?: string;
  timestamp: string;
  edited_timestamp?: string | null;
  content?: string;
  author?: { id: string; username: string; bot?: boolean };
  attachments?: { url: string }[];
}

let cached: { token: string; api: string } | undefined;

/** Read config lazily so `help` works without any environment set up. */
function cfg(): { token: string; api: string } {
  if (!cached) {
    cached = {
      token: requireEnv("DISCORD_TOKEN"),
      api: (Deno.env.get("DISCORD_API") ?? "https://discord.com/api/v10").replace(/\/+$/, ""),
    };
  }
  return cached;
}

/** The channel one command operates on: --channel wins, DISCORD_CHANNEL is the fallback.
 *  Per-command rather than global config, so an agent working several channels names the
 *  target on every call instead of inheriting whatever the surrounding shell exported. */
function resolveChannel(override: string | undefined): string {
  const channel = override ?? Deno.env.get("DISCORD_CHANNEL");
  if (!channel) fatal("no channel: pass --channel <id> or set DISCORD_CHANNEL");
  if (!/^\d+$/.test(channel)) fatal(`not a numeric channel id: ${channel}`);
  return channel;
}

/** One Discord REST call. Waits out a 429 once; throws on any other failure.
 *  A FormData body is sent as multipart (for file uploads); anything else as JSON. */
async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const isForm = body instanceof FormData;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${cfg().api}${path}`, {
      method,
      headers: {
        authorization: `Bot ${cfg().token}`,
        "user-agent": UA,
        // Let fetch set the multipart boundary itself; only JSON needs an explicit type.
        ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    if (res.status === 429 && attempt === 0) {
      const data = await res.json().catch(() => ({}));
      const retryAfter = typeof data.retry_after === "number" ? data.retry_after : 1;
      console.error(`rate limited; retrying in ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`${method} ${path} → HTTP ${res.status}${text ? `: ${text}` : ""}`);
    }
    return res.status === 204 ? undefined : await res.json();
  }
  throw new Error(`${method} ${path} → still rate limited after retry`);
}

/** Flatten a Discord message into a single compact NDJSON record.
 *  channel_id is always present: without it, messages from several channels look the
 *  same in the agent's context, and a reply has nothing to aim at. */
function toRecord(msg: Message, channel: string): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: msg.id,
    channel_id: msg.channel_id ?? channel,
    timestamp: msg.timestamp,
    author: msg.author?.username ?? "",
    author_id: msg.author?.id ?? "",
    bot: Boolean(msg.author?.bot),
    content: msg.content ?? "",
  };
  const attachments = (msg.attachments ?? []).map((a) => a.url);
  if (attachments.length > 0) record.attachments = attachments;
  if (msg.edited_timestamp) record.edited_timestamp = msg.edited_timestamp;
  return record;
}

/** One page of up to `limit` messages, oldest first. Discord accepts only one of before/after
 *  per request, so with both we fetch after `after` and drop what is not before `before`. */
async function fetchPage(
  channel: string,
  limit: number,
  before: string | undefined,
  after: string | undefined,
): Promise<Message[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (after !== undefined) query.set("after", after);
  else if (before !== undefined) query.set("before", before);
  const messages = sortOldestFirst(await api("GET", `/channels/${channel}/messages?${query}`) as Message[]);
  return before !== undefined && after !== undefined
    ? messages.filter((msg) => BigInt(msg.id) < BigInt(before))
    : messages;
}

/** Validate an optional message id option. */
function parseId(name: string, value: string | undefined): string | undefined {
  if (value !== undefined && !/^\d+$/.test(value)) fatal(`${name} must be a numeric message id`);
  return value;
}

/** Discord returns newest-first (mostly); we always emit chronologically. */
function sortOldestFirst(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

// ── CLI plumbing ───────────────────────────────────────────────────────────

/** Split argv into boolean flags, valued options, repeatable options, and positionals.
 *  Names in multiNames may appear more than once and collect into an array. */
function parseArgs(
  args: string[],
  flagNames: string[],
  optionNames: string[],
  multiNames: string[] = [],
): {
  flags: Record<string, boolean>;
  options: Record<string, string>;
  multi: Record<string, string[]>;
  positional: string[];
} {
  const flags: Record<string, boolean> = {};
  const options: Record<string, string> = {};
  const multi: Record<string, string[]> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (flagNames.includes(name)) flags[name] = true;
      else if (optionNames.includes(name) || multiNames.includes(name)) {
        const value = args[++i];
        if (value === undefined) fatal(`--${name} needs a value`);
        if (multiNames.includes(name)) (multi[name] ??= []).push(value);
        else options[name] = value;
      } else fatal(`unknown option --${name}`);
    } else positional.push(arg);
  }
  return { flags, options, multi, positional };
}

/** Message text from positional args, --file, or stdin — exactly one source.
 *  When allowEmpty (an attachment is present), skip the stdin prompt on a TTY and
 *  permit empty text so an attachment-only message can be sent. */
async function resolveContent(
  positional: string[],
  file: string | undefined,
  allowEmpty = false,
): Promise<string> {
  if (positional.length > 0 && file) fatal("give the text as arguments or via --file, not both");
  let content: string;
  if (file) content = await Deno.readTextFile(file);
  else if (positional.length > 0) content = positional.join(" ");
  else if (allowEmpty && Deno.stdin.isTerminal()) content = "";
  else content = await new Response(Deno.stdin.readable).text();
  content = content.replace(/\n+$/, "");
  if (!content && !allowEmpty) fatal("empty message; give text as arguments, --file, or stdin");
  return content;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) fatal(`missing required env var ${name}`);
  return v;
}

function fatal(msg: string): never {
  console.error(`error: ${msg}`);
  Deno.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  Deno.exit(1);
});
