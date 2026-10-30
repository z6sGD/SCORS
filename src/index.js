export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);

    // 1. Strict Path Check: Only accept /scors (case-insensitive: /scors, /SCORS, etc.)
    const normalizedPath = reqUrl.pathname.toLowerCase().replace(/\/$/, "");
    if (normalizedPath !== "/scors") {
      return new Response("Not Found", { status: 404 });
    }

    const origin = request.headers.get("Origin") || "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
      "Access-Control-Max-Age": "86400",
    };

    if (origin !== "*") {
      corsHeaders["Access-Control-Allow-Credentials"] = "true";
    }

    // 2. CORS Preflight Handling
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 3. Extract & Validate target URL parameter
    let targetUrlStr = reqUrl.searchParams.get("url");

    if (!targetUrlStr) {
      return new Response(
        JSON.stringify({ status: "active", endpoint: "SCORS Proxy API", usage: `${reqUrl.pathname}?url=example.com` }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Trim spaces and auto-prefix https:// if missing
    targetUrlStr = targetUrlStr.trim();
    if (!/^https?:\/\//i.test(targetUrlStr)) {
      targetUrlStr = "https://" + targetUrlStr;
    }

    try {
      const targetUrl = new URL(targetUrlStr);

      // SSRF Safeguard: Block internal/loopback targets
      const hostname = targetUrl.hostname.toLowerCase();
      if (
        ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
        hostname.endsWith(".local")
      ) {
        return new Response(
          JSON.stringify({ error: "Forbidden target host" }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // 4. Header Sanitization
      const modifiedHeaders = new Headers(request.headers);
      modifiedHeaders.set("Host", targetUrl.host);

      ["cf-connecting-ip", "cf-ray", "cf-visitor", "content-length", "accept-encoding"].forEach(
        (h) => modifiedHeaders.delete(h)
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

      // 5. Response Headers (Inject CORS, Strip Framing Restrictions)
      const responseHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));

      responseHeaders.delete("X-Frame-Options");
      responseHeaders.delete("Content-Security-Policy");
      responseHeaders.delete("Content-Security-Policy-Report-Only");

      const contentType = responseHeaders.get("content-type") || "";

      // 6. Rewrite HTML links & forms to remain within the proxy
      if (contentType.includes("text/html")) {
        const proxyOrigin = reqUrl.origin;
        const currentPath = reqUrl.pathname; // Retains user casing e.g. /SCORS or /scors

        const rewriter = new HTMLRewriter()
          .on("a[href]", {
            element(element) {
              const href = element.getAttribute("href");
              element.setAttribute("target", "_self");

              if (
                href &&
                !href.startsWith("javascript:") &&
                !href.startsWith("#") &&
                !href.startsWith("mailto:") &&
                !href.startsWith("tel:")
              ) {
                try {
                  const resolvedUrl = new URL(href, targetUrl.href).href;
                  element.setAttribute(
                    "href",
                    `${proxyOrigin}${currentPath}?url=${encodeURIComponent(resolvedUrl)}`
                  );
                } catch (e) {
                  // Keep original if unparseable
                }
              }
            },
          })
          .on("form[action]", {
            element(element) {
              const action = element.getAttribute("action");
              if (action) {
                try {
                  const resolvedUrl = new URL(action, targetUrl.href).href;
                  element.setAttribute(
                    "action",
                    `${proxyOrigin}${currentPath}?url=${encodeURIComponent(resolvedUrl)}`
                  );
                } catch (e) {
                  // Keep original if unparseable
                }
              }
            },
          });

        return rewriter.transform(
          new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          })
        );
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "SCORS Proxy Error", message: err.message }),
        { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
  },
};
