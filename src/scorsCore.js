import { generateScorsDeviceId } from "./scorsToken.js";
import { fetchViaSocketProxy } from "./socketProxy.js";

const GITHUB_BANLIST_URL = "https://raw.githubusercontent.com/z6sGD/SCORS/main/banlist.json";

function encodeUrlSafeBase64(str) {
  return btoa(encodeURIComponent(str))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeUrlSafeBase64(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  try {
    return decodeURIComponent(atob(base64));
  } catch (_) {
    return null;
  }
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function getIpv6Prefix64(ipStr) {
  const cleaned = (ipStr || "").trim().toLowerCase();
  if (!cleaned.includes(":")) return null;

  if (cleaned.startsWith("::ffff:") && cleaned.includes(".")) {
    return null;
  }

  let segments = [];
  if (cleaned.includes("::")) {
    const parts = cleaned.split("::");
    if (parts.length > 2) return null;
    const leftParts = parts[0] ? parts[0].split(":") : [];
    const rightParts = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - (leftParts.length + rightParts.length);
    if (missing < 0) return null;
    segments = [...leftParts, ...Array(missing).fill("0"), ...rightParts];
  } else {
    segments = cleaned.split(":");
  }

  if (segments.length !== 8) return null;
  const normalizedPrefix = segments
    .slice(0, 4)
    .map((seg) => (parseInt(seg, 16) || 0).toString(16))
    .join(":");

  return `${normalizedPrefix}::/64`;
}

function unwrapProxyUrl(rawUrl, proxyOrigin, fallbackBase = undefined) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  try {
    let current = fallbackBase ? new URL(rawUrl, fallbackBase) : new URL(rawUrl);
    let guard = 0;
    while (
      current.origin === proxyOrigin &&
      current.pathname.toLowerCase().replace(/\/$/, "") === "/scors" &&
      (current.searchParams.has("url") || current.searchParams.has("ws")) &&
      guard < 6
    ) {
      const inner = current.searchParams.get("url") || current.searchParams.get("ws");
      if (!inner) break;
      let decodedInner = inner.trim();
      if (!/^https?:\/\//i.test(decodedInner) && !/^wss?:\/\//i.test(decodedInner)) {
        const b64 = decodeUrlSafeBase64(decodedInner);
        decodedInner = b64 && (/^https?:\/\//i.test(b64) || /^wss?:\/\//i.test(b64))
          ? b64
          : `https://${decodedInner}`;
      }
      current = new URL(decodedInner);
      guard++;
    }
    return current.href;
  } catch (_) {
    return rawUrl;
  }
}

function rewriteCssUrls(cssText, baseUrl, proxyOrigin) {
  if (!cssText) return cssText;

  let updated = cssText.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, importUrl) => {
    const trimmed = importUrl.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith(proxyOrigin)) return match;
    try {
      const absUrl = unwrapProxyUrl(new URL(trimmed, baseUrl).href, proxyOrigin);
      return `@import ${quote}${proxyOrigin}/scors?url=${encodeURIComponent(absUrl)}${quote}`;
    } catch (_) {
      return match;
    }
  });

  updated = updated.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, assetUrl) => {
    const trimmed = assetUrl.trim();
    if (
      !trimmed ||
      trimmed.startsWith("data:") ||
      trimmed.startsWith("blob:") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith(proxyOrigin)
    ) {
      return match;
    }
    try {
      const absUrl = unwrapProxyUrl(new URL(trimmed, baseUrl).href, proxyOrigin);
      return `url(${quote}${proxyOrigin}/scors?url=${encodeURIComponent(absUrl)}${quote})`;
    } catch (_) {
      return match;
    }
  });

  return updated;
}

async function logUrlVisitByIp(kvStore, ip, targetHref) {
  if (!kvStore || !ip || !targetHref) return;

  const logKey = `log:ip:${ip}`;
  const nowIso = new Date().toISOString();
  let row = {
    ip: ip,
    lastSeen: nowIso,
    visits: [],
  };

  try {
    const existing = await kvStore.get(logKey);
    if (existing) {
      const parsed = JSON.parse(existing);
      if (parsed && Array.isArray(parsed.visits)) {
        row = parsed;
      }
    }
  } catch (_) {}

  row.lastSeen = nowIso;

  const existingVisit = row.visits.find((entry) => entry.url === targetHref);

  if (existingVisit) {
    existingVisit["times visited"] = (existingVisit["times visited"] || 1) + 1;
    existingVisit.timestamp = nowIso;
  } else {
    row.visits.push({
      url: targetHref,
      timestamp: nowIso,
    });
  }

  if (row.visits.length > 500) {
    row.visits = row.visits.slice(-500);
  }

  await kvStore.put(logKey, JSON.stringify(row));
}

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
      let customReason = "Device or IP listed in SCORS ToS banlist.";

      if (typeof item === "string") {
        banId = item;
      } else if (item && typeof item === "object") {
        banId = item.id || item.deviceId || item.ip || "";
        if (item.reason) customReason = item.reason;
      }

      if (banId) {
        const normalizedKey = banId.includes(":") ? banId.trim().toLowerCase() : banId.trim();
        await env.SCORS_BANLIST.put(
          normalizedKey,
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

  if (normalizedPath !== "/scors" && normalizedPath !== "/scorsencrypted" && normalizedPath !== "/browse") {
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

  if (normalizedPath === "/browse") {
    if (reqUrl.search !== "") {
      return null;
    }

    const browserHtmlPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SCORS Browser</title>
  <link rel="icon" type="image/x-icon" href="${reqUrl.origin}/favicon.ico">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2.5rem 2rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); width: 100%; max-width: 500px; text-align: center; border: 1px solid #334155; }
    .icon-box { margin-bottom: 1.2rem; }
    .icon-box img { width: 64px; height: 64px; object-fit: contain; }
    h1 { margin: 0 0 0.5rem 0; font-size: 1.7rem; color: #f97316; }
    p { font-size: 0.95rem; color: #94a3b8; margin-bottom: 1.8rem; line-height: 1.4; }
    .input-wrapper { display: flex; gap: 0.5rem; }
    input[type="text"] { flex: 1; padding: 0.85rem 1rem; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; font-size: 1rem; }
    input[type="text"]:focus { outline: none; border-color: #f97316; }
    button { padding: 0.85rem 1.25rem; border: none; border-radius: 8px; background: #f97316; color: #fff; font-weight: bold; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #ea580c; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-box">
      <img src="${reqUrl.origin}/assets/browsericon.png" alt="Browser Icon" />
    </div>
    <h1>SCORS Web Browser</h1>
    <p>Enter any URL or domain name to begin browsing seamlessly through edge nodes.</p>
    <form id="browserForm" action="${reqUrl.origin}/scors" method="GET">
      <div class="input-wrapper">
        <input type="text" id="targetUrlInput" name="url" placeholder="example.com or https://..." required autocomplete="off" />
        <button type="submit">Launch</button>
      </div>
    </form>
  </div>
  <script>
    document.getElementById('browserForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var raw = document.getElementById('targetUrlInput').value.trim();
      if (!raw) return;
      if (!/^https?:\\/\\//i.test(raw) && !/^wss?:\\/\\//i.test(raw)) {
        raw = 'https://' + raw;
      }
      window.location.href = window.location.origin + '/scors?url=' + encodeURIComponent(raw);
    });
  </script>
</body>
</html>`;

    return new Response(browserHtmlPage, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
    });
  }

  if (normalizedPath === "/scorsencrypted") {
    let rawUrl = reqUrl.searchParams.get("url") || reqUrl.searchParams.get("ws");

    if (!rawUrl) {
      const htmlPage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SCORS URL Encryptor</title>
  <link rel="icon" type="image/x-icon" href="${reqUrl.origin}/favicon.ico">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
    .card { background: #1e293b; padding: 2.5rem 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); width: 100%; max-width: 480px; text-align: center; border: 1px solid #334155; }
    h1 { margin-top: 0; font-size: 1.6rem; color: #f97316; }
    p { font-size: 0.95rem; color: #94a3b8; margin-bottom: 1.8rem; line-height: 1.4; }
    input { width: 100%; padding: 0.85rem 1rem; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; font-size: 1rem; box-sizing: border-box; margin-bottom: 1.2rem; }
    input:focus { outline: none; border-color: #f97316; }
    button { width: 100%; padding: 0.85rem; border: none; border-radius: 8px; background: #f97316; color: #fff; font-weight: bold; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #ea580c; }
  </style>
</head>
<body>
  <div class="card">
    <h1>SCORS Encrypted Proxy</h1>
    <p>Enter any website or API URL to generate an obfuscated SCORS proxy link and launch it directly.</p>
    <form id="encryptForm" action="${reqUrl.origin}/scorsencrypted" method="GET">
      <input type="text" id="targetInput" name="url" placeholder="example.com or https://..." required autocomplete="off" />
      <button type="submit">Encrypt & Launch Proxy</button>
    </form>
  </div>
  <script>
    document.getElementById('encryptForm').addEventListener('submit', function(e) {
      e.preventDefault();
      var raw = document.getElementById('targetInput').value.trim();
      if (!raw) return;

      if (!/^https?:\\/\\//i.test(raw) && !/^wss?:\\/\\//i.test(raw)) {
        raw = 'https://' + raw;
      }

      var encoded = btoa(encodeURIComponent(raw))
        .replace(/\\+/g, '-')
        .replace(/\\//g, '_')
        .replace(/=+$/, '');

      window.location.href = window.location.origin + '/scors?url=' + encoded;
    });
  </script>
</body>
</html>`;

      return new Response(htmlPage, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
      });
    }

    rawUrl = rawUrl.trim();
    if (!/^https?:\/\//i.test(rawUrl) && !/^wss?:\/\//i.test(rawUrl)) {
      rawUrl = "https://" + rawUrl;
    }

    const encryptedString = encodeUrlSafeBase64(rawUrl);
    return Response.redirect(`${reqUrl.origin}/scors?url=${encryptedString}`, 302);
  }

  const isApiCheckReq = reqUrl.searchParams.has("api");
  const isWebSocketReq = (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";

  const rawPublicIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
  const publicIp = rawPublicIp.split(",")[0].trim();
  const localIp = request.headers.get("x-local-ip") || reqUrl.searchParams.get("local_ip") || "10.0.0.1";
  const macAddr = request.headers.get("x-mac-address") || reqUrl.searchParams.get("mac") || "";
  const userAgent = request.headers.get("user-agent") || "";

  const actualDeviceId = generateScorsDeviceId(publicIp, localIp, macAddr, userAgent);

  const clientProvidedToken = request.headers.get("SCORS-Unique-Device-ID");
  if (clientProvidedToken && clientProvidedToken !== actualDeviceId) {
    return new Response(
      JSON.stringify({ error: "Security Exception", message: "Spoofed SCORS Device ID detected." }),
      { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  if (env && env.SCORS_BANLIST) {
    const cleanIp = publicIp.toLowerCase();
    const ipv6Prefix = getIpv6Prefix64(cleanIp);

    const banRecord =
      (await env.SCORS_BANLIST.get(actualDeviceId)) ||
      (await env.SCORS_BANLIST.get(cleanIp)) ||
      (ipv6Prefix ? await env.SCORS_BANLIST.get(ipv6Prefix) : null);

    if (banRecord !== null) {
      let banReason = "Device or IP listed in SCORS ToS banlist.";

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

  if (isApiCheckReq) {
    const startTime = performance.now();

    let kvStatus = "disabled";
    if (env && env.SCORS_BANLIST) {
      try {
        await env.SCORS_BANLIST.get("healthcheck_ping");
        kvStatus = "operational";
      } catch (_) {
        kvStatus = "degraded";
      }
    }

    const responseTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

    return new Response(
      JSON.stringify({
        status: 200,
        service: "SCORS Proxy API",
        state: "operational",
        responseTimeMs: responseTimeMs,
        deviceId: actualDeviceId,
        kvStatus: kvStatus,
        outboundRouting: (env && env.PROXY_HOST) ? "residential_socket_tunnel" : "direct_edge_fetch",
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...corsHeaders,
        },
      }
    );
  }

  let targetUrlStr = reqUrl.searchParams.get("ws") || reqUrl.searchParams.get("url");

  if (!targetUrlStr) {
    return new Response(
      JSON.stringify({
        status: "active",
        endpoint: "SCORS Proxy API",
        usage: {
          apiCheck: `${reqUrl.pathname}?api`,
          browser: `${reqUrl.origin}/browse`,
          encryptedGenerator: `${reqUrl.origin}/scorsencrypted`,
          http: `${reqUrl.pathname}?url=https://example.com`,
          websocket: `${reqUrl.pathname}?ws=wss://echo.websocket.events`
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  targetUrlStr = targetUrlStr.trim();

  if (!/^https?:\/\//i.test(targetUrlStr) && !/^wss?:\/\//i.test(targetUrlStr)) {
    const decodedUrl = decodeUrlSafeBase64(targetUrlStr);
    if (decodedUrl && (/^https?:\/\//i.test(decodedUrl) || /^wss?:\/\//i.test(decodedUrl))) {
      targetUrlStr = decodedUrl;
    } else if (decodedUrl && !decodedUrl.includes(" ")) {
      targetUrlStr = "https://" + decodedUrl;
    } else {
      targetUrlStr = "https://" + targetUrlStr;
    }
  }

  // Unwrap any accidentally double-wrapped proxy URLs before fetching
  targetUrlStr = unwrapProxyUrl(targetUrlStr, reqUrl.origin);

  if (targetUrlStr.startsWith("ws://")) {
    targetUrlStr = targetUrlStr.replace(/^ws:\/\//i, "http://");
  } else if (targetUrlStr.startsWith("wss://")) {
    targetUrlStr = targetUrlStr.replace(/^wss:\/\//i, "https://");
  }

  try {
    const targetUrl = new URL(targetUrlStr);

    // Block infinite self-proxy loops
    if (targetUrl.origin === reqUrl.origin) {
      return new Response(
        JSON.stringify({ error: "Recursive proxy loop blocked" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    reqUrl.searchParams.forEach((value, key) => {
      if (!["url", "ws", "api", "local_ip", "mac"].includes(key)) {
        targetUrl.searchParams.append(key, value);
      }
    });

    const hostname = targetUrl.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local")) {
      return new Response(JSON.stringify({ error: "Forbidden target host" }), { status: 403, headers: corsHeaders });
    }

    const fetchDest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
    const isStaticAsset =
      ["style", "script", "image", "font", "audio", "video"].includes(fetchDest) ||
      targetUrl.pathname.endsWith("/load.php") ||
      /\.(css|js|mjs|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|otf|map|json|mp4|webm|mp3|wav|epk|wasm|bin|data|zip|gz)$/i.test(
        targetUrl.pathname
      );

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

      if (currentCount >= 60) {
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

    if (env && env.SCORS_BANLIST && !isStaticAsset) {
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

    const logStore = env && (env.SCORS_LOGS || env.SCORS_BANLIST);
    if (logStore && !isStaticAsset) {
      await logUrlVisitByIp(logStore, publicIp, targetUrl.href);
    }

const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.delete("host");
    modifiedHeaders.set("Referer", targetUrl.href);
    if (modifiedHeaders.has("Origin")) {
      modifiedHeaders.set("Origin", targetUrl.origin);
    }
    modifiedHeaders.set("SCORS-Provider", reqUrl.host);
    modifiedHeaders.set("SCORS-Unique-Device-ID", actualDeviceId);

    [
      "host",
      "cf-connecting-ip",
      "cf-ray",
      "cf-visitor",
      "cf-worker",
      "cf-ipcountry",
      "x-forwarded-for",
      "x-forwarded-proto",
      "x-real-ip",
      "content-length",
      "cookie",
    ].forEach((h) => modifiedHeaders.delete(h));

    if (!modifiedHeaders.has("User-Agent")) {
      modifiedHeaders.set("User-Agent", userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    }

    const fetchOpts = {
      method: request.method,
      headers: modifiedHeaders,
      redirect: "manual",
    };

    if (!["GET", "HEAD"].includes(request.method) && request.body) {
      fetchOpts.body = request.body;
      fetchOpts.duplex = "half";
    }

    if (isWebSocketReq || reqUrl.searchParams.has("ws")) {
      return fetch(targetUrl.href, fetchOpts);
    }

    let response;

    if (env && env.PROXY_HOST && env.PROXY_PORT) {
      try {
        const proxyConfig = {
          host: env.PROXY_HOST,
          port: parseInt(env.PROXY_PORT, 10),
          username: env.PROXY_USER || "",
          password: env.PROXY_PASS || "",
        };
        response = await fetchViaSocketProxy(targetUrl, fetchOpts, proxyConfig);
      } catch (socketErr) {
        response = await fetch(targetUrl.href, fetchOpts);
      }
    } else {
      response = await fetch(targetUrl.href, fetchOpts);
    }

    // Cleanly rewrite upstream 3xx redirects so they route through the proxy once without looping
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const rawLocation = response.headers.get("Location");
      if (rawLocation) {
        const resolvedLocation = unwrapProxyUrl(new URL(rawLocation, targetUrl.href).href, reqUrl.origin);
        const proxiedLocation = `${reqUrl.origin}/scors?url=${encodeURIComponent(resolvedLocation)}`;
        const redirectHeaders = new Headers(corsHeaders);
        redirectHeaders.set("Location", proxiedLocation);
        return new Response(null, {
          status: response.status,
          headers: redirectHeaders,
        });
      }
    }

    let finalTargetUrl = targetUrl;
    try {
      if (response.url) finalTargetUrl = new URL(response.url);
    } catch (_) {}

    const responseHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));
    responseHeaders.delete("X-Frame-Options");
    responseHeaders.delete("Content-Security-Policy");

    const contentType = responseHeaders.get("content-type") || "";

    if (contentType.includes("text/css")) {
      const rawCss = await response.text();
      const rewrittenCss = rewriteCssUrls(rawCss, finalTargetUrl.href, reqUrl.origin);
      responseHeaders.delete("content-length");
      responseHeaders.delete("content-encoding");
      return new Response(rewrittenCss, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    if (contentType.includes("text/html")) {
      let styleBuffer = "";

      const rewriter = new HTMLRewriter()
        .on("head", {
          element(element) {
            element.prepend(
              `<link rel="icon" type="image/x-icon" href="${reqUrl.origin}/favicon.ico">
              <link rel="shortcut icon" href="${reqUrl.origin}/favicon.ico">
              <script>
                (function() {
                  var PROXY_ORIGIN = ${JSON.stringify(reqUrl.origin)};
                  var TARGET_FULL = ${JSON.stringify(finalTargetUrl.href)};

                  function unwrapAssetUrl(u) {
                    if (!u || typeof u !== 'string') return u;
                    try {
                      var parsed = new URL(u, TARGET_FULL);
                      var guard = 0;
                      while (
                        parsed.origin === PROXY_ORIGIN &&
                        parsed.pathname.toLowerCase().replace(/\\/$/, '') === '/scors' &&
                        parsed.searchParams.has('url') &&
                        guard < 6
                      ) {
                        var inner = parsed.searchParams.get('url');
                        if (!inner) break;
                        parsed = new URL(inner, TARGET_FULL);
                        guard++;
                      }
                      return parsed.href;
                    } catch (e) {
                      return u;
                    }
                  }

                  function proxyAssetUrl(u) {
                    if (!u || typeof u !== 'string') return u;
                    if (
                      u.startsWith('data:') ||
                      u.startsWith('blob:') ||
                      u.startsWith('javascript:') ||
                      u.startsWith('about:')
                    ) {
                      return u;
                    }
                    var cleanTarget = unwrapAssetUrl(u);
                    try {
                      var absUrl = new URL(cleanTarget, TARGET_FULL).href;
                      if (absUrl.startsWith(PROXY_ORIGIN)) return absUrl;
                      return PROXY_ORIGIN + '/scors?url=' + encodeURIComponent(absUrl);
                    } catch (e) {
                      return u;
                    }
                  }

                  // Unwrap document.currentScript.src so scripts like largeEPK.js don't fail getParentUrl()
                  var currentScriptDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript');
                  if (currentScriptDesc && currentScriptDesc.get) {
                    Object.defineProperty(document, 'currentScript', {
                      configurable: true,
                      get: function() {
                        var el = currentScriptDesc.get.call(document);
                        if (!el) return null;
                        return new Proxy(el, {
                          get: function(target, prop) {
                            if (prop === 'src') {
                              return unwrapAssetUrl(target.src);
                            }
                            var val = Reflect.get(target, prop);
                            return typeof val === 'function' ? val.bind(target) : val;
                          }
                        });
                      }
                    });
                  }

                  var linkHrefDesc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
                  if (linkHrefDesc && linkHrefDesc.set) {
                    Object.defineProperty(HTMLLinkElement.prototype, 'href', {
                      get: linkHrefDesc.get,
                      set: function(val) {
                        var rel = (this.getAttribute('rel') || '').toLowerCase();
                        if (rel.indexOf('icon') !== -1) {
                          return linkHrefDesc.set.call(this, PROXY_ORIGIN + '/favicon.ico');
                        }
                        return linkHrefDesc.set.call(this, proxyAssetUrl(val));
                      }
                    });
                  }

                  var scriptSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                  if (scriptSrcDesc && scriptSrcDesc.set) {
                    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                      get: function() {
                        return unwrapAssetUrl(scriptSrcDesc.get.call(this));
                      },
                      set: function(val) {
                        return scriptSrcDesc.set.call(this, proxyAssetUrl(val));
                      }
                    });
                  }

                  var origSetAttr = Element.prototype.setAttribute;
                  Element.prototype.setAttribute = function(name, val) {
                    var attr = name.toLowerCase();
                    if (this.tagName === 'LINK' && attr === 'href') {
                      var rel = (this.getAttribute('rel') || '').toLowerCase();
                      val = rel.indexOf('icon') !== -1 ? (PROXY_ORIGIN + '/favicon.ico') : proxyAssetUrl(val);
                    } else if ((this.tagName === 'SCRIPT' || this.tagName === 'IMG' || this.tagName === 'IFRAME') && attr === 'src') {
                      val = proxyAssetUrl(val);
                    }
                    return origSetAttr.call(this, name, val);
                  };

                  var NativeWebSocket = window.WebSocket;
                  if (NativeWebSocket) {
                    window.WebSocket = function(url, protocols) {
                      try {
                        var cleanWs = unwrapAssetUrl(url);
                        var absUrl = new URL(cleanWs, TARGET_FULL).href;
                        var proxiedWsUrl = PROXY_ORIGIN.replace(/^http/, 'ws') + '/scors?ws=' + encodeURIComponent(absUrl);
                        return new (Function.prototype.bind.apply(NativeWebSocket, [null, proxiedWsUrl, protocols]))();
                      } catch(e) {
                        return new NativeWebSocket(url, protocols);
                      }
                    };
                    window.WebSocket.prototype = NativeWebSocket.prototype;
                  }

                  var originalFetch = window.fetch;
                  if (originalFetch) {
                    window.fetch = function(resource, init) {
                      if (typeof resource === 'string' || resource instanceof URL) {
                        resource = proxyAssetUrl(String(resource));
                      } else if (resource instanceof Request) {
                        resource = new Request(proxyAssetUrl(resource.url), resource);
                      }
                      return originalFetch.call(this, resource, init);
                    };
                  }

                  var origXhrOpen = XMLHttpRequest.prototype.open;
                  if (origXhrOpen) {
                    XMLHttpRequest.prototype.open = function(method, url) {
                      var args = Array.prototype.slice.call(arguments);
                      args[1] = proxyAssetUrl(String(url));
                      return origXhrOpen.apply(this, args);
                    };
                  }

                  var originalPush = history.pushState;
                  var originalReplace = history.replaceState;
                  function fixUrl(u) {
                    if (!u) return u;
                    return proxyAssetUrl(String(u));
                  }
                  if (originalPush) {
                    history.pushState = function(state, unused, url) {
                      return originalPush.call(this, state, unused, fixUrl(url));
                    };
                  }
                  if (originalReplace) {
                    history.replaceState = function(state, unused, url) {
                      return originalReplace.call(this, state, unused, fixUrl(url));
                    };
                  }
                })();
              </script>`,
              { html: true }
            );
          },
        })
        .on("style", {
          element() {
            styleBuffer = "";
          },
          text(chunk) {
            styleBuffer += chunk.text;
            if (chunk.lastInTextNode) {
              chunk.replace(rewriteCssUrls(styleBuffer, finalTargetUrl.href, reqUrl.origin), { html: false });
              styleBuffer = "";
            } else {
              chunk.remove();
            }
          },
        })
        .on("[style]", {
          element(element) {
            const inlineStyle = element.getAttribute("style");
            if (inlineStyle && inlineStyle.includes("url(")) {
              element.setAttribute("style", rewriteCssUrls(inlineStyle, finalTargetUrl.href, reqUrl.origin));
            }
          },
        })
        .on("body", {
          element(element) {
            element.append(
              `<a href="https://github.com/z6sGD/SCORS" target="_blank" rel="noopener noreferrer" id="scors-github-float-btn" title="Support this project on GitHub" aria-label="Support this project on GitHub" style="position:fixed;bottom:16px;left:16px;z-index:2147483647;width:48px;height:48px;background:rgba(203,213,225,0.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.25);border:1px solid rgba(15,23,42,0.15);transition:all 0.2s ease;text-decoration:none;" onmouseover="this.style.background='rgba(203,213,225,0.95)';this.style.transform='scale(1.08)';" onmouseout="this.style.background='rgba(203,213,225,0.75)';this.style.transform='scale(1)';">
                <img src="https://github.com/favicon.ico" alt="Support this project on GitHub" style="width:24px;height:24px;object-fit:contain;display:block;" />
              </a>`,
              { html: true }
            );
          },
        })
        .on("a[href]", {
          element(element) {
            const rawHref = element.getAttribute("href");
            const href = decodeHtmlEntities(rawHref);
            if (href && !href.startsWith("javascript:") && !href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("blob:")) {
              try {
                const absoluteUrl = unwrapProxyUrl(new URL(href, finalTargetUrl.href).href, reqUrl.origin);
                element.setAttribute("href", `${reqUrl.origin}/scors?url=${encodeURIComponent(absoluteUrl)}`);
              } catch (_) {}
            }
          },
        })
        .on("form", {
          element(element) {
            const rawAction = element.getAttribute("action");
            const action = rawAction ? decodeHtmlEntities(rawAction) : finalTargetUrl.href;
            const method = (element.getAttribute("method") || "GET").toUpperCase();

            try {
              const absoluteUrl = new URL(unwrapProxyUrl(action, reqUrl.origin, finalTargetUrl.href), finalTargetUrl.href);

              if (method === "GET") {
                element.setAttribute("action", `${reqUrl.origin}/scors`);
                element.append(
                  `<input type="hidden" name="url" value="${absoluteUrl.href}">`,
                  { html: true }
                );
              } else {
                element.setAttribute("action", `${reqUrl.origin}/scors?url=${encodeURIComponent(absoluteUrl.href)}`);
              }
            } catch (_) {}
          },
        })
        .on("img[src], script[src], link[href], iframe[src]", {
          element(element) {
            const attrName = element.hasAttribute("src") ? "src" : "href";
            const rawAttrVal = element.getAttribute(attrName);
            const attrVal = decodeHtmlEntities(rawAttrVal);
            if (attrVal && !attrVal.startsWith("data:") && !attrVal.startsWith("blob:")) {
              const rel = (element.getAttribute("rel") || "").toLowerCase();
              if (element.tagName === "link" && rel.includes("icon")) {
                element.setAttribute("href", `${reqUrl.origin}/favicon.ico`);
              } else {
                try {
                  const absoluteUrl = unwrapProxyUrl(new URL(attrVal, finalTargetUrl.href).href, reqUrl.origin);
                  element.setAttribute(attrName, `${reqUrl.origin}/scors?url=${encodeURIComponent(absoluteUrl)}`);
                } catch (_) {}
              }
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
