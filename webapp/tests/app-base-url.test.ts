import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAppBaseUrl } from '../lib/app-base-url';

test('usa AUTH_URL canónica sin conservar barras finales', () => {
  assert.equal(resolveAppBaseUrl({ AUTH_URL: 'https://webapp-weld-psi.vercel.app///' }), 'https://webapp-weld-psi.vercel.app');
});

test('usa el dominio productivo inyectado por Vercel cuando no hay URL explícita', () => {
  assert.equal(resolveAppBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'webapp-weld-psi.vercel.app' }), 'https://webapp-weld-psi.vercel.app');
});

test('falla cerrado en producción si no existe una URL canónica', () => {
  assert.throws(() => resolveAppBaseUrl({ NODE_ENV: 'production' }), /Missing canonical application URL/);
});

test('rechaza protocolos no HTTP', () => {
  assert.equal(resolveAppBaseUrl({ AUTH_URL: 'javascript:alert(1)', VERCEL_URL: 'safe.example.com' }), 'https://safe.example.com');
});

test('rechaza userinfo, paths y HTTP en producción', () => {
  assert.throws(() => resolveAppBaseUrl({ AUTH_URL: 'https://webapp-weld-psi.vercel.app@evil.example', NODE_ENV: 'production' }), /Missing canonical/);
  assert.throws(() => resolveAppBaseUrl({ AUTH_URL: 'https://webapp-weld-psi.vercel.app/login', NODE_ENV: 'production' }), /Missing canonical/);
  assert.throws(() => resolveAppBaseUrl({ AUTH_URL: 'http://webapp-weld-psi.vercel.app', NODE_ENV: 'production' }), /Missing canonical/);
});

test('permite HTTP únicamente para desarrollo local', () => {
  assert.equal(resolveAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }), 'http://localhost:3000');
});
