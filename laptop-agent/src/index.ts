import { PubSubClient } from "./pubsubClient";
import { SessionManager } from "./sessionManager";
import { config } from "./config";
import type { BrowserToLaptop } from "./protocol";

const sessions = new SessionManager(
  (sessionId, data) => pubsub.send({ type: "session.output", sessionId, data }),
  (sessionId, exitCode) => {
    console.log(`[session] '${sessionId}' exited with code ${exitCode}`);
    pubsub.send({ type: "session.exit", sessionId, exitCode });
  },
);

const pubsub = new PubSubClient((msg: BrowserToLaptop, userId) => {
  switch (msg.type) {
    case "session.create": {
      const err = sessions.create(msg.sessionId, msg.command, msg.cols, msg.rows);
      if (err) pubsub.send({ type: "error", message: err });
      else console.log(`[session] created '${msg.sessionId}' (${msg.command}) for ${userId}`);
      break;
    }
    case "session.input": {
      const err = sessions.input(msg.sessionId, msg.data);
      if (err) pubsub.send({ type: "error", message: err });
      break;
    }
    case "session.resize": {
      sessions.resize(msg.sessionId, msg.cols, msg.rows);
      break;
    }
    case "session.kill": {
      const killed = sessions.kill(msg.sessionId);
      if (!killed) pubsub.send({ type: "error", message: `No session '${msg.sessionId}'` });
      else console.log(`[session] killed '${msg.sessionId}'`);
      break;
    }
    case "session.list": {
      pubsub.send({ type: "session.list.response", sessions: sessions.list() });
      break;
    }
    default: {
      const _exhaustive: never = msg;
      console.warn("[agent] unknown message type:", (_exhaustive as any).type);
    }
  }
});

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => console.error("[agent] unhandledRejection:", reason));

async function main() {
  console.log("[agent] starting — connecting to Azure Web PubSub...");
  await pubsub.start();
  console.log("[agent] ready. Waiting for browser connections.");
}

async function shutdown() {
  console.log("[agent] shutting down...");
  sessions.destroyAll();
  await pubsub.stop();
  process.exit(0);
}

main().catch(err => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
