/**
 * Byte sizes for device-facing surfaces, where values reach gigabytes.
 *
 * `formatFileSize` in `audio.ts` deliberately stops at megabytes because the
 * sample builders work in patch-sized numbers, and a test documents that. Device
 * storage, backups and free space do not: "3814.7 mb free" on an 8 GB recorder
 * is worse than "3.7 gb free". These are the same two formatters the Storage
 * view already had, moved here so there is one copy.
 */

/** Largest sensible unit, lowercase in the app's voice. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 b';
  if (bytes < 1024) return `${Math.round(bytes)} b`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} kb`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} mb`;
  return `${(bytes / 1024 ** 3).toFixed(2)} gb`;
}

/** Always gigabytes, for comparing a capacity against its use. */
export function formatGigabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return (bytes / 1024 ** 3).toFixed(2);
}
