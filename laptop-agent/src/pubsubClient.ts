import {
  WebPubSubClient,
  WebPubSubJsonReliableProtocol,
  OnGroupDataMessageArgs,
} from "@azure/web-pubsub-client";
import { config } from "./config";
import type { BrowserToLaptop, LaptopToBrowser } from "./protocol";

const HUB          = "terminal";
const GROUP_LAPTOP  = "laptop";
const GROUP_BROWSER = "browser";

export class PubSubClient {
  private client: WebPubSubClient;
  private ready = false;

  constructor(private onMessage: (msg: BrowserToLaptop, userId: string | undefined) => void) {
    this.client = new WebPubSubClient(
      { hub: HUB, credential: { getClientAccessUrl: () => this.getAccessUrl() } },
      { protocol: new WebPubSubJsonReliableProtocol() },
    );

    this.client.on("connected", async () => {
      console.log("[pubsub] connected");
      await this.client.joinGroup(GROUP_LAPTOP);
      this.ready = true;
    });

    this.client.on("disconnected", (e) => {
      this.ready = false;
      console.warn("[pubsub] disconnected:", e.message);
    });

    this.client.on("group-message", (e: OnGroupDataMessageArgs) => {
      if (e.message.group !== GROUP_LAPTOP) return;
      const userId = e.message.fromUserId;

      if (config.allowedUserIds.length > 0 && (!userId || !config.allowedUserIds.includes(userId))) {
        console.warn(`[pubsub] rejected message from unauthorized user: ${userId}`);
        return;
      }

      try {
        const msg = e.message.data as BrowserToLaptop;
        this.onMessage(msg, userId);
      } catch (err) {
        console.error("[pubsub] failed to parse message:", err);
      }
    });
  }

  async start(): Promise<void> {
    await this.client.start();
  }

  async send(msg: LaptopToBrowser): Promise<void> {
    if (!this.ready) return;
    try {
      await this.client.sendToGroup(GROUP_BROWSER, msg, "json");
    } catch (err) {
      console.error("[pubsub] send failed:", err);
    }
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  private async getAccessUrl(): Promise<string> {
    // Parse connection string to build access URL directly — avoids needing the
    // service SDK on the agent side; the client SDK accepts a URL or a factory.
    // Format: Endpoint=https://...;AccessKey=...;Version=1.0;
    const connStr = config.webPubSubConnectionString;
    const endpoint = connStr.match(/Endpoint=([^;]+)/)?.[1];
    const key      = connStr.match(/AccessKey=([^;]+)/)?.[1];
    if (!endpoint || !key) throw new Error("Invalid WEB_PUBSUB_CONNECTION_STRING format");

    // Use the @azure/web-pubsub service client just for token generation
    const { WebPubSubServiceClient } = await import("@azure/web-pubsub");
    const svc = new WebPubSubServiceClient(connStr, HUB);
    const token = await svc.getClientAccessToken({
      roles: [
        `webpubsub.joinLeaveGroup.${GROUP_LAPTOP}`,
        `webpubsub.sendToGroup.${GROUP_BROWSER}`,
      ],
    });
    return token.url;
  }
}
