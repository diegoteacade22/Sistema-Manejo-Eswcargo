/* eslint-disable no-console */
const puppeteer = require('puppeteer');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION_FAILED: ${message}`);
  }
}

async function login(page, username, password) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="username"]');
  await page.type('input[name="username"]', username);
  await page.type('input[name="password"]', password);
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('button')).some((button) =>
      (button.textContent || '').toLowerCase().includes('iniciar sesión')
    );
  });
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((node) =>
      (node.textContent || '').toLowerCase().includes('iniciar sesión')
    );
    if (!button) {
      throw new Error('No login button found by text');
    }
    button.click();
  });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 });
}

async function safeDelete(where, modelName, fn) {
  try {
    await fn();
  } catch (error) {
    console.warn(`[cleanup] No se pudo borrar ${modelName} ${JSON.stringify(where)}:`, error?.message || error);
  }
}

async function run() {
  const now = Date.now();
  const clientPassword = 'Qa#Client1234';
  const adminPassword = 'Qa#Admin1234';
  const clientPasswordHash = await bcrypt.hash(clientPassword, 10);
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

  const ids = {
    clientAOldId: 820000 + (now % 10000),
    clientBOldId: 830000 + (now % 10000),
  };

  const usernames = {
    admin: `qa_admin_${now}`,
    client: `${ids.clientAOldId}`,
  };

  const created = {};
  let browser;

  try {
    created.clientA = await prisma.client.create({
      data: {
        old_id: ids.clientAOldId,
        name: `QA Cliente A ${now}`,
        email: `qa_cliente_a_${now}@test.local`,
        canAccess: true,
      },
    });

    created.clientB = await prisma.client.create({
      data: {
        old_id: ids.clientBOldId,
        name: `QA Cliente B ${now}`,
        email: `qa_cliente_b_${now}@test.local`,
        canAccess: true,
      },
    });

    created.clientUser = await prisma.user.create({
      data: {
        username: usernames.client,
        name: created.clientA.name,
        email: `qa_user_cliente_${now}@test.local`,
        password: clientPasswordHash,
        role: 'CLIENT',
      },
    });

    await prisma.client.update({
      where: { id: created.clientA.id },
      data: { userId: created.clientUser.id },
    });

    created.adminUser = await prisma.user.create({
      data: {
        username: usernames.admin,
        name: `QA Admin ${now}`,
        email: `qa_admin_${now}@test.local`,
        password: adminPasswordHash,
        role: 'ADMIN',
      },
    });

    created.shipmentA = await prisma.shipment.create({
      data: {
        shipment_number: 860000 + (now % 10000),
        clientId: created.clientA.id,
        status: 'SALIENDO',
        price_total: 150,
        cost_total: 80,
        profit: 70,
      },
    });

    created.shipmentB = await prisma.shipment.create({
      data: {
        shipment_number: 870000 + (now % 10000),
        clientId: created.clientB.id,
        status: 'SALIENDO',
        price_total: 330,
        cost_total: 200,
        profit: 130,
      },
    });

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);

    // ===== CLIENT FLOW =====
    await login(page, usernames.client, clientPassword);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
    assert(!page.url().includes('/login'), 'Cliente no pudo iniciar sesión');

    const hasPurchasesLink = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).some((anchor) => {
        const href = anchor.getAttribute('href') || '';
        return href === '/purchases' || href.startsWith('/purchases/');
      });
    });
    assert(!hasPurchasesLink, 'Cliente ve enlace de Compras (/purchases)');

    await page.goto(`${BASE_URL}/purchases`, { waitUntil: 'networkidle2' });
    const purchasesUrl = page.url();
    assert(!purchasesUrl.includes('/purchases'), 'Cliente pudo acceder directamente a /purchases');

    await page.goto(`${BASE_URL}/shipments?q=${created.shipmentA.shipment_number}`, { waitUntil: 'networkidle2' });
    const shipmentsText = await page.evaluate(() => document.body.innerText);
    assert(shipmentsText.includes(String(created.shipmentA.shipment_number)), 'Cliente no ve su envío propio en búsqueda');
    assert(!shipmentsText.includes(String(created.shipmentB.shipment_number)), 'Cliente ve envío de otro cliente en búsqueda');

    await page.goto(`${BASE_URL}/shipments/${created.shipmentA.id}`, { waitUntil: 'networkidle2' });
    const ownShipmentDetail = await page.evaluate(() => document.body.innerText);
    assert(!ownShipmentDetail.includes('Costo Operativo'), 'Cliente ve Costo Operativo');
    assert(!ownShipmentDetail.includes('Rentabilidad'), 'Cliente ve Rentabilidad');

    const foreignResponse = await page.goto(`${BASE_URL}/shipments/${created.shipmentB.id}`, { waitUntil: 'networkidle2' });
    const status = foreignResponse?.status?.() ?? 0;
    assert(status === 404, `Cliente pudo abrir detalle de envío ajeno (status=${status})`);

    // ===== ADMIN FLOW =====
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      document.cookie.split(';').forEach((cookie) => {
        const eqPos = cookie.indexOf('=');
        const name = eqPos > -1 ? cookie.substring(0, eqPos).trim() : cookie.trim();
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      });
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });

    await login(page, usernames.admin, adminPassword);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
    assert(!page.url().includes('/login'), 'Admin no pudo iniciar sesión');

    await page.goto(`${BASE_URL}/purchases`, { waitUntil: 'networkidle2' });
    assert(page.url().includes('/purchases'), 'Admin no puede acceder a compras');

    const adminShipmentResponse = await page.goto(`${BASE_URL}/shipments/${created.shipmentA.id}`, { waitUntil: 'networkidle2' });
    const adminShipmentStatus = adminShipmentResponse?.status?.() ?? 0;
    assert(adminShipmentStatus === 200, `Admin no puede abrir detalle de envío (status=${adminShipmentStatus})`);

    console.log('E2E_RESULT ok=true');
    console.log('E2E_RESULT client_isolation=true');
    console.log('E2E_RESULT no_sensitive_costs_for_client=true');
    console.log('E2E_RESULT admin_access_ok=true');
  } finally {
    if (browser) {
      await browser.close();
    }

    if (created.shipmentA?.id) {
      await safeDelete({ id: created.shipmentA.id }, 'shipmentA', async () => {
        await prisma.shipment.delete({ where: { id: created.shipmentA.id } });
      });
    }
    if (created.shipmentB?.id) {
      await safeDelete({ id: created.shipmentB.id }, 'shipmentB', async () => {
        await prisma.shipment.delete({ where: { id: created.shipmentB.id } });
      });
    }
    if (created.clientA?.id) {
      await safeDelete({ id: created.clientA.id }, 'clientA unlink', async () => {
        await prisma.client.update({ where: { id: created.clientA.id }, data: { userId: null } });
      });
    }
    if (created.clientUser?.id) {
      await safeDelete({ id: created.clientUser.id }, 'clientUser', async () => {
        await prisma.user.delete({ where: { id: created.clientUser.id } });
      });
    }
    if (created.adminUser?.id) {
      await safeDelete({ id: created.adminUser.id }, 'adminUser', async () => {
        await prisma.user.delete({ where: { id: created.adminUser.id } });
      });
    }
    if (created.clientA?.id) {
      await safeDelete({ id: created.clientA.id }, 'clientA', async () => {
        await prisma.client.delete({ where: { id: created.clientA.id } });
      });
    }
    if (created.clientB?.id) {
      await safeDelete({ id: created.clientB.id }, 'clientB', async () => {
        await prisma.client.delete({ where: { id: created.clientB.id } });
      });
    }

    await prisma.$disconnect();
  }
}

run().catch(async (error) => {
  console.error('E2E_RESULT ok=false');
  console.error(error?.stack || error?.message || error);
  try {
    await prisma.$disconnect();
  } catch { }
  process.exit(1);
});
