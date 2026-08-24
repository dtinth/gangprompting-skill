#!/usr/bin/env -S deno run --allow-run --allow-env
/**
 * opencode-relay-v2.ts — pipe a bridge monitor stream into an OpenCode **v2** session.
 *
 * For OpenCode v1.x use opencode-relay-v1.ts instead: the routes, the request body and
 * the authentication all differ. Check with `opencode --version` / `opencode2 --version`.
 *
 * OpenCode has no per-message background watch like Claude Code's Monitor tool, so
 * gangprompting on OpenCode needs two pieces: the bridge's `monitor` command running in
 * a process that outlives one tool call, and this relay reading its NDJSON on stdin and
 * injecting each human message into a running OpenCode session. The agent then replies
 * with the bridge's `send` command, closing the loop:
 *
 *   Discord ──monitor──▶ opencode-relay-v2 ──prompt──▶ OpenCode session ──send──▶ Discord
 *
 * ── Wiring ───────────────────────────────────────────────────────────────────
 *   source <env-with-DISCORD_*-and-SESSION_ID>
 *   discord-agent-bridge.ts monitor | deno run --allow-run --allow-env opencode-relay-v2.ts
 *
 * ── Config (env) ─────────────────────────────────────────────────────────────
 *   SESSION_ID        (required)  the session to inject into (e.g. ses_…)
 *   OPENCODE_BIN      (optional)  CLI to shell out to, default `opencode2`
 *   OPENCODE_SERVER   (optional)  a separate `opencode serve` to target instead of the
 *                                 background service; needs OPENCODE_SERVER_PASSWORD set
 *                                 to that server's password
 *   DISCORD_CHANNEL   (optional)  channel id, used only to label the injected prefix
 *
 * ── Why it shells out to `opencode api` ──────────────────────────────────────
 * `opencode api <METHOD> <path>` makes an authenticated request to the running server.
 * v2 always requires HTTP Basic auth, and the CLI already knows the URL and password of
 * the background service (it reads ~/.local/state/opencode/service.json), so shelling out
 * removes the whole discovery-and-credentials layer — the part that is easiest to get
 * silently wrong.
 *
 * If you would rather speak HTTP directly, this is the equivalent request:
 *
 *   POST <base>/api/session/<id>/prompt
 *   Authorization: Basic base64("opencode:" + <password>)
 *   Content-Type: application/json
 *   {"text": "…"}
 *
 * The username must be the literal string `opencode`; any other username is a 401. The
 * password is `OPENCODE_SERVER_PASSWORD` if the server was started with it, otherwise the
 * random one the server generated, which it records in ~/.local/state/opencode/service.json.
 */

const USAGE = `opencode-relay-v2 — inject a monitor's NDJSON stream into an OpenCode v2 session

Usage:
  discord-agent-bridge.ts monitor | opencode-relay-v2.ts

Reads NDJSON on stdin (one message object per line, as emitted by the bridge's monitor).
For each non-bot message it posts to the OpenCode session, so the agent sees the full
message JSON (author, attachments, timestamp, …). Non-JSON lines — the monitor's own
status output — are ignored. The agent replies by calling the bridge's send command
itself; this relay is one-way (chat → OpenCode) only.

Environment:
  SESSION_ID        (required)  OpenCode session id to inject into (e.g. ses_…)
  OPENCODE_BIN      (optional)  CLI to shell out to, default opencode2
  OPENCODE_SERVER   (optional)  separate server URL; needs OPENCODE_SERVER_PASSWORD too
  DISCORD_CHANNEL   (optional)  channel id, used only to label the injected prefix

Each message is injected as a single-line JSON blob prefixed with its source, e.g.
  From Discord, channel 123: {"author":"dtinth","content":"yo",…}
so the agent knows where it came from and can read every field.

For OpenCode v1.x use opencode-relay-v1.ts instead.`;

const arg = Deno.args[0];
if (arg === "help" || arg === "--help" || arg === "-h") {
  console.log(USAGE);
  Deno.exit(0);
}

const OPENCODE_BIN = Deno.env.get("OPENCODE_BIN") ?? "opencode2";
const OPENCODE_SERVER = Deno.env.get("OPENCODE_SERVER") ?? "";
const SESSION_ID = Deno.env.get("SESSION_ID");
if (!SESSION_ID) fatal("SESSION_ID required (the OpenCode session id to inject into)");
const DISCORD_CHANNEL = Deno.env.get("DISCORD_CHANNEL") ?? "";

/** Run `opencode api <args…>` and return its stdout, or throw with stderr attached. */
async function api(args: string[]): Promise<string> {
  const argv = ["api", ...(OPENCODE_SERVER ? ["--server", OPENCODE_SERVER] : []), ...args];
  const { code, stdout, stderr } = await new Deno.Command(OPENCODE_BIN, {
    args: argv,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const out = new TextDecoder().decode(stdout).trim();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr).trim();
    throw new Error(`${OPENCODE_BIN} ${argv.join(" ")} exited ${code}: ${err || out}`);
  }
  return out;
}

// ── preflight ────────────────────────────────────────────────────────────────
//
// Fail here rather than on the first real message. Two things go wrong at this point and
// both are silent later: the session id is wrong, or the CLI is pointed at a different
// server than the one running the session the humans are watching.

try {
  const body = await api(["GET", `/api/session/${SESSION_ID}`]);
  if (body.includes("SessionNotFoundError")) {
    fatal(
      `session ${SESSION_ID} not found on this server. Check the id with ` +
        `\`${OPENCODE_BIN} api GET /api/session\`, and check you are talking to the server ` +
        `that is actually running it (OPENCODE_SERVER).`,
    );
  }
  console.error(`relay ready: session ${SESSION_ID}${OPENCODE_SERVER ? ` on ${OPENCODE_SERVER}` : ""}`);
} catch (err) {
  fatal(`preflight failed: ${err instanceof Error ? err.message : err}`);
}

console.error(
  "reminder: a 200 here only means the server accepted the message. Send one test message " +
    "and confirm it reaches the session you are watching before telling the channel you are listening.",
);

// ── injection ────────────────────────────────────────────────────────────────

/** Inject one message into the session. Skips bot messages so we never echo ourselves. */
async function inject(msg: Record<string, unknown>): Promise<void> {
  if (msg.bot) return;

  const source = DISCORD_CHANNEL ? `From Discord, channel ${DISCORD_CHANNEL}:` : "From Discord:";
  const text = `${source} ${JSON.stringify(msg)}`;

  try {
    await api([
      "POST",
      `/api/session/${SESSION_ID}/prompt`,
      "-d",
      JSON.stringify({ text }),
    ]);
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
    if (!trimmed || !trimmed.startsWith("{")) continue; // skip blanks and monitor's status output
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
