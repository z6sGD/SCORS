import { handleScorsRequest } from "../src/scorsCore.js";

export async function onRequest(context) {
  const response = await handleScorsRequest(context.request);

  if (response) {
    return response;
  }

  // Pass non-/scors requests to static assets (e.g. public/index.html)
  return context.next();
}
