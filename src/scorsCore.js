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

function rewriteCssUrls(cssText, baseUrl, proxyOrigin) {
  if (!cssText) return cssText;

  // Rewrite @import "..." or @import '...'
  let updated = cssText.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, importUrl) => {
    const trimmed = importUrl.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith(proxyOrigin)) return match;
    try {
      const absUrl = new URL(trimmed, baseUrl).href;
      return `@import ${quote}${proxyOrigin}/scors?url=${encodeURIComponent(absUrl)}${quote}`;
    } catch (_) {
      return match;
    }
  });

  // Rewrite all url(...) references (covers @import url(...), fonts, background images, etc.)
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
      const absUrl = new URL(trimmed, baseUrl).href;
      return `url(${quote}${proxyOrigin}/scors?url=${encodeURIComponent(absUrl)}${quote})`;
    } catch (_) {
      return match;
    }
  });

  return updated;
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

  // Filter non-proxy routes
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

  // ------------------------------------------------------------------------
  // BROWSER LAUNCHER INTERFACE ROUTE (/browse - Exact match only, no query params)
  // ------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------
  // ENCRYPTED URL UI & GENERATOR ROUTE (/scorsencrypted)
  // ------------------------------------------------------------------------
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

  // ------------------------------------------------------------------------
  // Device Fingerprinting & Ban Evaluation
  // ------------------------------------------------------------------------
  const publicIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
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

  // ------------------------------------------------------------------------
  // SELF HEALTH / API CHECK ROUTE (/scors?api)
  // ------------------------------------------------------------------------
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
        service: "SCORS API",
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

  // ------------------------------------------------------------------------
  // TARGET URL SELECTION & DECRYPTION ENGINE
  // ------------------------------------------------------------------------
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

  if (targetUrlStr.startsWith("ws://")) {
    targetUrlStr = targetUrlStr.replace(/^ws:\/\//i, "http://");
  } else if (targetUrlStr.startsWith("wss://")) {
    targetUrlStr = targetUrlStr.replace(/^wss:\/\//i, "https://");
  }

  try {
    const targetUrl = new URL(targetUrlStr);

    reqUrl.searchParams.forEach((value, key) => {
      if (!["url", "ws", "api", "local_ip", "mac"].includes(key)) {
        targetUrl.searchParams.append(key, value);
      }
    });

    const hostname = targetUrl.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local")) {
      return new Response(JSON.stringify({ error: "Forbidden target host" }), { status: 403, headers: corsHeaders });
    }

    const isStaticAsset = /\.(css|js|mjs|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|otf|map|json|mp4|webm|mp3|wav)$/i.test(
      targetUrl.pathname
    );

    // ------------------------------------------------------------------------
    // RATE LIMITER 1: IP Burst Protection (60 req/sec -> 30s temp block)
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

    // ------------------------------------------------------------------------
    // RATE LIMITER 2: Target URL Limiter (Non-asset navigations: 1 req / 10 sec)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // Header Normalization & Cookie Stripping (Stateless Engine)
    // ------------------------------------------------------------------------
    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.set("Host", targetUrl.host);
    modifiedHeaders.set("Referer", targetUrl.href);
    if (modifiedHeaders.has("Origin")) {
      modifiedHeaders.set("Origin", targetUrl.origin);
    }
    modifiedHeaders.set("SCORS-Provider", reqUrl.host);
    modifiedHeaders.set("SCORS-Unique-Device-ID", actualDeviceId);

    ["cf-connecting-ip", "cf-ray", "cf-visitor", "cf-worker", "cf-ipcountry", "content-length", "cookie"].forEach((h) =>
      modifiedHeaders.delete(h)
    );

    if (!modifiedHeaders.has("User-Agent")) {
      modifiedHeaders.set("User-Agent", userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    }

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
    // WEBSOCKET HANDSHAKE ROUTE
    // ------------------------------------------------------------------------
    if (isWebSocketReq || reqUrl.searchParams.has("ws")) {
      return fetch(targetUrl.href, fetchOpts);
    }

    // ------------------------------------------------------------------------
    // OUTBOUND EXECUTION
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

    // ------------------------------------------------------------------------
    // CSS Transformation Engine (External Stylesheets)
    // ------------------------------------------------------------------------
    if (contentType.includes("text/css")) {
      const rawCss = await response.text();
      const rewrittenCss = rewriteCssUrls(rawCss, targetUrl.href, reqUrl.origin);
      responseHeaders.delete("content-length");
      return new Response(rewrittenCss, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // ------------------------------------------------------------------------
    // HTML Transformation Engine (Injects Floating Browser Icon, CSS & JS Patches)
    // ------------------------------------------------------------------------
    if (contentType.includes("text/html")) {
      let styleBuffer = "";

      const rewriter = new HTMLRewriter()
        .on("head", {
          element(element) {
            element.append(
              `<link rel="icon" type="image/x-icon" href="${reqUrl.origin}/favicon.ico">
              <link rel="shortcut icon" href="${reqUrl.origin}/favicon.ico">
              <script>
                (function() {
                  var PROXY_ORIGIN = "${reqUrl.origin}";
                  var TARGET_FULL = "${targetUrl.href.replace(/"/g, '\\"').replace(/'/g, "\\'")}";

                  function proxyAssetUrl(u) {
                    if (!u || typeof u !== 'string') return u;
                    if (u.startsWith(PROXY_ORIGIN) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:')) {
                      return u;
                    }
                    try {
                      var absUrl = new URL(u, TARGET_FULL).href;
                      return PROXY_ORIGIN + '/scors?url=' + encodeURIComponent(absUrl);
                    } catch (e) {
                      return u;
                    }
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
                      get: scriptSrcDesc.get,
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
                        var absUrl = new URL(url, TARGET_FULL).href;
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
                      if (typeof resource === 'string' && !resource.startsWith(PROXY_ORIGIN) && !resource.startsWith('data:')) {
                        try {
                          var absUrl = new URL(resource, TARGET_FULL).href;
                          resource = PROXY_ORIGIN + '/scors?url=' + encodeURIComponent(absUrl);
                        } catch(e) {}
                      }
                      return originalFetch.call(this, resource, init);
                    };
                  }

                  var originalPush = history.pushState;
                  var originalReplace = history.replaceState;
                  function fixUrl(u) {
                    if (!u) return u;
                    try {
                      var absUrl = new URL(u, TARGET_FULL).href;
                      return PROXY_ORIGIN + '/scors?url=' + encodeURIComponent(absUrl);
                    } catch(e) { return u; }
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
              chunk.replace(rewriteCssUrls(styleBuffer, targetUrl.href, reqUrl.origin), { html: false });
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
              element.setAttribute("style", rewriteCssUrls(inlineStyle, targetUrl.href, reqUrl.origin));
            }
          },
        })
        .on("body", {
          element(element) {
            element.append(
              `<a href="${reqUrl.origin}/browse" id="scors-browser-float-btn" title="SCORS Browser Home" style="position:fixed;bottom:16px;left:16px;z-index:2147483647;width:48px;height:48px;background:rgba(30,41,59,0.75);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.15);transition:all 0.2s ease;text-decoration:none;" onmouseover="this.style.background='rgba(30,41,59,0.95)';this.style.transform='scale(1.08)';" onmouseout="this.style.background='rgba(30,41,59,0.75)';this.style.transform='scale(1)';">
                <img src="${reqUrl.origin}/assets/browsericon.png" alt="Browser Icon" style="width:24px;height:24px;object-fit:contain;display:block;" />
              </a>`,
              { html: true }
            );
          },
        })
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
        .on("form", {
          element(element) {
            const action = element.getAttribute("action") || targetUrl.href;
            const method = (element.getAttribute("method") || "GET").toUpperCase();

            try {
              const absoluteUrl = new URL(action, targetUrl.href);

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
            const attrVal = element.getAttribute(attrName);
            if (attrVal && !attrVal.startsWith("data:")) {
              const rel = (element.getAttribute("rel") || "").toLowerCase();
              if (element.tagName === "link" && rel.includes("icon")) {
                element.setAttribute("href", `${reqUrl.origin}/favicon.ico`);
              } else {
                try {
                  const absoluteUrl = new URL(attrVal, targetUrl.href).href;
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
