// src/worker.js
import { handleScorsRequest } from "./scorsCore.js";

export default {
  async fetch(request, env, ctx) {
    const scorsResponse = await handleScorsRequest(request, env);
    if (scorsResponse) {
      return scorsResponse;
    }

    return new Response(
      "SCORS Stateless Edge Proxy Engine Active. Endpoint: /scors?url=[https://example.com](https://example.com)",
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }
    );
  },
};
