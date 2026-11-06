self.onmessage = (e: MessageEvent<{ ping: string }>) => {
  (self as unknown as { postMessage(m: unknown): void }).postMessage({
    pong: e.data.ping,
    timestamp: performance.now()
  });
};
