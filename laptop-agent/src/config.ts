import "dotenv/config";

function require_env(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional_int(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`${name} must be an integer, got: ${val}`);
  return n;
}

export const config = Object.freeze({
  webPubSubConnectionString: require_env("WEB_PUBSUB_CONNECTION_STRING"),
  allowedUserIds:            (process.env["ALLOWED_USER_IDS"] ?? "").split(",").map(s => s.trim()).filter(Boolean),
  maxSessionDurationMs:      optional_int("MAX_SESSION_DURATION_MS", 14_400_000),
  ptyCols:                   optional_int("PTY_COLS", 220),
  ptyRows:                   optional_int("PTY_ROWS", 50),
});
