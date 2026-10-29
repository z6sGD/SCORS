export async function onRequest(context) {
  const { request } = context;
  const reqUrl = new URL(request.url);

  // 1. Support case-insensitive parameter query lookups (?Url= or ?url= or ?URL=)
  let targetUrlStr = reqUrl.searchParams.get("Url") || 
                     reqUrl.searchParams.get("url") || 
                     reqUrl.searchParams.get("URL");

  // Fallback: Check if the target URL is passed in the pathname (e.g. /https://example.com)
  if (!targetUrlStr) {
    const pathUrl = reqUrl.pathname.slice(1) + reqUrl.search;
    if (pathUrl.startsWith("http://") || pathUrl.startsWith("https://")) {
      targetUrlStr = pathUrl;
    }
  }

  // 2. Handle CORS Preflight (OPTIONS)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // 3. If NO target URL parameter is passed, serve your static website (e.g. index.html)
  if (!targetUrlStr) {
    return context.next();
  }

  // Auto-fix missing protocol
  if (!targetUrlStr.startsWith("http://") && !targetUrlStr.startsWith("https://")) {
    targetUrlStr = "https://" + targetUrlStr;
  }

  try {
    const targetUrl = new URL(targetUrlStr);

    // 4. Clean request headers
    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.set("Host", targetUrl.host);
    modifiedHeaders.delete("cf-connecting-ip");
    modifiedHeaders.delete("cf-ray");
    modifiedHeaders.delete("cf-visitor");

    const fetchOpts = {
      method: request.method,
      headers: modifiedHeaders,
      redirect: "follow",
    };

    if (!["GET", "HEAD"].includes(request.method)) {
      fetchOpts.body = await request.arrayBuffer();
    }

    // 5. Fetch target website
    const response = await fetch(targetUrl.href, fetchOpts);

    // 6. Inject CORS headers & strip iframe security restrictions
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
    responseHeaders.set("Access-Control-Allow-Headers", "*");

    // Strip frame blocking headers so ScriptCraft can embed the site in an iframe
    responseHeaders.delete("X-Frame-Options");
    responseHeaders.delete("Content-Security-Policy");
    responseHeaders.delete("Content-Security-Policy-Report-Only");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "SCORS Cloudflare Pages Proxy Error", message: err.message }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
