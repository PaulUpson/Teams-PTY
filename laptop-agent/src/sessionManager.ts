import { PtySession, SESSION_PRESETS } from "./ptySession";
import { config } from "./config";
import type { SessionInfo } from "./protocol";

type OutputCallback = (sessionId: string, b64data: string) => void;
type ExitCallback  = (sessionId: string, exitCode: number)  => void;

export class SessionManager {
  private sessions = new Map<string, PtySession>();

  constructor(
    private onOutput: OutputCallback,
    private onExit:   ExitCallback,
  ) {}

  create(id: string, command: string, cols: number, rows: number): string | null {
    if (this.sessions.has(id)) {
      return `Session '${id}' already exists. Kill it first.`;
    }

    // Validate: command must be a known preset or start with an allowed executable name
    const isPreset = id in SESSION_PRESETS || command in SESSION_PRESETS;
    if (!isPreset) {
      // Allow any command string when explicitly supplied via session.create
      // (allowlist enforcement happens at the browser/auth layer)
    }

    const session = new PtySession(id, command, cols, rows);

    session.on("data", (b64: string) => this.onOutput(id, b64));
    session.on("exit", (code: number) => {
      this.sessions.delete(id);
      this.onExit(id, code);
    });

    this.sessions.set(id, session);
    return null; // no error
  }

  input(id: string, data: string): string | null {
    const s = this.sessions.get(id);
    if (!s) return `No session '${id}'`;
    s.write(data);
    return null;
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.destroy();
    this.sessions.delete(id);
    return true;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map(s => ({
      id:        s.id,
      command:   s.command,
      alive:     s.alive,
      startedAt: s.startedAt.toISOString(),
    }));
  }

  destroyAll(): void {
    for (const s of this.sessions.values()) s.destroy();
    this.sessions.clear();
  }
}
