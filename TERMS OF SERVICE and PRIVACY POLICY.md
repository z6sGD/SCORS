# Terms of Service

**Last Updated: November 4, 2026**

Welcome to **SCORS CORS Proxy** ("the Service"). By accessing or using our primary endpoint (`scors.scriptcraft.workers.dev`) or backup endpoint (`scorsbackup.pages.dev`), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.

---

## 1. Description of Service

SCORS provides a free, edge-accelerated Cross-Origin Resource Sharing (CORS) proxy designed to assist web developers by prepending headers to enable cross-origin HTTP/HTTPS requests. The Service includes an integrated, stateless device verification engine to enforce service stability and prevent abuse.

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

* **Device Identification:** The Service computes a deterministic, non-invertible device signature (`SCORS-Unique-Device-ID`) for incoming traffic using ephemeral network and header properties.
* **Access Revocation:** If a device signature is associated with abusive behavior or ToS violations, access to the Service will be terminated or restricted immediately at the Cloudflare Edge without prior notice.
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

## 7. Usage Limits

We, SCORS, can deny service to anyone who sends too many requests at a time. This is to ensure our service can be used by everyone at any time.

---

# Privacy Policy

**Last Updated: November 4, 2026**

This Privacy Policy explains how **SCORS CORS Proxy** ("we," "us," or "the Service") processes network traffic and request data when you utilize our proxy endpoints.

---

## 1. Core Commitment: 100% Stateless Architecture

SCORS is engineered from the ground up as a **stateless, keyless edge utility**. We do not operate databases to log user browsing history, raw IP addresses, or payload content.

### 1.1. Exception

The only exception to this is that if you get your SCORS ID/IP address reported to us, we have the full rights to list it publicly in the ban list viewable to everyone.

---

## 2. Information Processed Transiently

When you route a request through the Service, our Cloudflare Worker processes the following parameters in memory at the edge solely for the duration of the HTTP request cycle:

* **Network Identifiers:** Public IP address (via standard Cloudflare headers), local/private IP address, and MAC address (if explicitly supplied in request headers).
* **HTTP Context:** User-Agent string, request headers, target URL (`?url=`), and request payloads (`POST`/`PUT` bodies).

---

## 3. How We Use Information

Transient data is used exclusively to:

1. **Proxy Requests:** Forward your HTTP/HTTPS request to the requested target URL and return the response with required CORS headers (`Access-Control-Allow-Origin: *`).
2. **Compute Device Identities:** Generate a mathematical, non-invertible 200-character device identifier (`SCORS-Unique-Device-ID`) used in-memory to detect abusive traffic and enforce service banlists.

---

## 4. Non-Invertibility & Data Security

* **Mathematical One-Way Transformation:** The `SCORS-Unique-Device-ID` is computed using a lossy, nested mathematical reduction and work-factor stretching loop. It is computationally impossible ($1 \text{ in } 3.25 \times 10^{91}$ brute-force barrier) to reverse-engineer or extract raw IP addresses or MAC addresses from the resulting token.
* **No Persistent Storage of Raw Identifiers:** Raw IPv4/IPv6 addresses, MAC addresses, and target query URLs are **never saved to disk or persistent storage**.
* **Banlist Exception:** If a device violates our Terms of Service, only its non-invertible `SCORS-Unique-Device-ID` string may be stored in an edge key-value store (Cloudflare KV) to reject future abusive connections.

---

## 5. Cookies and Web Tracking

* **No Cookies Placed:** SCORS does not set, read, or track cookies, `localStorage`, or session tokens on your device.
* **Pass-Through Cookies:** Domain-scoped cookies intended for target APIs are forwarded strictly per the requirements of your outbound request and are never captured or analyzed by the proxy infrastructure.

---

## 6. Third-Party Web Services

When you request a target URL through SCORS, your request parameters (excluding Cloudflare worker edge headers) are delivered to the destination website. Third-party target websites handle incoming traffic according to their own respective privacy policies.

---

## 7. Contact & Inquiries

For questions regarding these Terms or the privacy architecture of the SCORS engine, please open an issue or inquiry on the official project repository.
