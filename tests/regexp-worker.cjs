const { parentPort } = require('node:worker_threads');

if (parentPort) {
  parentPort.on('message', ({ id, pattern, strings }) => {
    try {
      const re = new RegExp('^' + pattern + '$');
      const matches = strings.map((s) => re.test(s));
      parentPort.postMessage({ id, matches, timeout: false });
    } catch (err) {
      parentPort.postMessage({ id, error: String(err), timeout: false });
    }
  });
}
