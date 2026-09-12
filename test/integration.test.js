const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 4287;
const baseUrl = `http://127.0.0.1:${port}`;
const bootstrapOwnerPassword = 'OwnerPass@123456';
const owner = { email: 'owner@test.local', password: bootstrapOwnerPassword };
const staff = { email: 'staff@test.local', password: 'StaffPass@123' };
const tenant = { email: 'tenant@test.local', password: 'TenantPass@123' };
const bankSecret = 'test-bank-webhook-secret';
let dataDirectory;
let serverProcess;
let ownerCookie = '';
let staffCookie = '';
let tenantCookie = '';

function cookieFrom(response, prefix) {
  return [...response.headers.entries()]
    .filter(([name]) => name === 'set-cookie')
    .flatMap(([, value]) => value.split(/,(?=\s*[^;,\s]+=)/))
    .map((value) => value.split(';')[0].trim())
    .filter((value) => value.startsWith(prefix))
    .join('; ');
}

async function request(url, { cookie = '', body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { response, payload };
}

async function login(url, credentials, prefix) {
  const result = await request(url, { body: credentials });
  assert.equal(result.response.status, 200);
  return { ...result, cookie: cookieFrom(result.response, prefix) };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
}

function startServer() {
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_HOST: '',
      DB_PORT: '',
      DB_NAME: '',
      DB_USER: '',
      DB_PASSWORD: '',
      NVP_DATA_DIRECTORY: dataDirectory,
      NVP_DISABLE_SCHEDULED_JOBS: 'true',
      NVP_BANK_DIRECTORY_URL: '',
      NVP_ADMIN_EMAIL: owner.email,
      NVP_ADMIN_PASSWORD: bootstrapOwnerPassword,
      NVP_ADMIN_PASSWORD_CHANGE_REQUIRED: 'true',
      NVP_SESSION_SECRET: 'integration-test-session-secret-32-bytes',
      NVP_BANK_WEBHOOK_SECRET: bankSecret,
      NVP_API_TOKEN: 'integration-test-api-token'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function readState(cookie = ownerCookie) {
  const result = await request('/api/state', { cookie });
  assert.equal(result.response.status, 200);
  return result.payload.state;
}

describe('Phu Gia Land integration workflows', { concurrency: false }, () => {
  before(async () => {
    dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'phu-gia-land-test-'));
    startServer();
    await waitForServer();
  });

  after(async () => {
    serverProcess?.kill();
    await fs.rm(dataDirectory, { recursive: true, force: true });
  });

  test('health endpoint and protected state', async () => {
    const health = await request('/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.ok, true);
    assert.equal((await request('/api/state')).response.status, 401);
    const directory = await request('/api/banks');
    assert.equal(directory.response.status, 200);
    assert.ok(directory.payload.banks.some((bank) => bank.bin === '970433' && bank.shortName === 'VietBank'));
  });

  test('owner authentication requires and completes first-login password change', async () => {
    assert.equal((await request('/api/login', { body: { email: owner.email, password: 'wrong-password' } })).response.status, 401);
    const result = await login('/api/login', owner, 'nvp_');
    ownerCookie = result.cookie;
    assert.equal(result.payload.role, 'owner');
    assert.equal(result.payload.passwordChangeRequired, true);
    assert.match(ownerCookie, /nvp_session=/);
    assert.equal((await request('/api/state', { cookie: ownerCookie })).response.status, 403);
    const newPassword = 'ChangedOwner@123456';
    const changed = await request('/api/admin-password', { cookie: ownerCookie, body: { currentPassword: owner.password, newPassword } });
    assert.equal(changed.response.status, 200);
    owner.password = newPassword;
    const nextLogin = await login('/api/login', owner, 'nvp_');
    ownerCookie = nextLogin.cookie;
    assert.equal(nextLogin.payload.passwordChangeRequired, false);
    assert.equal((await request('/api/state', { cookie: ownerCookie })).response.status, 200);
    const storedCredentials = JSON.parse(await fs.readFile(path.join(dataDirectory, 'owner-credentials.json'), 'utf8'));
    assert.equal(storedCredentials.passwordChangeRequired, false);
    assert.ok(storedCredentials.passwordHash.includes(':'));
    assert.equal(JSON.stringify(storedCredentials).includes(newPassword), false);
  });

  test('changed owner password survives restart with bootstrap environment unchanged', async () => {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once('exit', resolve));
    startServer();
    await waitForServer();
    assert.equal((await request('/api/login', { body: { email: owner.email, password: bootstrapOwnerPassword } })).response.status, 401);
    const result = await login('/api/login', owner, 'nvp_');
    ownerCookie = result.cookie;
    assert.equal(result.payload.passwordChangeRequired, false);
  });

  test('owner can seed isolated operational state and unknown keys are discarded', async () => {
    const buildings = [{
      name: 'Tòa Kiểm Thử', code: 'TEST', address: '12 Đường Thử Nghiệm', active: true,
      settings: { paymentDay: 5, managementFee: 100000, waterBillingMode: 'fixed', waterFixedAmount: 120000, waterFloorRates: { 1: 125000 } },
      apartments: [
        { name: 'P101', floor: 1, status: 'rented', rentAmount: 5000000, serviceFee: 150000, waterBillingMode: 'fixed', waterFixedAmount: 130000 },
        { name: 'H201', floor: 2, status: 'empty', propertyType: 'homestay', bookedDates: ['2026-09-15'] }
      ]
    }];
    const customers = [{ id: 'customer-1', name: 'Nguyễn Văn Test', email: tenant.email, building: 'Tòa Kiểm Thử', apartment: 'P101', status: 'renting' }];
    const meterLogs = [
      { month: '2026-08', apartment: 'Tòa Kiểm Thử | P101', service: 'electricity', amount: 420000 },
      { month: '2026-08', apartment: 'Tòa Kiểm Thử | P101', service: 'water', amount: 999999 }
    ];
    const result = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: {
      'nvp-buildings': JSON.stringify(buildings), 'nvp-customers': JSON.stringify(customers), 'nvp-meter-logs': JSON.stringify(meterLogs),
      'nvp-invoices': '[]', 'nvp-notifications': '[]', 'nvp-cashflow': '[]', 'nvp-users': '[]', 'nvp-feedback': '[]',
      'nvp-invoice-settings': JSON.stringify({ companyName: 'Phú Gia Land', companyPhone: '0981444413', invoiceLogoUrl: 'assets/Logo BPG.jpg' }),
      'nvp-catalogs': JSON.stringify({ profit: [{ name: 'private' }], public: [{ name: 'shared' }] }), 'not-allowed': 'discard me'
    } } });
    assert.equal(result.response.status, 200);
    const state = await readState();
    assert.equal(state['not-allowed'], undefined);
    assert.equal(JSON.parse(state['nvp-buildings'])[0].address, '12 Đường Thử Nghiệm');
    assert.equal(JSON.parse(state['nvp-invoice-settings']).companyName, 'Phú Gia Land');
  });

  test('owner creates staff and tenant accounts with customer linkage', async () => {
    const staffResult = await request('/api/users', { cookie: ownerCookie, body: { ...staff, name: 'Nhân viên Test', role: 'staff' } });
    assert.equal(staffResult.response.status, 201);
    assert.equal(staffResult.payload.user.role, 'staff');
    const tenantResult = await request('/api/tenant-users', { cookie: ownerCookie, body: { ...tenant, name: 'Cư dân Test', customerId: 'customer-1' } });
    assert.equal(tenantResult.response.status, 201);
    assert.equal(tenantResult.payload.user.role, 'tenant');
    assert.equal((await request('/api/tenant-users', { cookie: ownerCookie, body: { ...tenant, name: 'Trùng', customerId: 'customer-1' } })).response.status, 409);
    const customers = JSON.parse((await readState())['nvp-customers']);
    assert.ok(customers[0].accountId);
  });

  test('staff state is filtered and restricted writes are rejected', async () => {
    staffCookie = (await login('/api/login', staff, 'nvp_')).cookie;
    const state = await readState(staffCookie);
    assert.equal(state['nvp-cashflow'], undefined);
    assert.equal(state['nvp-users'], undefined);
    assert.deepEqual(Object.keys(JSON.parse(state['nvp-catalogs'])), ['public']);
    const write = await request('/api/state', { cookie: staffCookie, method: 'PUT', body: { state: { 'nvp-cashflow': '[]' } } });
    assert.equal(write.response.status, 403);
    assert.equal((await request('/api/users', { cookie: staffCookie, body: { ...staff, email: 'other@test.local', name: 'Other' } })).response.status, 403);
  });

  test('public availability respects homestay booked dates and rented rooms', async () => {
    const booked = await request('/api/availability?from=2026-09-15&to=2026-09-15');
    assert.equal(booked.response.status, 200);
    assert.equal(booked.payload.apartments.length, 0);
    const open = await request('/api/availability?from=2026-09-16&to=2026-09-16');
    assert.deepEqual(open.payload.apartments.map((item) => item.name), ['H201']);
  });

  test('monthly close calculates fixed water, creates pending draft, and is idempotent', async () => {
    const first = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2026-08' } });
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.created, 1);
    const invoices = JSON.parse((await readState())['nvp-invoices']);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].amount, 5700000);
    assert.deepEqual(invoices[0].billingLines, { rent: 5000000, electricity: 420000, water: 130000, service: 150000, serviceLabel: 'Phí dịch vụ' });
    assert.equal(invoices[0].approvalStatus, 'pending');
    assert.equal(invoices[0].dueDate, '2026-09-05');
    const second = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2026-08' } });
    assert.equal(second.payload.created, 0);
  });

  test('apartment zero-value overrides take precedence over floor and building defaults', async () => {
    const state = await readState();
    const buildings = JSON.parse(state['nvp-buildings']);
    buildings[0].apartments[0].waterFixedAmount = 0;
    buildings[0].apartments[0].serviceFee = 0;
    const updated = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-buildings': JSON.stringify(buildings) } } });
    assert.equal(updated.response.status, 200);
    const result = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2026-09' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.created, 1);
    const invoices = JSON.parse((await readState())['nvp-invoices']);
    const invoice = invoices.find((item) => item.month === '2026-09');
    assert.deepEqual(invoice.billingLines, { rent: 5000000, electricity: 0, water: 0, service: 0, serviceLabel: 'Phí dịch vụ' });
    assert.equal(invoice.amount, 5000000);
  });

  test('pending invoices are hidden from tenant portal', async () => {
    tenantCookie = (await login('/api/tenant-login', tenant, 'nvp_tenant_')).cookie;
    const portal = await request('/api/tenant-portal', { cookie: tenantCookie });
    assert.equal(portal.response.status, 200);
    assert.equal(portal.payload.invoices.length, 0);
  });

  test('approval publishes invoice once and creates one tenant notification', async () => {
    const invoices = JSON.parse((await readState())['nvp-invoices']);
    const invoiceId = invoices[0].id;
    const first = await request(`/api/invoices/${invoiceId}/approve`, { cookie: staffCookie, body: {} });
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.invoice.approvalStatus, 'approved');
    const second = await request(`/api/invoices/${invoiceId}/approve`, { cookie: staffCookie, body: {} });
    assert.equal(second.response.status, 200);
    const state = await readState();
    assert.equal(JSON.parse(state['nvp-notifications']).filter((item) => item.invoiceId === invoiceId).length, 1);
    const portal = await request('/api/tenant-portal', { cookie: tenantCookie });
    assert.equal(portal.payload.invoices.length, 1);
    assert.equal(portal.payload.notifications.length, 1);
  });

  test('bank webhook enforces secret, amount, payment matching, and deduplication', async () => {
    const invoice = JSON.parse((await readState())['nvp-invoices'])[0];
    const body = { transactionId: 'bank-transaction-1', content: `Thanh toan ${invoice.paymentCode}`, amount: invoice.amount };
    assert.equal((await request('/api/bank-webhook', { body })).response.status, 401);
    const insufficient = await request('/api/bank-webhook', { headers: { 'X-NVP-Webhook-Secret': bankSecret }, body: { ...body, transactionId: 'bank-insufficient', amount: invoice.amount - 1 } });
    assert.equal(insufficient.response.status, 202);
    assert.equal(insufficient.payload.reason, 'Payment amount is insufficient');
    const paid = await request('/api/bank-webhook', { headers: { 'X-NVP-Webhook-Secret': bankSecret }, body });
    assert.equal(paid.response.status, 200);
    assert.equal(paid.payload.ok, true);
    const duplicate = await request('/api/bank-webhook', { headers: { 'X-NVP-Webhook-Secret': bankSecret }, body });
    assert.equal(duplicate.payload.duplicate, true);
    const state = await readState();
    assert.equal(JSON.parse(state['nvp-cashflow']).filter((item) => item.bankTransactionId === body.transactionId).length, 1);
  });

  test('bank webhook must not pay a pending invoice', async () => {
    const state = await readState();
    const invoices = JSON.parse(state['nvp-invoices']);
    invoices.push({ id: 'pending-payment-test', paymentCode: 'PENDING-001', title: 'Hóa đơn chưa duyệt', tenantEmail: tenant.email, amount: 100000, approvalStatus: 'pending', status: 'unpaid' });
    await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-invoices': JSON.stringify(invoices) } } });
    const result = await request('/api/bank-webhook', { headers: { 'X-NVP-Webhook-Secret': bankSecret }, body: { transactionId: 'pending-bank-1', content: 'PENDING-001', amount: 100000 } });
    assert.equal(result.response.status, 202);
    assert.equal(result.payload.reason, 'Invoice is not approved');
  });

  test('tenant feedback is isolated and supports owned image retrieval', async () => {
    const imageDataUrl = `data:image/png;base64,${Buffer.from('test-image').toString('base64')}`;
    const created = await request('/api/tenant-feedback', { cookie: tenantCookie, body: { title: 'Rò nước', message: 'Cần kiểm tra đường ống', category: 'repair', priority: 'high', imageDataUrl } });
    assert.equal(created.response.status, 201);
    const imageUrl = created.payload.feedback.imageUrl;
    assert.ok(imageUrl);
    assert.equal((await request(imageUrl)).response.status, 401);
    assert.equal((await request(imageUrl, { cookie: tenantCookie })).response.status, 200);
    const portal = await request('/api/tenant-portal', { cookie: tenantCookie });
    assert.equal(portal.payload.feedback.length, 1);
  });

  test('owner media upload is retrievable and unsupported formats are rejected', async () => {
    const unauthorized = await request('/api/media', { body: { dataUrl: 'data:image/png;base64,WA==' } });
    assert.equal(unauthorized.response.status, 401);
    const invalid = await request('/api/media', { cookie: ownerCookie, body: { dataUrl: 'data:text/plain;base64,WA==' } });
    assert.equal(invalid.response.status, 400);
    const uploaded = await request('/api/media', { cookie: ownerCookie, body: { buildingCode: 'Tòa Test', assetCode: 'P101', index: 1, dataUrl: 'data:image/png;base64,WA==' } });
    assert.equal(uploaded.response.status, 201);
    assert.match(uploaded.payload.media.fileName, /^TOA-TEST-P101-01\.png$/);
    assert.equal((await request(uploaded.payload.media.url)).response.status, 200);
  });

  test('push endpoint reports unavailable configuration without external calls', async () => {
    const config = await request('/api/push-config');
    assert.equal(config.payload.enabled, false);
    const notify = await request('/api/push-notify', { cookie: staffCookie, body: { audience: 'all-tenants', title: 'Test', body: 'Test' } });
    assert.equal(notify.response.status, 503);
  });

  test('invalid and missing API routes return controlled errors', async () => {
    assert.equal((await request('/api/invoices/not-found/approve', { cookie: ownerCookie, body: {} })).response.status, 404);
    assert.equal((await request('/api/not-found')).response.status, 404);
  });
});