import { handleScorsRequest } from "./scorsCore.js";

export default {
  async fetch(request, env, ctx) {
    const response = await handleScorsRequest(request);
    
    if (response) {
      return response;
    }

    return new Response("Not Found", { status: 404 });
  },
};
