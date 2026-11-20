import { handleScorsRequest } from "../src/scorsCore.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.pathname === "/robots.txt") {
    return new Response("User-agent: *\nAllow: /\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const scorsResponse = await handleScorsRequest(request, env);
  if (scorsResponse) {
    return scorsResponse;
  }

  return context.next();
}
