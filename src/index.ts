import { handleScorsRequest, syncBanlistFromGithub } from "./scorsCore.js";

export interface Env {
  SCORS_BANLIST: KVNamespace;
  ADMIN_SECRET?: string;
  RATE_LIMITER?: any;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const scorsResponse = await handleScorsRequest(request, env);
    if (scorsResponse) {
      return scorsResponse;
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
