// src/scorsToken.js

const QWERTY_MID = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];

const ZERO_SYMBOLS = [
  "-", "_", ".", ",", "/", "?", "|", "\\", "=",
  "Ж", "Щ", "Ф", "Ы", "Ъ", "Э", "Ю", "Я", "ж", "щ", "ф", "ы", "ъ", "э", "ю", "я",
  "零", "圓", "無", "空", "虚", "幻", "陰", "陽",
  "Ω", "Ψ", "Σ", "Δ", "Θ", "Ξ", "Π", "Φ", "ω", "ψ", "σ", "δ", "θ", "ξ", "π", "φ"
];

/**
 * Extracts Chrome major version integer from User-Agent string.
 * Defaults to 100 if Chrome header is absent.
 */
function parseChromeVersion(userAgentStr) {
  const match = (userAgentStr || "").match(/Chrome\/(\d+)/i);
  return match ? parseInt(match[1], 10) : 100;
}

/**
 * Deterministically computes zero symbol using (PublicIP_Val ^ ChromeVersion) mod 41
 */
function getDeterministicZeroSymbol(zeroCountIndex, publicIpVal, chromeVersion) {
  const numSymbols = BigInt(ZERO_SYMBOLS.length);
  const chromeExp = BigInt(chromeVersion);

  let baseSeed = 1n;
  let base = publicIpVal % numSymbols;
  let exp = chromeExp;

  while (exp > 0n) {
    if (exp % 2n === 1n) {
      baseSeed = (baseSeed * base) % numSymbols;
    }
    base = (base * base) % numSymbols;
    exp /= 2n;
  }

  const finalIdx = Number((baseSeed + BigInt(zeroCountIndex)) % numSymbols);
  return ZERO_SYMBOLS[finalIdx];
}

function getShiftedQwerty(shiftVal) {
  const shift = Math.abs(shiftVal) % QWERTY_MID.length;
  return [...QWERTY_MID.slice(shift), ...QWERTY_MID.slice(0, shift)];
}

export function encodeQwertyToken(numInput, shiftVal = 0, publicIpVal = 1n, chromeVersion = 100) {
  const str = numInput.toString();
  let result = "";

  const dynamicMidRow = getShiftedQwerty(shiftVal);
  const len = str.length;
  const numChunks = Math.ceil(len / 4);
  let zeroCounter = 0;

  for (let c = 0; c < numChunks; c++) {
    const end = len - c * 4;
    const start = Math.max(0, end - 4);
    const chunk = str.slice(start, end);

    let chunkResult = "";
    const places = chunk.length;

    for (let idx = 0; idx < places; idx++) {
      const digit = parseInt(chunk[idx], 10);
      const placeFromRight = places - 1 - idx;

      if (digit === 0) {
        chunkResult += getDeterministicZeroSymbol(zeroCounter, publicIpVal, chromeVersion);
        zeroCounter++;
      } else {
        const keyChar = dynamicMidRow[digit - 1];

        if (placeFromRight === 3) chunkResult += keyChar.toUpperCase();
        else if (placeFromRight === 2) chunkResult += keyChar.toLowerCase();
        else if (placeFromRight === 1) chunkResult += keyChar.toUpperCase();
        else if (placeFromRight === 0) chunkResult += keyChar.toLowerCase();
      }
    }
    result = chunkResult + result;
  }

  return result || ZERO_SYMBOLS[0];
}

function parseIpTo8Segments(ipStr) {
  const cleaned = (ipStr || "").trim().toLowerCase();

  if (cleaned.includes(".") && !cleaned.includes(":")) {
    const parts = cleaned.split(".").map((p) => parseInt(p, 10) || 0);
    if (parts.length === 4) {
      return [
        0n, 0n, 0n, 0n, 0n, 0xffffn,
        BigInt((parts[0] << 8) + parts[1]),
        BigInt((parts[2] << 8) + parts[3])
      ];
    }
  }

  if (cleaned.includes(":")) {
    let segments = [];
    if (cleaned.includes("::")) {
      const [left, right] = cleaned.split("::");
      const leftParts = left ? left.split(":").map((x) => BigInt("0x" + x)) : [];
      const rightParts = right ? right.split(":").map((x) => BigInt("0x" + x)) : [];
      const missing = 8 - (leftParts.length + rightParts.length);
      segments = [...leftParts, ...Array(missing).fill(0n), ...rightParts];
    } else {
      segments = cleaned.split(":").map((x) => BigInt("0x" + x));
    }
    if (segments.length === 8) return segments;
  }

  return [0x2001n, 0x0db8n, 0n, 0n, 0n, 0n, 0n, 1n];
}

function parseMacAddress(macStr) {
  const hexOnly = (macStr || "").replace(/[^0-9A-Fa-f]/g, "");
  if (hexOnly.length === 12) {
    const octets = [];
    for (let i = 0; i < 12; i += 2) {
      octets.push(parseInt(hexOnly.slice(i, i + 2), 16));
    }
    return { octets, fullBigInt: BigInt("0x" + hexOnly) };
  }
  // Safe default octets (prevents empty array Math.min and zero-division errors)
  return { octets: [1, 1, 1, 1, 1, 1], fullBigInt: 0x010101010101n };
}

/**
 * Calculates SCORS IPv6-Hardened Unique Device ID
 */
export function generateScorsDeviceId(publicIpStr, localIpStr, macAddrStr = "", userAgentStr = "") {
  try {
    const u = parseIpTo8Segments(publicIpStr);
    const v = parseIpTo8Segments(localIpStr);
    const { octets: mOctets, fullBigInt: macBigInt } = parseMacAddress(macAddrStr);

    const chromeVersion = parseChromeVersion(userAgentStr);
    const publicIpVal = u.reduce((acc, seg, idx) => acc + (seg << BigInt(16 * (7 - idx))), 0n);

    // 1. Cross-multiply 8 segments with MAC octets
    const iVec = u.map((uSeg, idx) => uSeg * v[idx] * BigInt(mOctets[idx % 6] + 1));

    // 2. Nested Exponentiation Polynomial Tree
    const term1 = (iVec[0] ** ((iVec[7] % 100n) + 1n)) + 
                  ((iVec[1] ** ((u[0] % 50n) + 1n)) * (iVec[2] ** ((v[0] % 50n) + 1n)));

    const term2 = (iVec[3] ** ((iVec[4] % 100n) + 1n)) + 
                  ((iVec[5] ** ((u[7] % 50n) + 1n)) * (iVec[6] ** ((v[7] % 50n) + 1n)));

    const macExponent = BigInt(mOctets[4] + mOctets[5] + 1);
    const macTerm = macBigInt ** macExponent;

    const oldVal = (term1 ** ((term2 % 17n) + 1n)) + 
                   (term2 ** ((term1 % 17n) + 1n)) + 
                   macTerm;

    // 3. Pre-Processing Reduction
    let mProd = 1n, nProd = 1n, macProd = 1n;
    u.forEach((val) => (mProd *= val + 1n));
    v.forEach((val) => (nProd *= val + 1n));
    mOctets.forEach((val) => (macProd *= BigInt(val + 1)));

    const o = (mProd * nProd * macProd === 0n) ? 1n : (mProd * nProd * macProd);

    const minPub = u.filter((x) => x > 1n).reduce((min, cur) => (cur < min ? cur : min), 2n);
    const minLoc = v.filter((x) => x > 1n).reduce((min, cur) => (cur < min ? cur : min), 2n);

    // FIX: Safely check for MAC octets > 1 to prevent BigInt(Infinity) RangeError
    const validMacOctets = mOctets.filter((x) => x > 1);
    const minMac = validMacOctets.length > 0 ? BigInt(Math.min(...validMacOctets)) : 2n;

    const uaSum = BigInt([...userAgentStr].reduce((acc, ch) => acc + ch.charCodeAt(0), 0));
    const exponent = (minPub % 30n) + (minLoc % 30n) + (minMac % 30n) + (uaSum % 13n) + 1n;

    const divisor = o ** exponent;
    let p = divisor > 0n ? oldVal / divisor : oldVal;
    if (p === 0n) p = 12345678901234567890n;

    // 4. Work-Factor Stretching Loop (200 steps)
    const moduloBase = 10n ** 200n;
    for (let step = 1n; step <= 200n; step++) {
      p = ((p ^ (p >> 2n)) + step) % moduloBase;
    }

    // Ensure output stays large after modulo operations
    if (p < 10n ** 190n) {
      p = p + (10n ** 199n);
    }

    // 5. Shift QWERTY alphabet based on IP + MAC Octet Sum
    const ipSum = u.reduce((a, b) => a + b, 0n) + v.reduce((a, b) => a + b, 0n);
    const macSum = BigInt(mOctets.reduce((a, b) => a + b, 0));
    const shiftVal = Number((ipSum + macSum) % 9n);

    // 6. Encode with Deterministic Zero Substitution
    return encodeQwertyToken(p, shiftVal, publicIpVal, chromeVersion);
  } catch (err) {
    // High-entropy deterministic fallback in case of unexpected context errors
    return encodeQwertyToken(9876543210987654321098765432109876543210n, 3, 1n, 100);
  }
}

/**
 * Anti-Spoofing Checker: Verifies if a client-supplied token matches ground truth
 */
export function verifyScorsDeviceId(incomingToken, publicIpStr, localIpStr, macAddrStr = "", userAgentStr = "") {
  if (!incomingToken) return false;
  const expectedToken = generateScorsDeviceId(publicIpStr, localIpStr, macAddrStr, userAgentStr);
  return incomingToken === expectedToken;
}
