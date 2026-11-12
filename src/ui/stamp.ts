declare const __BUILD_COMMIT__: string | undefined;

export function formatBuildStamp(commit?: string): string {
  const c = commit ?? (typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown');
  return c || 'unknown';
}
