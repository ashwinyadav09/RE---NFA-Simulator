export function getExportFilename(
  view: 'flat' | 'textbook' | 'final',
  step?: number,
  format: 'svg' | 'dot' = 'svg'
): string {
  if (view === 'final') {
    return `nfa-final.${format}`;
  }
  return `nfa-step-${step ?? 1}-${view}.${format}`;
}

export function formatStandaloneSvg(rawSvg: string): string {
  // Strip XML declaration, DOCTYPE, and comments
  const stripped = rawSvg
    .replace(/<\?xml\b[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE\b[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  // Find the opening <svg ...> tag
  const svgOpenMatch = /<svg\b([^>]*)>/i.exec(stripped);
  if (!svgOpenMatch) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${stripped}`;
  }

  let attrs = svgOpenMatch[1];
  const inner = stripped.slice(svgOpenMatch.index + svgOpenMatch[0].length);

  // Ensure xmlns and xmlns:xlink
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/i.test(attrs)) {
    attrs += ' xmlns="http://www.w3.org/2000/svg"';
  }
  if (!/xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/i.test(attrs)) {
    attrs += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  }

  // Check if width / height are present; if missing, derive from viewBox
  const hasWidth = /\bwidth=["'][^"']+["']/i.test(attrs);
  const hasHeight = /\bheight=["'][^"']+["']/i.test(attrs);
  if (!hasWidth || !hasHeight) {
    const vbMatch = /viewBox=["']([^"']+)["']/i.exec(attrs);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length >= 4 && !isNaN(parts[2]) && !isNaN(parts[3]) && parts[2] > 0 && parts[3] > 0) {
        if (!hasWidth) attrs += ` width="${parts[2] * (4 / 3)}"`;
        if (!hasHeight) attrs += ` height="${parts[3] * (4 / 3)}"`;
      }
    }
  }

  // Insert background rect if not already present as first child
  const rectTag = '<rect width="100%" height="100%" fill="#ffffff"/>';
  const trimmedInner = inner.trim();
  let finalInner = inner;
  if (!/^<rect\b[^>]*fill="#ffffff"/i.test(trimmedInner)) {
    finalInner = `\n${rectTag}\n${trimmedInner}`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg${attrs}>${finalInner}`;
}
