# SCORS CORS Proxy



A free, high-performance, edge-accelerated CORS proxy powered by Cloudflare Workers and Cloudflare Pages. Built with an integrated stateless device fingerprinting engine, SCORS protects target endpoints from abuse while enabling seamless cross-origin web development.



---

### What does SCORS stand for?

SCORS stands for Script Craft/Cross-Origin Resource Sharing.

---



## 🚀 Quickstart & Endpoints



To bypass CORS restrictions in your web applications, simply append the target URL to either of the official proxy endpoints:



### Primary Endpoint

```text

https://scors.scriptcraft.workers.dev/SCORS?url=https://your-target-website.com

```



### Backup Endpoint (Cloudflare Pages)

```text

https://scorsbackup.pages.dev/SCORS?url=https://your-target-website.com

```



---



## ⚠️ Important Limitations



> ### **NOT EVERY WEBSITE IS SUPPORTED**

> 

> * **Cloudflare / Bot-Protection Blockades:** Websites protected by Cloudflare Turnstile, "Under Attack Mode," custom Captchas, or strict bot-mitigation frameworks will reject requests routed through public edge worker IP ranges.

> * **Authenticated Sessions:** Websites requiring complex, domain-scoped HTTP cookies or stateful OAuth flows may not operate correctly through standard pass-through proxying.

> * **WebSocket Connections:** This proxy is designed for HTTP/HTTPS requests (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `HEAD`). WebSockets (`ws://`, `wss://`) are not supported.



---



## ⚡ How SCORS Differs From Standard CORS Proxies



Most public CORS proxies (such as `cors-anywhere` or generic proxy workers) act as simple, unverified pass-through tools. They append `Access-Control-Allow-Origin: *` headers to outgoing responses without inspecting or securing the request pipeline. 



Because standard proxies lack abuse prevention, they are frequently targeted by malicious scrapers, abused for DDoS attacks, and quickly banned by major APIs and Cloudflare's network.



**SCORS solves this problem at the architectural level:**



```

[ Client Browser ] ---> [ SCORS Edge Worker Proxy ] ---> [ Target Web API ]

                                │

               ┌────────────────┴────────────────┐

               │  Stateless Hardware Signature   │

               │  Anti-Spoofing Verification     │

               │  Cloudflare KV Banlist Intercept│

               └─────────────────────────────────┘

```



### Key Differences & Technical Advantages



| Feature | Standard Public Proxies (e.g., `cors-anywhere`) | SCORS CORS Proxy Engine |

---

| **Abuse Mitigation** | Basic IP rate-limiting (easily bypassed via VPN/proxies). | Hardware & IPv6 subnet-bound fingerprinting that survives IP-hopping. |

| **Privacy Protection** | Often logs full client IP addresses, headers, and payloads in central servers. | 

| **100% Stateless & Non-Invertible.** | Raw IPs and MAC addresses are never stored. |

| **Header Spoofing** | Accepts user-supplied client identification headers without verification. | Recalculates expected ground-truth device tokens at the edge and drops forged headers. |

| **ToS Enforcement** | Heavy-handed global bans that block innocent shared-IP users (e.g., universities/ISPs). | Precise, device-level blocking that isolates malicious users without impacting others. |

| **Performance & Uptime** | Frequently overloaded, rate-limited, or blocked by origin web servers. | High-availability Cloudflare Worker / Pages edge execution with sub-2ms processing overhead. |



---



## 🛡️ Under the Hood: Keyless Device Identification



To enforce Terms of Service (ToS) and prevent abuse without compromising user privacy or requiring databases, SCORS uses a mathematically lossy fingerprinting engine. 



### Why This Architecture Protects You

1. **Zero Cookie Tracking:** SCORS does not write or read client cookies, `localStorage`, or session data.

2. **Mathematically One-Way:** Due to floor-truncated division and 200-cycle non-linear bitwise stretching, it is physically impossible to reverse-engineer your actual IP address or MAC address from the generated token.

3. **Proxy Longevity:** By keeping abusive bots off the network, the primary proxy endpoints remain unblocked and available for legitimate developers.



---



## 💻 Code Examples



### JavaScript (`fetch`)



```javascript

const PROXY_URL = "https://scors.scriptcraft.workers.dev/SCORS?url=";

const TARGET_API = "https://api.example.com/data";



async function fetchCorsData() {

  try {

    const response = await fetch(PROXY_URL + encodeURIComponent(TARGET_API), {

      method: "GET",

      headers: {

        "Accept": "application/json",

      },

    });



    if (!response.ok) {

      throw new Error(`HTTP error! Status: ${response.status}`);

    }



    const data = await response.json();

    console.log("Proxied Data:", data);

  } catch (error) {

    console.error("CORS Proxy Fetch Failed:", error);

  }

}



fetchCorsData();

```



### Python (`requests`)



```python

import requests

import urllib.parse



proxy_url = "https://scors.scriptcraft.workers.dev/SCORS?url="

target_api = "https://api.example.com/data"



encoded_target = urllib.parse.quote(target_api, safe='')

full_request_url = f"{proxy_url}{encoded_target}"



response = requests.get(full_request_url)



if response.status_code == 200:

    print("Proxied Response:", response.json())

else:

    print(f"Failed with status code: {response.status_code}")

```



### cURL



```bash

curl -X GET "https://scors.scriptcraft.workers.dev/SCORS?url=https://httpbin.org/headers" \

  -H "Accept: application/json"

```



---



## 🔧 Self-Hosting & Deployment



If you want to run your own instance of SCORS on your Cloudflare account:



### 1. Clone the Repository

```bash

git clone https://github.com/z6sGD/scors.git

cd scors

npm install

```



### 2. Configure `wrangler.toml`

```toml

name = "scors"

main = "src/worker.js"

compatibility_date = "2026-01-01"



[vars]

ENVIRONMENT = "production"



# Optional Cloudflare KV binding for ToS bans

# kv_namespaces = [

#   { binding = "SCORS_BANLIST", id = "<YOUR_KV_NAMESPACE_ID>" }

# ]

```



### 3. Deploy

```bash

npx wrangler deploy

```



---



## 📄 License



This project is open-source and free for public use under the [GNU General Public License v3.0](LICENSE).
