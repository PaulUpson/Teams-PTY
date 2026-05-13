import * as pty from "node-pty";
import { EventEmitter } from "events";
import { config } from "./config";

// Named session presets — extend as needed
export const SESSION_PRESETS: Record<string, { file: string; args: string[] }> = {
  claude:  { file: "claude",       args: [] },
  copilot: { file: "gh",           args: ["copilot", "suggest", "-t", "shell"] },
  shell:   { file: "powershell",   args: [] },
};

export interface PtySessionEvents {
  data: (base64: string) => void;
  exit: (exitCode: number) => void;
}

export class PtySession extends EventEmitter {
  readonly id: string;
  readonly command: string;
  readonly startedAt: Date;
  private proc: pty.IPty;
  private killTimer: NodeJS.Timeout;
  private dead = false;

  constructor(id: string, command: string, cols: number, rows: number) {
    super();
    this.id = id;
    this.command = command;
    this.startedAt = new Date();

    const preset = SESSION_PRESETS[command];
    const [file, args] = preset
      ? [preset.file, preset.args]
      : this.parseCommand(command);

    this.proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env["USERPROFILE"] ?? process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
    });

    this.proc.onData((raw: string) => {
      if (!this.dead) {
        // Encode raw PTY bytes as base64 — preserves ANSI escape sequences
        const b64 = Buffer.from(raw, "binary").toString("base64");
        this.emit("data", b64);
      }
    });

    this.proc.onExit(({ exitCode }) => {
      if (!this.dead) {
        this.dead = true;
        clearTimeout(this.killTimer);
        this.emit("exit", exitCode ?? 0);
      }
    });

    this.killTimer = setTimeout(() => {
      if (!this.dead) {
        this.destroy();
        this.emit("exit", -1);
      }
    }, config.maxSessionDurationMs);
  }

  write(data: string): void {
    if (!this.dead) this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.dead) this.proc.resize(cols, rows);
  }

  destroy(): void {
    if (!this.dead) {
      this.dead = true;
      clearTimeout(this.killTimer);
      try { this.proc.kill(); } catch { /* already dead */ }
    }
  }

  get alive(): boolean {
    return !this.dead;
  }

  private parseCommand(command: string): [string, string[]] {
    const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [command];
    return [parts[0], parts.slice(1)];
  }
}
