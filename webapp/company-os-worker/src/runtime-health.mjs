import { createServer } from 'node:http';

export function createRuntimeHealthServer({ host = '127.0.0.1', port = 8794, snapshot }) {
  if (host !== '127.0.0.1') throw new Error('Runtime health server must bind to 127.0.0.1');
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (request.method !== 'GET' || request.url !== '/health') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const state = snapshot();
    const healthy = !['DEGRADED', 'STOPPED'].includes(state.state);
    response.statusCode = healthy ? 200 : 503;
    response.end(JSON.stringify({
      ok: healthy,
      service: 'company-os-runtime',
      contract: 'runtime-v1',
      ...state,
    }));
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(server.address()); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    close() {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
    address() { return server.address(); },
  };
}
