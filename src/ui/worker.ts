interface PingMessage {
  ping: string;
}

interface TestRegExpMessage {
  type: 'test-regexp';
  id: number;
  pattern: string;
  strings: string[];
}

type WorkerIncoming = PingMessage | TestRegExpMessage;

self.onmessage = (e: MessageEvent<WorkerIncoming>) => {
  const data = e.data;
  if ('ping' in data) {
    (self as unknown as { postMessage(m: unknown): void }).postMessage({
      pong: data.ping,
      timestamp: performance.now()
    });
    return;
  }

  if (data.type === 'test-regexp') {
    try {
      const re = new RegExp('^' + data.pattern + '$');
      const matches = data.strings.map((s) => re.test(s));
      (self as unknown as { postMessage(m: unknown): void }).postMessage({
        type: 'regexp-result',
        id: data.id,
        matches
      });
    } catch (err: any) {
      (self as unknown as { postMessage(m: unknown): void }).postMessage({
        type: 'regexp-result',
        id: data.id,
        error: err?.message || String(err)
      });
    }
  }
};
