import { ACCEPTED_EXTENSIONS } from "./constants";

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

export function isAllowedFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isMarkdown(filename: string | null, mimeType?: string): boolean {
  if (!filename) return false;
  return filename.toLowerCase().endsWith(".md") || (mimeType || "").includes("markdown");
}

export function isCsv(filename: string | null): boolean {
  return !!filename && filename.toLowerCase().endsWith(".csv");
}

export function friendlyError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const detailMatch = err.message.match(/:\s*([\s\S]+)$/);
  if (detailMatch) {
    const rawDetail = detailMatch[1].trim();
    try {
      const parsed = JSON.parse(rawDetail) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail;
    } catch { }
    if (rawDetail && !/^\d+$/.test(rawDetail) && !rawDetail.startsWith("<!DOCTYPE")) {
      return rawDetail;
    }
  }
  const msg = err.message.toLowerCase();
  if (msg.includes("authentication required") || msg.includes("unauthorized") || msg.includes("sign in")) {
    return "Authentication is required. Sign in and try again.";
  }
  if (msg.includes("timeout")) return "The request took too long. Please try again.";
  if (msg.includes("failed to fetch")) return "Network issue. Check your connection.";
  return fallback;
}
