# Terms of Service

**Last Updated: November 20, 2026**

Welcome to **SCORS CORS Proxy** ("the Service"). By accessing or using our primary endpoint (`scors.scriptcraft.workers.dev`), backup endpoint (`scorsbackup.pages.dev`), or interactive interfaces (`/browse` and `/scorsencrypted`), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

---

## 1. Description of Service

SCORS provides an edge-accelerated Cross-Origin Resource Sharing (CORS) and web proxy utility designed to assist web developers and users by rewriting cross-origin HTTP/HTTPS and WebSocket requests. The Service includes an automated device verification engine, multi-layer rate limiting, and access-control logging to maintain service stability and prevent abuse.

---

## 2. Acceptable Use Policy

You agree to use the Service strictly for lawful web development, educational, and operational purposes.

### Prohibited Activities

You may **NOT** use the Service to:

* **Engage in Illegal Activity:** Facilitate, transmit, or access content that violates local, national, or international laws.
* **Launch Attacks or Flooding:** Conduct Distributed Denial of Service (DDoS) attacks, automated brute-force attempts, or excessive high-volume web scraping that disrupts destination servers or proxy infrastructure.
* **Bypass Bot Protections:** Attempt to circumvent security measures, including Cloudflare Turnstile, CAPTCHAs, or web application firewalls (WAFs) protecting third-party websites.
* **Distribute Malware or Phishing:** Proxy traffic intended to distribute malicious software, phishing pages, or fraudulent content.
* **Spoof Identity Tokens:** Manually forge, manipulate, or tamper with the `SCORS-Unique-Device-ID` or other system-generated verification headers.

---

## 3. Enforcement & Edge Banning

To maintain service availability and protect target origin servers from abuse, SCORS employs automated edge-level security features:

* **Device & Network Identification:** The Service computes a deterministic, non-invertible device signature (`SCORS-Unique-Device-ID`) for incoming traffic using network and header properties, and evaluates incoming IPv4 addresses, IPv6 addresses, and `/64` IPv6 network prefixes against active banlists.
* **Access Revocation:** If a device signature, IPv4 address, IPv6 address, or `/64` subnet prefix is associated with abusive behavior or ToS violations, access to the Service will be terminated or restricted immediately at the edge without prior notice.
* **Header Verification:** Any request found carrying forged or tampered verification headers will be automatically rejected.

---

## 4. Service Availability & Limitations

* **"As-Is" Provision:** The Service is provided on an **"AS IS"** and **"AS AVAILABLE"** basis without warranties of any kind, whether express or implied.
* **No Guarantee of Compatibility:** Not every website is supported. Target servers implementing strict bot-mitigation frameworks or IP blocklists may reject proxied requests.
* **Service Changes:** We reserve the right to modify, suspend, or discontinue any portion of the Service, or impose rate limits, at any time without liability.

---

## 5. Limitation of Liability

In no event shall the operators, maintainers, or hosting providers of SCORS be liable for any direct, indirect, incidental, special, or consequential damages resulting from the use or inability to use the Service, unauthorized access to proxied data, or any performance degradation.

---

## 6. Changes to Terms

We reserve the right to update these Terms at any time. Continued use of the Service following posted modifications constitutes your acceptance of the updated Terms.

---

## 7. Usage Limits & Automated Rate Limiting

We, SCORS, can deny service to anyone who sends too many requests at a time to ensure our service remains available to everyone:

* **Burst Protection:** Exceeding **60 requests per second** from a single IP address triggers an automatic **30-second temporary block** (`403 Access Denied`).
* **Navigation Cooldown:** Repeating page requests to the exact same target URL within **10 seconds** is rate-limited (`429 Too Many Requests`).

---

# Privacy Policy

**Last Updated: November 20, 2026**

This Privacy Policy explains how **SCORS CORS Proxy** ("we," "us," or "the Service") collects, processes, and stores network traffic and request data when you utilize our proxy endpoints.

---

## 1. Architecture & Data Logging Overview

While SCORS does not require user accounts or login sessions, **the Service maintains edge key-value logs (Cloudflare KV) for security enforcement, rate limiting, and abuse prevention**.

### 1.1. Public Banlist Disclosure

If your `SCORS-Unique-Device-ID`, IPv4 address, IPv6 address, or `/64` IPv6 subnet prefix is flagged or reported for violating our Terms of Service, we reserve the full right to list that identifier and the reason for suspension publicly in our repository's `banlist.json`, which is viewable by everyone.

---

## 2. Information We Collect & Process

When you route a request through the Service, our edge workers process and record the following data:

* **Network Identifiers:** Your public IPv4 or IPv6 address (via standard proxy headers such as `cf-connecting-ip` or `x-forwarded-for`), local/private IP address, and MAC address (if explicitly supplied in request headers).
* **HTTP Context:** User-Agent string, request headers, target URL (`?url=` or `?ws=`), and request payloads (`POST`/`PUT` bodies).
* **Navigation Visit Logs:** For non-asset page navigations (excluding static subresources such as stylesheets, scripts, images, and fonts), SCORS records the requested target URL, the timestamp of the visit, and a visit counter (`times visited`) grouped by your public IP address in edge KV storage (`SCORS_LOGS` / `SCORS_BANLIST`).
* **Temporary Rate-Limit Counters:** Short-lived per-second request counts and target-URL cooldown timestamps stored in edge KV (automatically expiring after 60 seconds).

---

## 3. How We Use Information

Collected and transient data is used to:

1. **Proxy & Rewrite Requests:** Forward your HTTP/HTTPS or WebSocket request to the requested target URL and return the response with required CORS and asset-rewriting headers.
2. **Compute Device Identities:** Generate a deterministic, non-invertible 200-character device identifier (`SCORS-Unique-Device-ID`) to detect abusive traffic and verify request integrity.
3. **Monitor Abuse & Enforce Banlists:** Maintain per-IP navigation logs (capped at the most recent 500 URLs per IP address) and enforce IPv4, IPv6, `/64` subnet, and Device ID bans.
4. **Prevent Flooding:** Enforce burst rate limits and request cooldowns.

---

## 4. Non-Invertibility & Upstream Anonymization

* **Mathematical One-Way Transformation:** The `SCORS-Unique-Device-ID` is computed using a lossy, nested polynomial reduction and 200-step work-factor stretching loop. It is computationally infeasible to reverse-engineer or extract raw IP addresses or MAC addresses from the resulting 200-character token.
* **Upstream Header Stripping:** Before forwarding your request to a destination website, SCORS strips identifying proxy headers (`cf-connecting-ip`, `cf-ray`, `cf-ipcountry`, etc.) and incoming `Cookie` headers, replacing them with your non-invertible `SCORS-Unique-Device-ID`.

---

## 5. Cookies and Client-Side Storage

* **No Cookies Placed by SCORS:** SCORS does not set tracking cookies, `localStorage`, or session tokens on your browser.
* **Stateless Cookie Stripping:** Incoming `Cookie` headers are stripped prior to upstream forwarding so session cookies are not persisted or tracked across proxied sessions.

---

## 6. Third-Party Web Services

When you request a target URL through SCORS, your request parameters (excluding stripped edge headers) are delivered to the destination website. Third-party target websites handle incoming traffic according to their own respective privacy policies.

---

## 7. Contact & Inquiries

For questions regarding these Terms or the privacy and logging practices of the SCORS engine, please open an issue or inquiry on the official project repository.
