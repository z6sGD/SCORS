import { generateScorsDeviceId } from "./scorsToken.js";
import { fetchViaSocketProxy } from "./socketProxy.js";

const GITHUB_BANLIST_URL = "../banlist.json";

export async function syncBanlistFromGithub(env) {
  try {
    if (!env || !env.SCORS_BANLIST) {
      throw new Error("SCORS_BANLIST KV namespace binding not found.");
    }

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

export async function handleScorsRequest(request, env = {}) {
  const reqUrl = new URL(request.url);
  const normalizedPath = reqUrl.pathname.toLowerCase().replace(/\/$/, "");

  // CORS Preflight for Admin API endpoints
  if (normalizedPath.startsWith("/scors/admin/api") && request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
      },
    });
  }

  // Admin API Routing (Used by decoupled admin apps)
  if (normalizedPath.startsWith("/scors/admin/api")) {
    const adminCorsHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    const providedSecret = request.headers.get("X-Admin-Secret") || reqUrl.searchParams.get("secret");
    if (!env || !env.ADMIN_SECRET || providedSecret !== env.ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid Admin Secret" }), {
        status: 401,
        headers: adminCorsHeaders,
      });
    }

    if (normalizedPath === "/scors/admin/api/list" && request.method === "GET") {
      const list = await env.SCORS_BANLIST.list();
      const keysWithValues = await Promise.all(
        list.keys.map(async (k) => {
          const val = await env.SCORS_BANLIST.get(k.name);
          return { name: k.name, value: val };
        })
      );
      return new Response(JSON.stringify({ keys: keysWithValues }), { status: 200, headers: adminCorsHeaders });
    }

    if (normalizedPath === "/scors/admin/api/ban" && request.method === "POST") {
      const { id, reason } = await request.json();
      if (!id) return new Response(JSON.stringify({ error: "Missing ID" }), { status: 400, headers: adminCorsHeaders });

      await env.SCORS_BANLIST.put(
        id,
        JSON.stringify({ reason: reason || "Manually banned via Admin Panel", bannedAt: new Date().toISOString() })
      );
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: adminCorsHeaders });
    }

    if (normalizedPath === "/scors/admin/api/unban" && request.method === "POST") {
      const { id } = await request.json();
      if (!id) return new Response(JSON.stringify({ error: "Missing ID" }), { status: 400, headers: adminCorsHeaders });

      await env.SCORS_BANLIST.delete(id);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: adminCorsHeaders });
    }
  }

  // Filter non-proxy routes
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

  // Explicit GitHub Banlist Sync Endpoint
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

    const publicIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
    const localIp = request.headers.get("x-local-ip") || reqUrl.searchParams.get("local_ip") || "10.0.0.1";
    const macAddr = request.headers.get("x-mac-address") || reqUrl.searchParams.get("mac") || "";
    const userAgent = request.headers.get("user-agent") || "";

    // ------------------------------------------------------------------------
    // RATE LIMITER 1: IP Burst Protection (5 req/sec -> 30s temp block)
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
    // RATE LIMITER 2: Target URL Limiter (1 req / 10 sec per target URL)
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
    // Device Fingerprinting & Ban Evaluation
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

    // Header Adjustments for Outbound Proxying
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

    // ------------------------------------------------------------------------
    // OUTBOUND EXECUTION (Sockets Residential Proxy vs. Direct Fetch)
    // ------------------------------------------------------------------------
    let response;

    if (env && env.PROXY_HOST && env.PROXY_PORT) {
      const proxyConfig = {
        host: env.PROXY_HOST,
        port: parseInt(env.PROXY_PORT, 10),
        username: env.PROXY_USER || "",
        password: env.PROXY_PASS || "",
      };
      response = await fetchViaSocketProxy(targetUrl, fetchOpts, proxyConfig);
    } else {
      response = await fetch(targetUrl.href, fetchOpts);
    }

    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));
    responseHeaders.delete("X-Frame-Options");
    responseHeaders.delete("Content-Security-Policy");

    const contentType = responseHeaders.get("content-type") || "";

    // Automatic Hyperlink & Asset Proxy Rewriting for HTML responses
    if (contentType.includes("text/html")) {
      const rewriter = new HTMLRewriter()
        .on("a[href]", {
          element(element) {
            const href = element.getAttribute("href");
            if (href && !href.startsWith("javascript:") && !href.startsWith("#") && !href.startsWith("mailto:")) {
              try {
                const absoluteUrl = new URL(href, targetUrl.href).href;
                element.setAttribute("href", `${reqUrl.origin}/scors?url=${encodeURIComponent(absoluteUrl)}`);
              } catch (_) {}
            }
          },
        })
        .on("form[action]", {
          element(element) {
            const action = element.getAttribute("action");
            if (action) {
              try {
                const absoluteUrl = new URL(action, targetUrl.href).href;
                element.setAttribute("action", `${reqUrl.origin}/scors?url=${encodeURIComponent(absoluteUrl)}`);
              } catch (_) {}
            }
          },
        })
        .on("img[src], script[src], link[href], iframe[src]", {
          element(element) {
            const attrName = element.hasAttribute("src") ? "src" : "href";
            const attrVal = element.getAttribute(attrName);
            if (attrVal && !attrVal.startsWith("data:")) {
              try {
                const absoluteUrl = new URL(attrVal, targetUrl.href).href;
                element.setAttribute(attrName, `${reqUrl.origin}/scors?url=${encodeURIComponent(absoluteUrl)}`);
              } catch (_) {}
            }
          },
        });

      return rewriter.transform(
        new Response(response.body, {
          status: response.status,
          headers: responseHeaders,
        })
      );
    }

    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: "SCORS Proxy Error", message: err.message }), {
      status: 502,
      headers: corsHeaders,
    });
  }
}
