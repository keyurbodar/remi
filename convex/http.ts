import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

// Root route so the convex.site URL serves the deployment before the
// frontend exists. The AgentMail webhook joins here in r4.
const serveSpine = httpAction(async () => {
  return new Response(
    "<!doctype html><title>Remi</title><h1>Remi backend spine</h1><p>Contracts frozen, schema deployed, seed data loaded.</p>",
    { headers: { "content-type": "text/html" } },
  );
});

const http = httpRouter();

http.route({ path: "/", method: "GET", handler: serveSpine });

export default http;
