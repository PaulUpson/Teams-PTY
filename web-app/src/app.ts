import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  WebPubSubClient,
  WebPubSubJsonReliableProtocol,
} from "@azure/web-pubsub-client";
import type { BrowserToLaptop, LaptopToBrowser, SessionInfo } from "./protocol";

// ── State ─────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  command: string;
  alive: boolean;
  term: Terminal;
  fitAddon: FitAddon;
  tabEl: HTMLElement;
}

let pubsub: WebPubSubClient | null = null;
let activeSessionId: string | null = null;
const sessions = new Map<string, Session>();

// ── DOM refs ──────────────────────────────────────────────────────────────────

const tabsEl       = document.getElementById("session-tabs")!;
const containerEl  = document.getElementById("terminal-container")!;
const headerEl     = document.getElementById("header")!;
const btnNew       = document.getElementById("btn-new")!;
const btnKill      = document.getElementById("btn-kill")!;
const btnStatus    = document.getElementById("btn-status")!;
const btnFullscreen = document.getElementById("btn-fullscreen")!;
const btnFontUp    = document.getElementById("btn-font-up")!;
const btnFontDown  = document.getElementById("btn-font-down")!;
const dlgNew       = document.getElementById("dlg-new-session") as HTMLDialogElement;
const inpSessionId = document.getElementById("inp-session-id") as HTMLInputElement;
const inpCommand   = document.getElementById("inp-command") as HTMLSelectElement;
const inpCustom    = document.getElementById("inp-custom-command") as HTMLInputElement;
const lblCustom    = document.getElementById("lbl-custom") as HTMLElement;
const btnCreate    = document.getElementById("btn-create")!;

let fontSize = 13;;

// ── Connection ────────────────────────────────────────────────────────────────

function getKey(): string {
  let key = sessionStorage.getItem("negotiate-key");
  if (!key) {
    key = prompt("Enter access key:") ?? "";
    if (key) sessionStorage.setItem("negotiate-key", key);
  }
  return key;
}

async function connect() {
  setStatus("connecting");
  try {
    const key = getKey();
    if (!key) { setStatus("disconnected"); return; }

    const res = await fetch("/api/negotiate", {
      headers: { "x-negotiate-key": key },
    });

    if (res.status === 401) {
      sessionStorage.removeItem("negotiate-key");
      alert("Invalid key — please try again.");
      setStatus("disconnected");
      return;
    }

    if (!res.ok) throw new Error(`negotiate failed: ${res.status}`);
    const { url } = await res.json() as { url: string };

    pubsub = new WebPubSubClient(url, { protocol: WebPubSubJsonReliableProtocol() });

    pubsub.on("connected", async () => {
      setStatus("connected");
      await pubsub!.joinGroup("browser");
      send({ type: "session.list" });
    });

    pubsub.on("disconnected", () => setStatus("disconnected"));

    pubsub.on("group-message", (e) => {
      if (e.message.group !== "browser") return;
      handleServerMessage(e.message.data as LaptopToBrowser);
    });

    await pubsub.start();
  } catch (err) {
    console.error("connect failed:", err);
    setStatus("disconnected");
    setTimeout(connect, 5000); // retry
  }
}

function send(msg: BrowserToLaptop) {
  pubsub?.sendToGroup("laptop", msg, "json").catch(console.error);
}

function setStatus(state: "connected" | "disconnected" | "connecting") {
  btnStatus.className = state;
  btnStatus.title = state;
}

// ── Server message handler ────────────────────────────────────────────────────

function handleServerMessage(msg: LaptopToBrowser) {
  switch (msg.type) {
    case "session.output": {
      const session = sessions.get(msg.sessionId);
      if (session) {
        // Decode base64 PTY bytes and write directly to xterm — preserves ANSI
        const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
        session.term.write(bytes);
      }
      break;
    }
    case "session.exit": {
      const session = sessions.get(msg.sessionId);
      if (session) {
        session.alive = false;
        session.tabEl.classList.add("dead");
        session.term.writeln(`\r\n\x1b[33m[exited with code ${msg.exitCode}]\x1b[0m`);
      }
      break;
    }
    case "session.list.response": {
      syncSessionList(msg.sessions);
      break;
    }
    case "error": {
      console.error("[server error]", msg.message);
      // Show in active terminal if available
      const active = activeSessionId ? sessions.get(activeSessionId) : null;
      active?.term.writeln(`\r\n\x1b[31m[error: ${msg.message}]\x1b[0m`);
      break;
    }
  }
}

// ── Session management ────────────────────────────────────────────────────────

function createLocalSession(id: string, command: string, alive = true): Session {
  const term = new Terminal({
    cursorBlink: true,
    fontSize,
    fontFamily: '"Cascadia Code", "Fira Code", monospace',
    theme: {
      background:   "#1a1a1a",
      foreground:   "#e0e0e0",
      cursor:       "#4caf7d",
      selectionBackground: "rgba(76,175,125,0.3)",
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // Keystrokes → laptop
  term.onData(data => {
    if (activeSessionId === id) {
      send({ type: "session.input", sessionId: id, data });
    }
  });

  // Tab element
  const tabEl = document.createElement("button");
  tabEl.className = "session-tab" + (alive ? "" : " dead");
  tabEl.textContent = id;
  tabEl.role = "tab";
  tabEl.addEventListener("click", () => activateSession(id));
  tabsEl.appendChild(tabEl);

  const session: Session = { id, command, alive, term, fitAddon, tabEl };
  sessions.set(id, session);
  return session;
}

function activateSession(id: string) {
  if (activeSessionId === id) return;

  // Detach previous
  if (activeSessionId) {
    const prev = sessions.get(activeSessionId);
    if (prev) {
      prev.tabEl.classList.remove("active");
      prev.tabEl.setAttribute("aria-selected", "false");
    }
  }

  // Remove placeholder
  const placeholder = document.getElementById("no-session");
  if (placeholder) placeholder.remove();

  // Clear container and mount new terminal
  containerEl.innerHTML = "";
  const session = sessions.get(id)!;
  session.term.open(containerEl);
  session.fitAddon.fit();
  session.term.focus();
  session.tabEl.classList.add("active");
  session.tabEl.setAttribute("aria-selected", "true");
  activeSessionId = id;
}

function syncSessionList(list: SessionInfo[]) {
  for (const info of list) {
    if (!sessions.has(info.id)) {
      const session = createLocalSession(info.id, info.command, info.alive);
      // Replay scrollback so reconnected browser sees prior output
      if (info.scrollback) {
        const bytes = Uint8Array.from(atob(info.scrollback), c => c.charCodeAt(0));
        session.term.write(bytes);
      }
    }
  }
  if (!activeSessionId && sessions.size > 0) {
    activateSession(sessions.keys().next().value!);
  }
}

function requestNewSession(id: string, command: string) {
  if (sessions.has(id)) {
    alert(`Session '${id}' already exists.`);
    return;
  }
  const cols = 220;
  const rows = 50;
  send({ type: "session.create", sessionId: id, command, cols, rows });
  const session = createLocalSession(id, command, true);
  activateSession(id);
  // Send initial resize based on actual terminal size
  requestAnimationFrame(() => {
    session.fitAddon.fit();
    send({ type: "session.resize", sessionId: id, cols: session.term.cols, rows: session.term.rows });
  });
}

// ── Resize handling ───────────────────────────────────────────────────────────

const resizeObserver = new ResizeObserver(() => {
  if (!activeSessionId) return;
  const session = sessions.get(activeSessionId);
  if (!session) return;
  session.fitAddon.fit();
  send({
    type: "session.resize",
    sessionId: activeSessionId,
    cols: session.term.cols,
    rows: session.term.rows,
  });
});
resizeObserver.observe(containerEl);

// ── UI event handlers ─────────────────────────────────────────────────────────

btnNew.addEventListener("click", () => {
  inpSessionId.value = "";
  inpCommand.value = "claude";
  inpCustom.value = "";
  lblCustom.hidden = true;
  dlgNew.showModal();
  inpSessionId.focus();
});

btnKill.addEventListener("click", () => {
  if (!activeSessionId) return;
  if (!confirm(`Kill session '${activeSessionId}'?`)) return;
  send({ type: "session.kill", sessionId: activeSessionId });
  const session = sessions.get(activeSessionId);
  if (session) {
    session.tabEl.remove();
    session.term.dispose();
    sessions.delete(activeSessionId);
  }
  containerEl.innerHTML = "";
  activeSessionId = null;
  // Activate next session if any
  if (sessions.size > 0) activateSession(sessions.keys().next().value!);
  else showPlaceholder();
});

inpCommand.addEventListener("change", () => {
  lblCustom.hidden = inpCommand.value !== "custom";
});

btnCreate.addEventListener("click", (e) => {
  e.preventDefault();
  const id      = inpSessionId.value.trim();
  const command = inpCommand.value === "custom" ? inpCustom.value.trim() : inpCommand.value;
  if (!id || !command) return;
  dlgNew.close();
  requestNewSession(id, command);
});

// Close dialog on backdrop click
dlgNew.addEventListener("click", (e) => {
  if (e.target === dlgNew) dlgNew.close();
});

// Fullscreen toggle
btnFullscreen.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  }
});
document.addEventListener("fullscreenchange", () => {
  btnFullscreen.textContent = document.fullscreenElement ? "⤓" : "⤢";
});

// Font size controls — resize all open terminals
function setFontSize(size: number) {
  fontSize = Math.max(8, Math.min(24, size));
  for (const s of sessions.values()) {
    s.term.options.fontSize = fontSize;
    s.fitAddon.fit();
  }
}
btnFontUp.addEventListener("click",   () => setFontSize(fontSize + 1));
btnFontDown.addEventListener("click", () => setFontSize(fontSize - 1));

// Visual viewport — hide header when soft keyboard appears on mobile
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const keyboardVisible =
      window.visualViewport!.height < window.innerHeight * 0.75;
    // In portrait, reclaim space when keyboard is open
    headerEl.style.display =
      (keyboardVisible && window.innerWidth < 768) ? "none" : "";
    // Always refit after viewport change
    if (activeSessionId) {
      const s = sessions.get(activeSessionId);
      if (s) {
        s.fitAddon.fit();
        send({ type: "session.resize", sessionId: activeSessionId,
               cols: s.term.cols, rows: s.term.rows });
      }
    }
  });
}

// Orientation change refit
window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    if (activeSessionId) sessions.get(activeSessionId)?.fitAddon.fit();
  }, 300); // brief delay for browser to finish rotating
});

function showPlaceholder() {
  const el = document.createElement("div");
  el.id = "no-session";
  el.innerHTML = `<p>No active sessions</p><p>Press <kbd>+</kbd> to start one</p>`;
  containerEl.appendChild(el);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

showPlaceholder();
connect();
