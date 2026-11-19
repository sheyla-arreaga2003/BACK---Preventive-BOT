function isPrivateNetworkHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;

  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

  return parts[0] === 10
    || (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

export function parseCorsOrigins(value: string): string[] {
  const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.includes("*")) throw new Error("CORS_ORIGINS must not contain a wildcard");
  return origins.map((origin) => {
    const parsed = new URL(origin);
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    return origin;
  });
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  allowPrivateNetworkOrigins: boolean,
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!allowPrivateNetworkOrigins) return false;

  try {
    const url = new URL(origin);
    return url.protocol === "http:" && isPrivateNetworkHostname(url.hostname);
  } catch {
    return false;
  }
}
