import { isIP } from 'node:net';

function normalizeIp(value: string): string | null {
  const ip = value.trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '');
  return isIP(ip) ? ip : null;
}

export function clientIpFromHeaders(remoteAddress: string, forwardedFor: string | undefined, trustedProxyHops: number): string {
  const remoteIp = normalizeIp(remoteAddress) ?? 'unknown';
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 1 || !forwardedFor) return remoteIp;

  const chain = forwardedFor.split(',').map((value) => value.trim());
  const clientIndex = chain.length - trustedProxyHops;
  if (clientIndex < 0) return remoteIp;
  return normalizeIp(chain[clientIndex] ?? '') ?? remoteIp;
}