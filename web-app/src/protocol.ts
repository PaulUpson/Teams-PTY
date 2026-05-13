// Shared message protocol between laptop-agent and web-app.
// All messages are exchanged as JSON over Web PubSub.
// PTY output bytes are base64-encoded to safely carry raw ANSI sequences.

export type BrowserToLaptop =
  | { type: "session.create"; sessionId: string; command: string; cols: number; rows: number }
  | { type: "session.input";  sessionId: string; data: string }
  | { type: "session.resize"; sessionId: string; cols: number; rows: number }
  | { type: "session.kill";   sessionId: string }
  | { type: "session.list" };

export type LaptopToBrowser =
  | { type: "session.output";        sessionId: string; data: string } // base64 PTY bytes
  | { type: "session.exit";          sessionId: string; exitCode: number }
  | { type: "session.list.response"; sessions: SessionInfo[] }
  | { type: "error";                 message: string };

export interface SessionInfo {
  id: string;
  command: string;
  alive: boolean;
  startedAt: string;    // ISO timestamp
  scrollback: string;   // base64 encoded last 50KB of PTY output
}
