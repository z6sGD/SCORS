// src/scorsCore.js
import { generateScorsDeviceId } from "./scorsToken.js";

export async function syncBanlistFromGithub(env) {
  const GITHUB_BANLIST_URL = "https://raw.githubusercontent.com/z6sGD/SCORS/refs/heads/main/banlist.json";

  try {
    const res = await fetch(GITHUB_BANLIST_URL);
    if (!res.ok) throw new Error(`GitHub fetch failed with status ${res.status}`);

    const bannedItems = await res.json();

    for (const item of bannedItems) {
      let banId = "";
      let customReason = "Device listed in SCORS ToS banlist.";

      if (typeof item === "string") {
        banId = item;
      } else if (item && typeof item === "object") {
        banId = item.id || item.deviceId || item.ip || "";
        if (item.reason) customReason = item.reason;
      }

      if (banId) {
        await env.SCORS_BANLIST.put(
          banId,
          JSON.stringify({
            reason: customReason,
            syncedAt: new Date().toISOString(),
          })
        );
      }
    }

    return { success: true, count: bannedItems.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function handleScorsRequest(request, env) {
  const reqUrl = new URL(request.url);

  const normalizedPath = reqUrl.pathname.toLowerCase().replace(/\/$/, "");
  if (normalizedPath !== "/scors" && normalizedPath !== "/scors/sync") {
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

  // Endpoint to manually trigger GitHub Sync
  if (normalizedPath === "/scors/sync") {
    const syncResult = await syncBanlistFromGithub(env);
    return new Response(JSON.stringify(syncResult), {
      status: syncResult.success ? 200 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

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
      const now = Date.now();
      const ipBlockKey = `block:ip:${publicIp}`;
      const blockedAtStr = await env.SCORS_BANLIST.get(ipBlockKey);

      if (blockedAtStr) {
        const blockedAt = parseInt(blockedAtStr, 10);
        if (now - blockedAt < 30000) {
          return new Response(
            JSON.stringify({
              error: "Access Denied",
              reason: "You have been temporarily blocked from sending requests because you have sent too many requests in one second."
            }),
            { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
          );
        }
      }

      const currentSecond = Math.floor(now / 1000);
      const ipRateKey = `rate:ip:${publicIp}:${currentSecond}`;
      const currentCountStr = await env.SCORS_BANLIST.get(ipRateKey);
      const currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;

      if (currentCount >= 5) {
        await env.SCORS_BANLIST.put(ipBlockKey, now.toString(), { expirationTtl: 60 });
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
      const now = Date.now();
      const safeUrlKey = `rate:url:${btoa(targetUrl.href).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100)}`;
      const lastReqTimeStr = await env.SCORS_BANLIST.get(safeUrlKey);

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

      await env.SCORS_BANLIST.put(safeUrlKey, now.toString(), { expirationTtl: 60 });
    }

    // ------------------------------------------------------------------------
    // Device Identification & Dynamic Ban Checks with Custom Reasons
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
      const banRecord = await env.SCORS_BANLIST.get(actualDeviceId);
      if (banRecord !== null) {
        let banReason = "Device listed in SCORS ToS banlist.";
        
        try {
          const parsedRecord = JSON.parse(banRecord);
          if (parsedRecord && parsedRecord.reason) {
            banReason = parsedRecord.reason;
          }
        } catch (_) {
          if (typeof banRecord === "string" && banRecord.length > 0 && !banRecord.startsWith("{")) {
            banReason = banRecord;
          }
        }

        return new Response(
          JSON.stringify({
            error: "Access Denied",
            reason: banReason,
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
