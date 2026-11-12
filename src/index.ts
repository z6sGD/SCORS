import { handleScorsRequest, syncBanlistFromGithub } from "./scorsCore.js";
import indexHtml from "../404.html";

export interface Env {
  SCORS_BANLIST: KVNamespace;
  ADMIN_SECRET?: string;
  PROXY_HOST?: string;
  PROXY_PORT?: string;
  PROXY_USER?: string;
  PROXY_PASS?: string;
  RATE_LIMITER?: any;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // 1. Tell search engines they are allowed to index the site
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // 2. Run your proxy logic
    const scorsResponse = await handleScorsRequest(request, env);
    if (scorsResponse) {
      return scorsResponse;
    }

    // 3. Serve your homepage HTML instead of a 404 error
    if (url.pathname === "/" || url.pathname === "/404.html") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(syncBanlistFromGithub(env));
  },
};
