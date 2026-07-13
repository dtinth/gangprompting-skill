#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * opencode-relay.ts — pipe a Discord (or any) monitor stream into an OpenCode session.
 *
 * OpenCode has no per-message background watch like Claude Code's Monitor tool, so
 * gangprompting on OpenCode needs two pieces: the bridge's `monitor` command running
 * in a background terminal (tmux), and this relay reading its NDJSON on stdin and
 * injecting each human message into a running OpenCode session over the HTTP API.
 * The agent then replies with the bridge's `send` command as usual, closing the loop:
 *
 *   Discord ──monitor──▶ opencode-relay ──prompt_async──▶ OpenCode session ──send──▶ Discord
 *
 * ── Wiring ───────────────────────────────────────────────────────────────────
 *   source <env-with-DISCORD_*-and-SESSION_ID>
 *   discord-agent-bridge.ts monitor | deno run --allow-net --allow-env --allow-read opencode-relay.ts
 *
 * Run it inside a tmux (or other persistent) session so the pipe survives while the
 * agent works: OpenCode's own terminal tool won't keep a foreground pipe alive for you.
 *
 * ── Config (env) ─────────────────────────────────────────────────────────────
 *   SESSION_ID       (required)  the OpenCode session to inject into (e.g. ses_…)
 *   OPENCODE_BASE    (optional)  server base, default http://127.0.0.1:4096
 *   LOCATION         (optional)  workspace directory, default the current directory
 *   DISCORD_CHANNEL  (optional)  channel id, used only to label the injected prefix
 *
 * ── OpenCode API notes (learned the hard way) ────────────────────────────────
 *   • Routes live under /session/… , NOT /api/session/… . Hitting /api returns the
 *     web app's HTML (the SPA) instead of JSON — a silent, confusing failure.
 *   • POST /session/:id/prompt_async sends a message without waiting for the reply
 *     (the session runs in the background). The body needs a typed `parts` array —
 *     { parts: [{ type: "text", text: "…" }] } — not a bare { text }.
 *   • The workspace is selected with a ?directory=<abs path> query param.
 */

const USAGE = `opencode-relay — inject a monitor's NDJSON stream into an OpenCode session

Usage:
  discord-agent-bridge.ts monitor | opencode-relay.ts

Reads NDJSON on stdin (one message object per line, as emitted by the bridge's
monitor). For each non-bot message it POSTs to the OpenCode session, so the agent
sees the full message JSON (author, attachments, timestamp, …). Non-JSON lines —
the monitor's own stderr status — are ignored. The agent replies by calling the
bridge's send command itself; this relay is one-way (Discord → OpenCode) only.

Environment:
  SESSION_ID       (required)  OpenCode session id to inject into (e.g. ses_…)
  OPENCODE_BASE    (optional)  server base URL, default http://127.0.0.1:4096
  LOCATION         (optional)  workspace directory, default the current directory
  DISCORD_CHANNEL  (optional)  channel id, used only to label the injected prefix

Each message is injected as a single-line JSON blob prefixed with its source, e.g.
  From Discord, channel 123: {"author":"dtinth","content":"yo",…}
so the agent knows where it came from and can read every field.`;

const arg = Deno.args[0];
if (arg === "help" || arg === "--help" || arg === "-h") {
  console.log(USAGE);
  Deno.exit(0);
}

const OPENCODE_BASE = Deno.env.get("OPENCODE_BASE") ?? "http://127.0.0.1:4096";
const SESSION_ID = Deno.env.get("SESSION_ID");
if (!SESSION_ID) fatal("SESSION_ID required (the OpenCode session id to inject into)");
const LOCATION = Deno.env.get("LOCATION") ?? Deno.cwd();
const DISCORD_CHANNEL = Deno.env.get("DISCORD_CHANNEL") ?? "";

// ── injection ────────────────────────────────────────────────────────────────

/** Inject one message into the session. Skips bot messages so we never echo ourselves. */
async function inject(msg: Record<string, unknown>): Promise<void> {
  if (msg.bot) return;

  const source = DISCORD_CHANNEL ? `From Discord, channel ${DISCORD_CHANNEL}:` : "From Discord:";
  const url = `${OPENCODE_BASE}/session/${SESSION_ID}/prompt_async` +
    `?directory=${encodeURIComponent(LOCATION)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: `${source} ${JSON.stringify(msg)}` }],
      }),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`inject failed: HTTP ${res.status}${body ? `: ${body}` : ""}`);
    }
  } catch (err) {
    console.error(`inject failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── stdin loop ───────────────────────────────────────────────────────────────

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of Deno.stdin.readable) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? ""; // keep the trailing partial line for the next chunk

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue; // skip blanks and monitor's stderr
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      console.error(`parse failed: ${trimmed.slice(0, 100)} — ${err instanceof Error ? err.message : err}`);
      continue;
    }
    await inject(msg);
  }
}

function fatal(msg: string): never {
  console.error(`error: ${msg}`);
  Deno.exit(1);
}
