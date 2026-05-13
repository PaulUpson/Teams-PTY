import { WebPubSubServiceClient } from "@azure/web-pubsub";
import type { AzureFunction, Context, HttpRequest } from "@azure/functions";

const HUB = "terminal";

const serviceClient = new WebPubSubServiceClient(
  process.env["WEB_PUBSUB_CONNECTION_STRING"]!,
  HUB,
);

const negotiate: AzureFunction = async (context: Context, req: HttpRequest) => {
  // Azure Static Web Apps injects the authenticated user's principal name here.
  // If auth is not configured this will be undefined — token is still issued but
  // the laptop agent's ALLOWED_USER_IDS check will enforce access control.
  const userId: string | undefined =
    req.headers["x-ms-client-principal-name"] || undefined;

  const token = await serviceClient.getClientAccessToken({
    userId,
    roles: [
      "webpubsub.joinLeaveGroup.browser",
      "webpubsub.sendToGroup.laptop",
    ],
    expirationTimeInMinutes: 60,
  });

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: token.url }),
  };
};

export default negotiate;
