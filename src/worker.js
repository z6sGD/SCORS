// src/worker.js
import { handleScorsRequest } from "./scorsCore.js";

export default {
  async fetch(request, env, ctx) {
    const scorsResponse = await handleScorsRequest(request, env);
    if (scorsResponse) {
      return scorsResponse;
    }

    return new Response(
      "ScriptCraft Cross-Origin Resource Sharing (SCORS) is now active. Endpoint: /scors?url=https://example.com",
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }
    );
  },
};
