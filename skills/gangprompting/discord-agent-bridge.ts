#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * discord-agent-bridge.ts — a tiny CLI for reading and posting Discord channel messages.
 *
 * Completely independent from discord-message-proxy.ts, but designed to pair with it:
 * by default it talks straight to Discord with a bot token, and pointing DISCORD_API
 * at a running proxy (with a proxy-minted JWT as DISCORD_TOKEN) works identically.
 *
 * Output is NDJSON — exactly one line per message — so `monitor` can feed line-oriented
 * event streams (agent harnesses, `grep --line-buffered`, etc.) without any parsing
 * gymnastics. Messages authored by bots are skipped unless --include-bots is passed.
 *
 * Meant for looping teammates into a session over Discord — see the "Best practices"
 * section of the usage text (run with no arguments) for how an agent should behave
 * around greeting, acknowledging, and signing off.
 *
 * ── Commands ─────────────────────────────────────────────────────────────────
 *   (none)                                        print usage
 *   send [text...] [--file <path>]                send a message (no text: read stdin)
 *   edit <messageId> [text...] [--file <path>]    edit a message this bot sent
 *   delete <messageId>                            delete a message
 *   read [--limit N] [--include-bots]             fetch recent messages once, oldest first
 *   monitor [--include-bots]                      poll for new messages forever (never exits —
 *                                                  launch via a persistent/indefinite background watch;
 *                                                  in Claude Code, this is the Monitor tool with
 *                                                  persistent: true, not Bash's run_in_background)
 *
 * ── Config (env) ─────────────────────────────────────────────────────────────
 *   DISCORD_TOKEN          (required)  bot token or proxy JWT; sent as "Bot <token>"
 *   DISCORD_CHANNEL        (required)  channel id to operate on
 *   DISCORD_API            (optional)  API base, default "https://discord.com/api/v10"
 *   DISCORD_POLL_INTERVAL  (optional)  monitor poll interval in seconds, default 20
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   deno run --allow-net --allow-env --allow-read discord-agent-bridge.ts
 *   # or straight from a public URL, no checkout or env vars needed to see usage:
 *   deno run --allow-net --allow-env --allow-read \
 *     https://raw.githubusercontent.com/dtinth/discord-message-proxy/main/tools/agent-bridge/discord-agent-bridge.ts
 */

const USAGE = `discord-agent-bridge — read and post Discord channel messages, one NDJSON line per message

Usage:
  discord-agent-bridge.ts send [text...] [--file <path>]
      Send a message. Text comes from the arguments, --file, or stdin (in that order
      of preference). Prints the created message, so you can capture its id.
  discord-agent-bridge.ts edit <messageId> [text...] [--file <path>]
      Edit a message this bot previously sent. Text sources as with send.
  discord-agent-bridge.ts delete <messageId>
      Delete a message. Prints {"deleted":"<id>"}.
  discord-agent-bridge.ts read [--limit N] [--include-bots]
      Fetch up to N recent messages (default 50, max 100) once, oldest first.
  discord-agent-bridge.ts monitor [--include-bots]
      Watch for new messages: remembers the latest message at startup, then polls and
      prints each newer message as it arrives. Never exits; transient errors are
      retried. Messages from bots are skipped unless --include-bots is passed.
      IMPORTANT: this command runs forever by design — it is meant to be launched through
      a background/watch mechanism that supports an indefinite or persistent run (e.g. a
      "persistent: true" option), not one with a short default timeout. A watch that times
      out after a few minutes will be killed long before the next message arrives and you
      will silently miss messages.
      If you are Claude Code: this is exactly what the Monitor tool is for — run this
      command with Monitor's persistent: true option, not Bash's run_in_background (which
      has a short default timeout and is meant for one-shot completion, not an ongoing
      watch). See https://code.claude.com/docs/en/tools-reference#monitor-tool

Environment:
  DISCORD_TOKEN          (required)  bot token or proxy JWT; sent as "Authorization: Bot <token>"
  DISCORD_CHANNEL        (required)  channel id to operate on
  DISCORD_API            (optional)  API base URL, default https://discord.com/api/v10
                                     (point this at a discord-message-proxy to use a scoped JWT)
  DISCORD_POLL_INTERVAL  (optional)  monitor poll interval in seconds, default 20

  If you don't have DISCORD_TOKEN / DISCORD_CHANNEL yet, ask the user for them instead of
  guessing — they may hand you a bot token and channel id directly, or a proxy URL plus a
  token minted from a discord-message-proxy (see DISCORD_API above).

Output format (NDJSON, one message per line):
  {"id":"…","timestamp":"2026-01-01T00:00:00.000000+00:00","author":"name","author_id":"…","bot":false,"content":"hi"}
"attachments" (array of URLs) and "edited_timestamp" appear only when present.

Best practices (for agents using this to loop teammates into a session over Discord):
  - When you start monitor, send a greeting first (e.g. "You can type here — I'm watching
    this channel now") so people know you're listening before they bother typing anything.
  - When a message arrives, acknowledge it with a short reply before starting work: say what
    you understood and what you'll do next. For long-running work, don't leave that "got it"
    as the only reply — send a second one once the work is actually done.
  - When you stop monitor, send a farewell (e.g. "No longer monitoring this channel") so
    people don't keep typing expecting a reply.
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
    case "monitor":
      return await monitor(args);
    default:
      console.error(`unknown command: ${command}\n`);
      console.error(USAGE);
      Deno.exit(1);
  }
}

// ── commands ───────────────────────────────────────────────────────────────

async function send(args: string[]): Promise<void> {
  const { flags, options, positional } = parseArgs(args, [], ["file"]);
  void flags;
  const content = await resolveContent(positional, options.file);
  const msg = await api("POST", `/channels/${cfg().channel}/messages`, { content }) as Message;
  console.log(JSON.stringify(toRecord(msg)));
}

async function edit(args: string[]): Promise<void> {
  const { options, positional } = parseArgs(args, [], ["file"]);
  const messageId = positional.shift();
  if (!messageId || !/^\d+$/.test(messageId)) fatal("edit: first argument must be a message id");
  const content = await resolveContent(positional, options.file);
  const msg = await api("PATCH", `/channels/${cfg().channel}/messages/${messageId}`, { content }) as Message;
  console.log(JSON.stringify(toRecord(msg)));
}

async function remove(args: string[]): Promise<void> {
  const { positional } = parseArgs(args, [], []);
  const messageId = positional[0];
  if (!messageId || !/^\d+$/.test(messageId)) fatal("delete: first argument must be a message id");
  await api("DELETE", `/channels/${cfg().channel}/messages/${messageId}`);
  console.log(JSON.stringify({ deleted: messageId }));
}

async function read(args: string[]): Promise<void> {
  const { flags, options } = parseArgs(args, ["include-bots"], ["limit"]);
  const limit = Number(options.limit ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fatal("read: --limit must be 1..100");
  const messages = await api("GET", `/channels/${cfg().channel}/messages?limit=${limit}`) as Message[];
  for (const msg of sortOldestFirst(messages)) {
    if (msg.author?.bot && !flags["include-bots"]) continue;
    console.log(JSON.stringify(toRecord(msg)));
  }
}

async function monitor(args: string[]): Promise<void> {
  const { flags } = parseArgs(args, ["include-bots"], []);
  const intervalSec = Number(Deno.env.get("DISCORD_POLL_INTERVAL") ?? "20");
  if (!Number.isFinite(intervalSec) || intervalSec < 1) fatal("DISCORD_POLL_INTERVAL must be ≥ 1 second");

  // Baseline: remember the newest message at startup so we never emit backlog.
  const latest = await api("GET", `/channels/${cfg().channel}/messages?limit=1`) as Message[];
  let lastId = latest[0]?.id ?? "0";
  console.error(`monitoring channel ${cfg().channel} (poll every ${intervalSec}s, after message ${lastId})`);

  while (true) {
    await sleep(intervalSec * 1000);
    let batch: Message[];
    try {
      batch = await api("GET", `/channels/${cfg().channel}/messages?after=${lastId}&limit=100`) as Message[];
    } catch (err) {
      // Transient failure (network, 5xx, rate limit past its retry): log and keep polling.
      console.error(`poll failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    for (const msg of sortOldestFirst(batch)) {
      lastId = msg.id; // advance past bot messages too, or we'd refetch them forever
      if (msg.author?.bot && !flags["include-bots"]) continue;
      console.log(JSON.stringify(toRecord(msg)));
    }
  }
}

// ── Discord plumbing ───────────────────────────────────────────────────────

interface Message {
  id: string;
  timestamp: string;
  edited_timestamp?: string | null;
  content?: string;
  author?: { id: string; username: string; bot?: boolean };
  attachments?: { url: string }[];
}

let cached: { token: string; channel: string; api: string } | undefined;

/** Read config lazily so `help` works without any environment set up. */
function cfg(): { token: string; channel: string; api: string } {
  if (!cached) {
    cached = {
      token: requireEnv("DISCORD_TOKEN"),
      channel: requireEnv("DISCORD_CHANNEL"),
      api: (Deno.env.get("DISCORD_API") ?? "https://discord.com/api/v10").replace(/\/+$/, ""),
    };
    if (!/^\d+$/.test(cached.channel)) fatal("DISCORD_CHANNEL must be a numeric channel id");
  }
  return cached;
}

/** One Discord REST call. Waits out a 429 once; throws on any other failure. */
async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${cfg().api}${path}`, {
      method,
      headers: {
        authorization: `Bot ${cfg().token}`,
        "user-agent": UA,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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

/** Flatten a Discord message into a single compact NDJSON record. */
function toRecord(msg: Message): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: msg.id,
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

/** Discord returns newest-first (mostly); we always emit chronologically. */
function sortOldestFirst(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

// ── CLI plumbing ───────────────────────────────────────────────────────────

/** Split argv into boolean flags, valued options, and positional arguments. */
function parseArgs(
  args: string[],
  flagNames: string[],
  optionNames: string[],
): { flags: Record<string, boolean>; options: Record<string, string>; positional: string[] } {
  const flags: Record<string, boolean> = {};
  const options: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (flagNames.includes(name)) flags[name] = true;
      else if (optionNames.includes(name)) {
        const value = args[++i];
        if (value === undefined) fatal(`--${name} needs a value`);
        options[name] = value;
      } else fatal(`unknown option --${name}`);
    } else positional.push(arg);
  }
  return { flags, options, positional };
}

/** Message text from positional args, --file, or stdin — exactly one source. */
async function resolveContent(positional: string[], file: string | undefined): Promise<string> {
  if (positional.length > 0 && file) fatal("give the text as arguments or via --file, not both");
  let content: string;
  if (file) content = await Deno.readTextFile(file);
  else if (positional.length > 0) content = positional.join(" ");
  else content = await new Response(Deno.stdin.readable).text();
  content = content.replace(/\n+$/, "");
  if (!content) fatal("empty message; give text as arguments, --file, or stdin");
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
