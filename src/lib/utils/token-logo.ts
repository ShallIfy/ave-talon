// Shared token logo resolver — maps raw logoUrl to full CDN URL.

const AVE_CDN = "https://www.iconaves.com/";

export function resolveLogo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${AVE_CDN}${raw.replace(/^\/+/, "")}`;
}
