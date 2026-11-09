import { connect } from "cloudflare:sockets";

export async function fetchViaSocketProxy(targetUrl, fetchOpts, proxyConfig) {
  // Step 1: Open raw TCP connection to proxy gateway
  const socket = connect({
    hostname: proxyConfig.host,
    port: proxyConfig.port,
  });

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();

  // Step 2: Perform HTTP CONNECT proxy tunnel handshake
  const authHeader = btoa(`${proxyConfig.username}:${proxyConfig.password}`);
  const connectPayload =
    `CONNECT ${targetUrl.host}:${targetUrl.port || 443} HTTP/1.1\r\n` +
    `Host: ${targetUrl.host}\r\n` +
    `Proxy-Authorization: Basic ${authHeader}\r\n\r\n`;

  await writer.write(new TextEncoder().encode(connectPayload));

  // Step 3: Verify successful proxy connection establishment
  const { value } = await reader.read();
  const handshakeResponse = new TextDecoder().decode(value);
  if (!handshakeResponse.includes("200")) {
    throw new Error(`Proxy handshake failed: ${handshakeResponse.split("\r\n")[0]}`);
  }

  // Step 4: Upgrade connection to TLS for secure HTTPS communication
  reader.releaseLock();
  writer.releaseLock();
  const tlsSocket = socket.startTls({ hostname: targetUrl.hostname });

  // Step 5: Format and send HTTP request headers directly through the tunnel
  const tlsWriter = tlsSocket.writable.getWriter();
  let rawHttpRequest = `${fetchOpts.method} ${targetUrl.pathname}${targetUrl.search} HTTP/1.1\r\n`;
  fetchOpts.headers.forEach((val, key) => {
    rawHttpRequest += `${key}: ${val}\r\n`;
  });
  rawHttpRequest += `\r\n`;

  await tlsWriter.write(new TextEncoder().encode(rawHttpRequest));
  tlsWriter.releaseLock();

  // Step 6: Return the TLS socket stream wrapped as a Worker Response
  return new Response(tlsSocket.readable);
}
