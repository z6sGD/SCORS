# SCORS Proxy Engine

A free, high-performance, edge-accelerated CORS & protocol proxy powered by Cloudflare Workers and Cloudflare Pages. Built with an integrated stateless device fingerprinting engine, dynamic HTML/JS path rewriting, outbound socket tunneling, and full WebSocket forwarding, SCORS enables seamless cross-origin web development while protecting target endpoints from abuse.

---

### What does SCORS stand for?

SCORS stands for **Script Craft / Cross-Origin Resource Sharing**.

---

## 🚀 Quickstart & Endpoints

To bypass CORS restrictions or stream WebSocket traffic in your web applications, append the target URL or WebSocket server to the official proxy endpoints:

### HTTP / HTTPS Proxying

```text
https://scors.scriptcraft.workers.dev/scors?url=https://your-target-website.com

```

### WebSocket Streaming

```text
wss://scors.scriptcraft.workers.dev/scors?ws=wss://echo.websocket.events

```

### Backup Endpoint (Cloudflare Pages)

```text
https://scorsbackup.pages.dev/scors?url=https://your-target-website.com

```

---

## ✨ Key Features & Capability Matrix

* **Full CORS & CSP Elimination**: Automatically strips restrictive headers (`X-Frame-Options`, `Content-Security-Policy`) and injects permissive `Access-Control-Allow-*` headers.
* **WebSocket Proxying (`?ws=`)**: Seamlessly handles HTTP `101 Switching Protocols` handshakes and bidirectionally streams WebSocket frames for real-time applications.
* **Outbound Residential Socket Tunneling**: Integrates with `cloudflare:sockets` to route traffic through external residential proxy gateways (`HTTP CONNECT`), bypassing datacenter IP flagging on strict search engines.
* **Single-Page Application (SPA) Patching**: Injects a lightweight client-side script into `<head>` to monkey-patch `window.fetch`, `history.pushState`, `history.replaceState`, and `window.WebSocket` so client-side navigation stays on the proxy origin.
* **HTML & Form Rewriting**: Uses `HTMLRewriter` to normalize GET/POST forms, asset sources (`img`, `script`, `link`), and hyperlinks (`a[href]`) on the fly.
* **Multi-Tier Abuse Prevention**: Built-in dual-layer rate limiting (5 req/sec burst protection per IP and 1 req/10s per target URL) along with stateless hardware fingerprinting.
* **Banlist Management**: Automated synchronization with GitHub banlists (`/scors/sync`) and an authenticated REST API (`/scors/admin/api/*`) backed by Cloudflare KV.

---

## ⚠️ Known Technical Limitations

> * **Domain-Bound Captchas (Cloudflare Turnstile / reCAPTCHA):** Challenge widgets verify `window.location.hostname`. When loaded through a proxy domain, site key mismatches will cause widgets to fail validation unless routed through non-widget interfaces (e.g., `html.duckduckgo.com`).
> * **Datacenter IP Filtering:** Browsing strict target endpoints without configured socket proxy secrets (`PROXY_HOST`) routes traffic from Cloudflare edge IPs, which may trigger automated bot challenges.
> * **Complex Authenticated Sessions:** Cross-domain OAuth flows relying on `SameSite=Strict` HTTP-only cookies may require client-side credential adjustments.
> 
> 

---

## ⚡ How SCORS Differs From Standard CORS Proxies

Standard public CORS proxies (e.g., `cors-anywhere`) operate as basic header pass-through services without payload transformation or intelligent request management.

```text
[ Client Browser ] ---> [ SCORS Edge Worker Engine ] ---> [ Residential Sockets / Target API ]
                         │
                         ├─► Injected Client Script (window.fetch / WebSocket / history)
                         ├─► HTMLRewriter (GET/POST Form Fixes & Asset Paths)
                         ├─► Dual Rate Limiter (IP Burst & Target URL Cooldown)
                         └─► Stateless Hardware Signature & KV Banlist Validation

```

### Feature Comparison

| Feature | Standard Public Proxies | SCORS Proxy Engine |
| --- | --- | --- |
| **Protocol Support** | HTTP / HTTPS only | **HTTP, HTTPS, and WebSockets (`ws://`, `wss://`)** |
| **Abuse Mitigation** | Basic IP rate limits (easily bypassed via VPN) | **Hardware & IPv6 subnet fingerprinting + IP burst blockades** |
| **Single-Page App (SPA) Support** | Breaks on client-side JS routing | **Monkey-patches `fetch`, `history`, and `WebSocket` in-browser** |
| **Form Submissions** | GET parameters dropped on form submit | **Injects hidden inputs to maintain full URL/path context** |
| **Outbound IP Routing** | Cloudflare / Server Datacenter IPs only | **Supports `cloudflare:sockets` raw TCP/TLS proxy tunneling** |
| **Header Normalization** | Raw passthrough | **Injects standard browser Sec-Fetch & User-Agent signatures** |

---

## 💻 Code Examples

### 1. Standard HTTP Fetch (JavaScript)

```javascript
const PROXY_URL = "https://scors.scriptcraft.workers.dev/scors?url=";
const TARGET_API = "https://api.example.com/data";

async function fetchCorsData() {
  try {
    const response = await fetch(PROXY_URL + encodeURIComponent(TARGET_API), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const data = await response.json();
    console.log("Proxied Data:", data);
  } catch (error) {
    console.error("SCORS Proxy Fetch Failed:", error);
  }
}

fetchCorsData();

```

### 2. WebSocket Connection (JavaScript)

```javascript
const PROXY_WS_ENDPOINT = "wss://scors.scriptcraft.workers.dev/scors?ws=";
const TARGET_WS_SERVER = "wss://echo.websocket.events";

const socket = new WebSocket(PROXY_WS_ENDPOINT + encodeURIComponent(TARGET_WS_SERVER));

socket.onopen = () => {
  console.log("Connected to proxied WebSocket");
  socket.send("Hello via SCORS!");
};

socket.onmessage = (event) => {
  console.log("Received:", event.data);
};

```

### 3. Python (`requests`)

```python
import requests
import urllib.parse

proxy_url = "https://scors.scriptcraft.workers.dev/scors?url="
target_api = "https://api.example.com/data"

full_request_url = f"{proxy_url}{urllib.parse.quote(target_api, safe='')}"
response = requests.get(full_request_url)

if response.status_code == 200:
    print("Proxied Response:", response.json())
else:
    print(f"Failed with status code: {response.status_code}")

```

---

## 🔧 Deployment & Configuration

### Directory Structure

```text
scors-proxy/
├── wrangler.jsonc
└── src/
    ├── index.ts
    ├── scorsCore.js
    ├── scorsToken.js
    └── socketProxy.js

```

### Environment Variables & Secrets

To activate residential proxy tunneling, configure the following secrets in Cloudflare Workers:

```bash
npx wrangler secret put PROXY_HOST
npx wrangler secret put PROXY_PORT
npx wrangler secret put PROXY_USER
npx wrangler secret put PROXY_PASS
npx wrangler secret put ADMIN_SECRET

```

### `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "scors-proxy",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": [
    "nodejs_compat"
  ],
  "vars": {
    "ENVIRONMENT": "production"
  },
  "kv_namespaces": [
    {
      "binding": "SCORS_BANLIST",
      "id": "<YOUR_KV_NAMESPACE_ID>"
    }
  ],
  "triggers": {
    "crons": [
      "0 1,5,9,13,17,21 * * *"
    ]
  }
}

```

---

## 📄 License

This project is open-source and free for public use under the [GNU General Public License v3.0](LICENSE).
