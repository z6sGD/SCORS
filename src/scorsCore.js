// src/scorsCore.js
import { generateScorsDeviceId } from "./scorsToken.js";

export async function handleScorsRequest(request, env) {
  const reqUrl = new URL(request.url);

  const normalizedPath = reqUrl.pathname.toLowerCase().replace(/\/$/, "");
  if (normalizedPath !== "/scors") {
    return null;
  }

  const origin = request.headers.get("Origin") || "*";
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
    "Access-Control-Max-Age": "86400",
  };

  if (origin !== "*") corsHeaders["Access-Control-Allow-Credentials"] = "true";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  let targetUrlStr = reqUrl.searchParams.get("url");
  if (!targetUrlStr) {
    return new Response(
      JSON.stringify({ status: "active", endpoint: "SCORS Proxy API", usage: `${reqUrl.pathname}?url=example.com` }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  targetUrlStr = targetUrlStr.trim();
  if (!/^https?:\/\//i.test(targetUrlStr)) targetUrlStr = "https://" + targetUrlStr;

  try {
    const targetUrl = new URL(targetUrlStr);

    const hostname = targetUrl.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local")) {
      return new Response(JSON.stringify({ error: "Forbidden target host" }), { status: 403, headers: corsHeaders });
    }

    // Context Extraction
    const publicIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
    const localIp = request.headers.get("x-local-ip") || reqUrl.searchParams.get("local_ip") || "10.0.0.1";
    const macAddr = request.headers.get("x-mac-address") || reqUrl.searchParams.get("mac") || "";
    const userAgent = request.headers.get("user-agent") || "";

    // ------------------------------------------------------------------------
    // RATE LIMITER 1: IP Burst Protection (> 5 requests/sec -> 30s block)
    // ------------------------------------------------------------------------
    if (env && env.SCORS_BANLIST) {
      const ipBlockKey = `block:ip:${publicIp}`;
      const isIpBlocked = await env.SCORS_BANLIST.get(ipBlockKey);

      if (isIpBlocked !== null) {
        return new Response(
          JSON.stringify({
            error: "Access Denied",
            reason: "You have been temporarily blocked from sending requests because you have sent too many requests in one second."
          }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const currentSecond = Math.floor(Date.now() / 1000);
      const ipRateKey = `rate:ip:${publicIp}:${currentSecond}`;
      const currentCountStr = await env.SCORS_BANLIST.get(ipRateKey);
      const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;

      if (currentCount >= 5) {
        // Blacklist IP for 30 seconds in KV
        await env.SCORS_BANLIST.put(ipBlockKey, "temp_banned", { expirationTtl: 30 });
        return new Response(
          JSON.stringify({
            error: "Access Denied",
            reason: "You have been temporarily blocked from sending requests because you have sent too many requests in one second."
          }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      } else {
        await env.SCORS_BANLIST.put(ipRateKey, (currentCount + 1).toString(), { expirationTtl: 60 });
      }
    }

    // ------------------------------------------------------------------------
    // RATE LIMITER 2: Target URL Limiter (1 request / 10 seconds per URL)
    // ------------------------------------------------------------------------
    if (env && env.SCORS_BANLIST) {
      const urlKey = `rate:url:${btoa(targetUrl.href).slice(0, 100)}`;
      const lastReqTimeStr = await env.SCORS_BANLIST.get(urlKey);
      const now = Date.now();

      if (lastReqTimeStr) {
        const lastReqTime = parseInt(lastReqTimeStr, 10);
        const elapsedMs = now - lastReqTime;

        if (elapsedMs < 10000) {
          const remainingSeconds = Math.ceil((10000 - elapsedMs) / 1000);
          return new Response(
            JSON.stringify({
              error: "Too Many Requests",
              reason: `You have been sending too many requests, try again in ${remainingSeconds} seconds.`
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": remainingSeconds.toString(),
                ...corsHeaders,
              },
            }
          );
        }
      }

      await env.SCORS_BANLIST.put(urlKey, now.toString(), { expirationTtl: 10 });
    }

    // ------------------------------------------------------------------------
    // Device Identification & Access Control Check
    // ------------------------------------------------------------------------
    const actualDeviceId = generateScorsDeviceId(publicIp, localIp, macAddr, userAgent);

    const clientProvidedToken = request.headers.get("SCORS-Unique-Device-ID");
    if (clientProvidedToken && clientProvidedToken !== actualDeviceId) {
      return new Response(
        JSON.stringify({ error: "Security Exception", message: "Spoofed SCORS Device ID detected." }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (env && env.SCORS_BANLIST) {
      const isBanned = await env.SCORS_BANLIST.get(actualDeviceId);
      if (isBanned !== null) {
        return new Response(
          JSON.stringify({
            error: "Access Denied",
            reason: "Device listed in SCORS ToS banlist.",
            deviceId: actualDeviceId,
          }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // Proceeding to proxy request...
    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.set("Host", targetUrl.host);
    modifiedHeaders.set("SCORS-Provider", reqUrl.host);
    modifiedHeaders.set("SCORS-Unique-Device-ID", actualDeviceId);

    ["cf-connecting-ip", "cf-ray", "cf-visitor", "content-length", "accept-encoding"].forEach((h) =>
      modifiedHeaders.delete(h)
    );

    const fetchOpts = {
      method: request.method,
      headers: modifiedHeaders,
      redirect: "follow",
    };

    if (!["GET", "HEAD"].includes(request.method) && request.body) {
      fetchOpts.body = request.body;
      fetchOpts.duplex = "half";
    }

    const response = await fetch(targetUrl.href, fetchOpts);

    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));
    responseHeaders.delete("X-Frame-Options");
    responseHeaders.delete("Content-Security-Policy");

    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: "SCORS Proxy Error", message: err.message }), {
      status: 502,
      headers: corsHeaders,
    });
  }
}
