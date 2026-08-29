import { createServer } from 'node:http';
import { ENGINEERING_BINARY_VERSION, ENGINEERING_CONTRACT_VERSION } from './version.mjs';

export function createHealthServer({ port, snapshot }) {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (request.method !== 'GET' || request.url !== '/health') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const state = snapshot();
    const ok = ['IDLE', 'BUSY'].includes(state.state)
      && typeof state.controlPlaneObservedAt === 'string'
      && state.goalReconcilerHealthy === true
      && typeof state.lastGoalReconcileAt === 'string';
    response.statusCode = ok ? 200 : 503;
    response.end(JSON.stringify({
      ok,
      service: 'company-os-engineering-v2',
      contract: 'engineering-v2-runner',
      ...state,
      binaryVersion: ENGINEERING_BINARY_VERSION,
      contractVersion: ENGINEERING_CONTRACT_VERSION,
    }));
  });
  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server.address()));
    }),
    close: () => !server.listening ? Promise.resolve() : new Promise((resolve) => server.close(resolve)),
  };
}
