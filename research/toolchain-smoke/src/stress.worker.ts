self.onmessage = (e: MessageEvent<{ n: number }>) => {
  const re = new RegExp('^(a*)*b$'); const t = performance.now(); const ok = re.test('a'.repeat(e.data.n));
  (self as unknown as { postMessage(m: unknown): void }).postMessage({ ms: performance.now() - t, ok });
};
