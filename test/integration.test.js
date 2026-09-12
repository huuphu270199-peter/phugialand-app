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

  test('frontend phone validation patterns compile with modern browser regex rules', async () => {
    const source = await fs.readFile(path.join(root, 'app.js'), 'utf8');
    const patterns = [...source.matchAll(/name="phone"[^>]*pattern="([^"]+)"/g)].map((match) => match[1].replaceAll('\\\\', '\\'));
    assert.equal(patterns.length, 4);
    patterns.forEach((pattern) => assert.doesNotThrow(() => new RegExp(`^(?:${pattern})$`, 'v')));
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

  test('state synchronization rejects invalid financial collections', async () => {
    const invalidInvoice = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-invoices': JSON.stringify([{ amount: -1, status: 'unpaid', approvalStatus: 'approved' }]) } } });
    assert.equal(invalidInvoice.response.status, 400);
    const invalidCashflow = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-cashflow': JSON.stringify([{ amount: 100, type: 'unknown' }]) } } });
    assert.equal(invalidCashflow.response.status, 400);
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

  test('whole-building long-term rental removes every internal space from availability', async () => {
    const state = await readState();
    const customers = JSON.parse(state['nvp-customers']);
    const originalCustomers = JSON.stringify(customers);
    customers[0] = { ...customers[0], rentalType: 'whole-building-long-term', apartment: '', floor: '', rentAmount: 9000000 };
    const updated = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-customers': JSON.stringify(customers) } } });
    assert.equal(updated.response.status, 200);
    const availability = await request('/api/availability?from=2026-09-16&to=2026-09-16');
    assert.deepEqual(availability.payload.apartments, []);
    const restored = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-customers': originalCustomers } } });
    assert.equal(restored.response.status, 200);
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

  test('monthly services are charged only when their configured scope matches', async () => {
    const state = await readState();
    const buildings = JSON.parse(state['nvp-buildings']);
    buildings[0].apartments[0].serviceFee = 150000;
    buildings[0].services = [
      { id: 'management', name: 'Phí quản lý', billingMode: 'monthly', amount: 180000, scopeType: 'floor', scopeTargets: ['1'] },
      { id: 'parking', name: 'Giữ xe', billingMode: 'monthly', amount: 90000, scopeType: 'floor', scopeTargets: ['2'] },
      { id: 'repair', name: 'Sửa chữa', billingMode: 'manual', amount: 500000, scopeType: 'building', scopeTargets: [] }
    ];
    const updated = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-buildings': JSON.stringify(buildings) } } });
    assert.equal(updated.response.status, 200);
    const result = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2026-10' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.created, 1);
    const invoices = JSON.parse((await readState())['nvp-invoices']);
    const invoice = invoices.find((item) => item.month === '2026-10');
    assert.equal(invoice.billingLines.service, 180000);
    assert.deepEqual(invoice.serviceItems, [{ id: 'management', label: 'Phí quản lý', amount: 180000 }]);
    assert.equal(invoice.amount, 5180000);
  });

  test('shared floor water is divided only among rented apartments without losing the remainder', async () => {
    const state = await readState();
    const buildings = JSON.parse(state['nvp-buildings']);
    buildings[0].settings.waterBillingMode = 'floor-metered';
    buildings[0].apartments[0].waterBillingMode = 'floor-metered';
    buildings[0].apartments.push({ name: 'P102', floor: 1, status: 'rented', rentAmount: 4000000, waterBillingMode: 'floor-metered' });
    buildings[0].apartments.push({ name: 'P103', floor: 1, status: 'empty', rentAmount: 3000000, waterBillingMode: 'floor-metered' });
    const customers = JSON.parse(state['nvp-customers']);
    customers.push({ id: 'customer-2', name: 'Khách P102', email: 'p102@test.local', building: 'Tòa Kiểm Thử', apartment: 'P102', status: 'renting' });
    const meterLogs = JSON.parse(state['nvp-meter-logs']);
    meterLogs.push({ month: '2026-11', building: 'Tòa Kiểm Thử', floor: '1', targetType: 'floor', service: 'water', amount: 300001 });
    const updated = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: {
      'nvp-buildings': JSON.stringify(buildings),
      'nvp-customers': JSON.stringify(customers),
      'nvp-meter-logs': JSON.stringify(meterLogs)
    } } });
    assert.equal(updated.response.status, 200);
    const result = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2026-11' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.created, 2);
    const invoices = JSON.parse((await readState())['nvp-invoices']).filter((invoice) => invoice.month === '2026-11');
    assert.equal(invoices.find((invoice) => invoice.apartment === 'P101').billingLines.water, 150001);
    assert.equal(invoices.find((invoice) => invoice.apartment === 'P102').billingLines.water, 150000);
    assert.equal(invoices.some((invoice) => invoice.apartment === 'P103'), false);
    assert.equal(invoices.reduce((total, invoice) => total + invoice.billingLines.water, 0), 300001);
  });

  test('shared floor mode waits for a floor reading before creating monthly invoices', async () => {
    const result = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2026-12' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.created, 0);
    const invoices = JSON.parse((await readState())['nvp-invoices']);
    assert.equal(invoices.some((invoice) => invoice.month === '2026-12'), false);
  });

  test('shared floor water uses captured tenants and only the latest monthly floor record', async () => {
    const state = await readState();
    const buildings = JSON.parse(state['nvp-buildings']);
    buildings[0].settings.waterBillingMode = 'metered';
    buildings[0].apartments.forEach((apartment) => { apartment.waterBillingMode = 'metered'; });
    buildings[0].apartments.find((apartment) => apartment.name === 'P101').floor = 2;
    const customers = JSON.parse(state['nvp-customers']);
    const originalTenant = customers.find((customer) => customer.apartment === 'P101');
    originalTenant.status = 'moved';
    customers.push({ id: 'customer-3', name: 'Khách mới P101', email: 'new-p101@test.local', building: 'Tòa Kiểm Thử', apartment: 'P101', status: 'renting' });
    const meterLogs = JSON.parse(state['nvp-meter-logs']);
    const allocations = [
      { apartment: 'P101', tenantEmail: tenant.email, tenantName: 'Nguyễn Văn Test' },
      { apartment: 'P102', tenantEmail: 'p102@test.local', tenantName: 'Khách P102' }
    ];
    meterLogs.push(
      { month: '2027-01', building: 'Tòa Kiểm Thử', floor: '1', targetType: 'floor', service: 'water', amount: 100000, allocations },
      { month: '2027-01', building: 'Tòa Kiểm Thử', floor: '1', targetType: 'floor', service: 'water', amount: 300000, allocations }
    );
    const updated = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: {
      'nvp-buildings': JSON.stringify(buildings),
      'nvp-customers': JSON.stringify(customers),
      'nvp-meter-logs': JSON.stringify(meterLogs)
    } } });
    assert.equal(updated.response.status, 200);
    const result = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2027-01' } });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.created, 2);
    const invoices = JSON.parse((await readState())['nvp-invoices']).filter((invoice) => invoice.month === '2027-01');
    assert.equal(invoices.find((invoice) => invoice.apartment === 'P101').tenantEmail, tenant.email);
    assert.equal(invoices.find((invoice) => invoice.apartment === 'P101').billingLines.water, 150000);
    assert.equal(invoices.reduce((total, invoice) => total + invoice.billingLines.water, 0), 300000);
  });

  test('concurrent monthly closing creates one set of drafts', async () => {
    const state = await readState();
    const meterLogs = JSON.parse(state['nvp-meter-logs']);
    meterLogs.push({
      month: '2027-02', building: 'Tòa Kiểm Thử', floor: '1', targetType: 'floor', service: 'water', amount: 200000,
      allocations: [{ apartment: 'P102', tenantEmail: 'p102@test.local', tenantName: 'Khách P102' }]
    });
    const updated = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-meter-logs': JSON.stringify(meterLogs) } } });
    assert.equal(updated.response.status, 200);
    const results = await Promise.all([
      request('/api/utilities/close', { cookie: staffCookie, body: { month: '2027-02' } }),
      request('/api/utilities/close', { cookie: staffCookie, body: { month: '2027-02' } })
    ]);
    assert.deepEqual(results.map((result) => result.payload.created).sort((left, right) => left - right), [0, 2]);
    const invoices = JSON.parse((await readState())['nvp-invoices']).filter((invoice) => invoice.month === '2027-02');
    assert.equal(invoices.length, 2);
    assert.equal(invoices.find((invoice) => invoice.apartment === 'P102').billingLines.water, 200000);
    const closedState = await readState();
    const changedLogs = JSON.parse(closedState['nvp-meter-logs']);
    changedLogs.find((log) => log.month === '2027-02' && log.targetType === 'floor').amount = 999999;
    const rejected = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-meter-logs': JSON.stringify(changedLogs) } } });
    assert.equal(rejected.response.status, 409);
  });

  test('recorded apartment water survives a later switch to shared floor mode', async () => {
    const state = await readState();
    const buildings = JSON.parse(state['nvp-buildings']);
    buildings[0].settings.waterBillingMode = 'floor-metered';
    const meterLogs = JSON.parse(state['nvp-meter-logs']);
    meterLogs.push({ month: '2027-03', apartment: 'Tòa Kiểm Thử | P101', service: 'water', waterMode: 'metered', amount: 80000 });
    const updated = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: {
      'nvp-buildings': JSON.stringify(buildings),
      'nvp-meter-logs': JSON.stringify(meterLogs)
    } } });
    assert.equal(updated.response.status, 200);
    const result = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2027-03' } });
    assert.equal(result.response.status, 200);
    const invoices = JSON.parse((await readState())['nvp-invoices']).filter((invoice) => invoice.month === '2027-03');
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].apartment, 'P101');
    assert.equal(invoices[0].billingLines.water, 80000);
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
    const forbidden = await request(`/api/invoices/${invoiceId}/approve`, { cookie: staffCookie, body: {} });
    assert.equal(forbidden.response.status, 403);
    const first = await request(`/api/invoices/${invoiceId}/approve`, { cookie: ownerCookie, body: {} });
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.invoice.approvalStatus, 'approved');
    const second = await request(`/api/invoices/${invoiceId}/approve`, { cookie: ownerCookie, body: {} });
    assert.equal(second.response.status, 200);
    const state = await readState();
    assert.equal(JSON.parse(state['nvp-notifications']).filter((item) => item.invoiceId === invoiceId).length, 1);
    const portal = await request('/api/tenant-portal', { cookie: tenantCookie });
    assert.equal(portal.payload.invoices.length, 1);
    assert.equal(portal.payload.notifications.length, 1);
  });

  test('manual invoice collection is atomic, idempotent, and reversible by owner', async () => {
    const invoice = JSON.parse((await readState())['nvp-invoices'])[0];
    const collected = await request(`/api/invoices/${invoice.id}/collect`, { cookie: staffCookie, body: { method: 'cash' } });
    assert.equal(collected.response.status, 200);
    assert.equal(collected.payload.invoice.status, 'paid');
    assert.equal(collected.payload.cashflowEntry.sourceType, 'invoice-payment');
    const duplicate = await request(`/api/invoices/${invoice.id}/collect`, { cookie: staffCookie, body: { method: 'cash' } });
    assert.equal(duplicate.payload.duplicate, true);
    let state = await readState();
    assert.equal(JSON.parse(state['nvp-cashflow']).filter((entry) => entry.sourceType === 'invoice-payment' && entry.sourceId === invoice.id).length, 1);
    assert.equal((await request(`/api/invoices/${invoice.id}/reverse`, { cookie: staffCookie, body: { reason: 'Nhập nhầm' } })).response.status, 403);
    const reversed = await request(`/api/invoices/${invoice.id}/reverse`, { cookie: ownerCookie, body: { reason: 'Nhập nhầm phương thức thanh toán' } });
    assert.equal(reversed.response.status, 200);
    assert.equal(reversed.payload.invoice.status, 'unpaid');
    assert.equal(reversed.payload.cashflowEntry.type, 'expense');
    state = await readState();
    const cashflow = JSON.parse(state['nvp-cashflow']);
    assert.equal(cashflow.filter((entry) => entry.sourceId === invoice.id).length, 2);
    assert.equal(cashflow.reduce((total, entry) => total + (entry.type === 'income' ? entry.amount : -entry.amount), 0), 0);
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

  test('linked expenses are idempotent and reversible without deleting history', async () => {
    const body = { sourceType: 'commission-payment', sourceId: 'commission-001', title: 'Chi hoa hồng - Đối tác A', type: 'expense', amount: 250000, category: 'commission', method: 'bank-transfer' };
    const created = await request('/api/financial-events', { cookie: staffCookie, body });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.cashflowEntry.type, 'expense');
    const duplicate = await request('/api/financial-events', { cookie: staffCookie, body });
    assert.equal(duplicate.payload.duplicate, true);
    const changedAmount = await request('/api/financial-events', { cookie: staffCookie, body: { ...body, amount: 300000 } });
    assert.equal(changedAmount.response.status, 409);
    const reversed = await request(`/api/cashflow/${created.payload.cashflowEntry.id}/reverse`, { cookie: ownerCookie, body: { reason: 'Hủy thanh toán hoa hồng' } });
    assert.equal(reversed.response.status, 200);
    assert.equal(reversed.payload.cashflowEntry.type, 'income');
    const reposted = await request('/api/financial-events', { cookie: staffCookie, body: { ...body, amount: 300000 } });
    assert.equal(reposted.response.status, 200);
    assert.equal(reposted.payload.cashflowEntry.amount, 300000);
    const cashflow = JSON.parse((await readState())['nvp-cashflow']);
    assert.equal(cashflow.filter((entry) => entry.sourceId === body.sourceId).length, 2);
    assert.equal(cashflow.filter((entry) => entry.reversalOf === created.payload.cashflowEntry.id).length, 1);
  });

  test('deposit receipt is not profit and disposition updates invoice or cash correctly', async () => {
    const state = await readState();
    const reservations = JSON.parse(state['nvp-reservations'] || '[]');
    const invoices = JSON.parse(state['nvp-invoices']);
    reservations.push(
      { id: 'deposit-apply-001', name: 'Khách áp cọc', building: 'Tòa Test', apartment: 'P101', amount: 300000, status: 'held' },
      { id: 'deposit-refund-001', name: 'Khách hoàn cọc', building: 'Tòa Test', apartment: 'P102', amount: 200000, status: 'held' }
    );
    invoices.push({ id: 'deposit-invoice-001', paymentCode: 'DEP-INV-001', title: 'Hóa đơn áp cọc', building: 'Tòa Test', apartment: 'P101', amount: 1000000, approvalStatus: 'approved', status: 'unpaid' });
    await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-reservations': JSON.stringify(reservations), 'nvp-invoices': JSON.stringify(invoices) } } });
    const receipt = await request('/api/financial-events', { cookie: ownerCookie, body: { sourceType: 'deposit-receipt', sourceId: 'deposit-apply-001', title: 'Thu cọc', type: 'income', amount: 300000, category: 'deposit', method: 'cash' } });
    assert.equal(receipt.payload.cashflowEntry.affectsCash, true);
    assert.equal(receipt.payload.cashflowEntry.affectsProfit, false);
    const applied = await request('/api/deposits/deposit-apply-001/dispose', { cookie: ownerCookie, body: { disposition: 'applied', invoiceId: 'deposit-invoice-001' } });
    assert.equal(applied.response.status, 200);
    assert.equal(applied.payload.invoice.amount, 700000);
    assert.equal(applied.payload.reservation.status, 'applied');
    assert.equal(applied.payload.cashflowEntry.affectsCash, false);
    assert.equal(applied.payload.cashflowEntry.affectsProfit, true);
    const refunded = await request('/api/deposits/deposit-refund-001/dispose', { cookie: ownerCookie, body: { disposition: 'refunded', method: 'bank-transfer' } });
    assert.equal(refunded.response.status, 200);
    assert.equal(refunded.payload.cashflowEntry.type, 'expense');
    assert.equal(refunded.payload.cashflowEntry.affectsProfit, false);
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

  test('monthly closing bills rental contracts and preserves remaining bed inventory', async () => {
    const buildings = [
      { name: 'Tòa Nguyên Căn', settings: { paymentDay: 5, waterBillingMode: 'metered' }, apartments: [{ name: 'NC1', floor: 1, status: 'rented', rentAmount: 3000000 }, { name: 'NC2', floor: 2, status: 'rented', rentAmount: 4000000 }] },
      { name: 'Tòa Thuê Tầng', settings: { paymentDay: 5, waterBillingMode: 'floor-metered' }, services: [{ id: 'floor-service', name: 'Internet tầng', billingMode: 'monthly', amount: 500, scopeType: 'floor', scopeTargets: ['1'], allocationBasis: 'contract' }], apartments: [{ name: 'T101', floor: 1, status: 'rented', rentAmount: 3000000, electricityBillingMode: 'fixed', electricityFixedAmount: 100 }, { name: 'T102', floor: 1, status: 'rented', rentAmount: 4000000 }, { name: 'T201', floor: 2, status: 'empty', rentAmount: 5000000 }] },
      { name: 'Tòa Giường', settings: { paymentDay: 5, waterBillingMode: 'metered' }, services: [{ id: 'bed-service', name: 'Dịch vụ người ở', billingMode: 'monthly', amount: 99, scopeType: 'building', allocationBasis: 'person' }], apartments: [{ name: 'G101', floor: 1, status: 'rented', propertyType: 'shared-room', beds: 3, rentAmount: 6000000, electricityOccupantBilling: 'per-person-fixed', electricityPerPersonAmount: 70000, waterOccupantBilling: 'equal-occupants' }] }
    ];
    const customers = [
      { id: 'whole-customer', name: 'Khách nguyên căn', building: 'Tòa Nguyên Căn', rentalType: 'whole-building-long-term', rentAmount: 10000000, status: 'renting' },
      { id: 'floor-customer', name: 'Khách thuê tầng', building: 'Tòa Thuê Tầng', floor: 1, rentalType: 'floor-long-term', rentAmount: 7000000, electricityContractBilling: 'fixed', electricityFixedAmount: 250, waterContractBilling: 'fixed', waterFixedAmount: 350, status: 'renting' },
      { id: 'bed-customer-1', name: 'Khách giường 1', building: 'Tòa Giường', floor: 1, apartment: 'G101', bedNumber: 1, rentalType: 'bed-long-term', rentAmount: 2000000, status: 'renting' },
      { id: 'bed-customer-2', name: 'Khách giường 2', building: 'Tòa Giường', floor: 1, apartment: 'G101', bedNumber: 2, rentalType: 'bed-long-term', rentAmount: 2100000, status: 'renting' }
    ];
    const currentState = await readState();
    const meterLogs = [...JSON.parse(currentState['nvp-meter-logs']), { month: '2030-01', apartment: 'Tòa Giường | G101', service: 'electricity', amount: 101 }, { month: '2030-01', apartment: 'Tòa Giường | G101', service: 'water', waterMode: 'metered', amount: 103 }];
    const seeded = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-buildings': JSON.stringify(buildings), 'nvp-customers': JSON.stringify(customers), 'nvp-meter-logs': JSON.stringify(meterLogs) } } });
    assert.equal(seeded.response.status, 200, JSON.stringify(seeded.payload));

    const availability = await request('/api/availability?from=2030-01-01&to=2030-01-01');
    const sharedRoom = availability.payload.apartments.find((apartment) => apartment.name === 'G101');
    assert.equal(sharedRoom.availableBeds, 1);
    assert.equal(availability.payload.apartments.some((apartment) => ['NC1', 'NC2', 'T101', 'T102'].includes(apartment.name)), false);

    const closed = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2030-01' } });
    assert.equal(closed.response.status, 200);
    assert.equal(closed.payload.created, 4);
    const invoices = JSON.parse((await readState())['nvp-invoices']);
    const wholeInvoice = invoices.find((invoice) => invoice.customerId === 'whole-customer');
    const floorInvoice = invoices.find((invoice) => invoice.customerId === 'floor-customer');
    const bedInvoices = invoices.filter((invoice) => invoice.customerId?.startsWith('bed-customer-'));
    assert.equal(wholeInvoice.billingLines.rent, 10000000);
    assert.deepEqual(wholeInvoice.coveredApartments, ['NC1', 'NC2']);
    assert.equal(floorInvoice.billingLines.rent, 7000000);
    assert.equal(floorInvoice.billingLines.electricity, 250);
    assert.equal(floorInvoice.billingLines.water, 350);
    assert.equal(floorInvoice.allocationRules.electricity, 'contract-fixed');
    assert.equal(floorInvoice.billingLines.service, 500);
    assert.deepEqual(floorInvoice.coveredApartments, ['T101', 'T102']);
    assert.deepEqual(bedInvoices.map((invoice) => invoice.billingLines.electricity), [70000, 70000]);
    assert.deepEqual(bedInvoices.map((invoice) => invoice.billingLines.water).sort((left, right) => left - right), [51, 52]);
    assert.deepEqual(bedInvoices.map((invoice) => invoice.billingLines.service), [99, 99]);

    const conflictingCustomers = [...customers, { id: 'bed-customer-3', name: 'Khách trùng giường', building: 'Tòa Giường', floor: 1, apartment: 'G101', bedNumber: 2, rentalType: 'bed-long-term', rentAmount: 1900000, status: 'renting' }];
    const conflict = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: { 'nvp-customers': JSON.stringify(conflictingCustomers) } } });
    assert.equal(conflict.response.status, 409);
    assert.equal(JSON.parse((await readState())['nvp-customers']).length, customers.length);
  });

  test('rental billing matrix reconciles service allocation, tenant delivery, collection, and reversal', async () => {
    const currentState = await readState();
    const services = [
      { id: 'contract-fee', name: 'Phí theo hợp đồng', billingMode: 'monthly', amount: 100, scopeType: 'building', allocationBasis: 'contract' },
      { id: 'apartment-fee', name: 'Phí theo phòng', billingMode: 'monthly', amount: 50, scopeType: 'building', allocationBasis: 'apartment' },
      { id: 'person-fee', name: 'Phí theo người', billingMode: 'monthly', amount: 25, scopeType: 'building', allocationBasis: 'person' }
    ];
    const buildings = [
      {
        name: 'E2E Nguyên Căn', settings: { paymentDay: 7, waterBillingMode: 'metered' }, services,
        apartments: [
          { name: 'NC101', floor: 1, status: 'rented', rentAmount: 600 },
          { name: 'NC201', floor: 2, status: 'rented', rentAmount: 700 }
        ]
      },
      {
        name: 'E2E Tầng', settings: { paymentDay: 7, waterBillingMode: 'metered' }, services,
        apartments: [
          { name: 'T101', floor: 1, status: 'rented', rentAmount: 800 },
          { name: 'T102', floor: 1, status: 'rented', rentAmount: 900 },
          { name: 'T201', floor: 2, status: 'empty', rentAmount: 1000 }
        ]
      },
      {
        name: 'E2E Phòng', settings: { paymentDay: 7, waterBillingMode: 'metered' }, services,
        apartments: [{ name: 'P101', floor: 1, status: 'rented', rentAmount: 3000 }]
      },
      {
        name: 'E2E Giường', settings: { paymentDay: 7, waterBillingMode: 'metered' }, services,
        apartments: [{ name: 'G101', floor: 1, status: 'rented', propertyType: 'shared-room', beds: 3, rentAmount: 1200, electricityOccupantBilling: 'equal-occupants', waterOccupantBilling: 'per-person-fixed', waterPerPersonAmount: 30 }]
      }
    ];
    const customers = [
      { id: 'e2e-whole', name: 'Khách E2E nguyên căn', building: 'E2E Nguyên Căn', rentalType: 'whole-building-long-term', rentAmount: 1000, status: 'renting' },
      { id: 'e2e-floor', name: 'Khách E2E tầng', building: 'E2E Tầng', floor: 1, rentalType: 'floor-long-term', rentAmount: 2000, electricityContractBilling: 'fixed', electricityFixedAmount: 9, waterContractBilling: 'fixed', waterFixedAmount: 11, status: 'renting' },
      { id: 'e2e-room', name: 'Khách E2E phòng', email: 'room-e2e@test.local', building: 'E2E Phòng', floor: 1, apartment: 'P101', rentalType: 'room-long-term', rentAmount: 0, status: 'renting' },
      { id: 'e2e-bed-1', name: 'Khách E2E giường 1', building: 'E2E Giường', floor: 1, apartment: 'G101', bedNumber: 1, rentalType: 'bed-long-term', rentAmount: 400, status: 'renting' },
      { id: 'e2e-bed-2', name: 'Khách E2E giường 2', building: 'E2E Giường', floor: 1, apartment: 'G101', bedNumber: 2, rentalType: 'bed-long-term', rentAmount: 500, status: 'renting' }
    ];
    const meterLogs = [...JSON.parse(currentState['nvp-meter-logs']),
      { month: '2031-01', apartment: 'E2E Nguyên Căn | NC101', service: 'electricity', amount: 10 },
      { month: '2031-01', apartment: 'E2E Nguyên Căn | NC101', service: 'water', waterMode: 'metered', amount: 30 },
      { month: '2031-01', apartment: 'E2E Nguyên Căn | NC201', service: 'electricity', amount: 20 },
      { month: '2031-01', apartment: 'E2E Nguyên Căn | NC201', service: 'water', waterMode: 'metered', amount: 40 },
      { month: '2031-01', apartment: 'E2E Phòng | P101', service: 'electricity', amount: 13 },
      { month: '2031-01', apartment: 'E2E Phòng | P101', service: 'water', waterMode: 'metered', amount: 17 },
      { month: '2031-01', apartment: 'E2E Giường | G101', service: 'electricity', amount: 101 }
    ];
    const seeded = await request('/api/state', { cookie: ownerCookie, method: 'PUT', body: { state: {
      'nvp-buildings': JSON.stringify(buildings),
      'nvp-customers': JSON.stringify(customers),
      'nvp-meter-logs': JSON.stringify(meterLogs),
      'nvp-invoices': '[]',
      'nvp-notifications': '[]',
      'nvp-cashflow': '[]'
    } } });
    assert.equal(seeded.response.status, 200, JSON.stringify(seeded.payload));

    const closed = await request('/api/utilities/close', { cookie: staffCookie, body: { month: '2031-01' } });
    assert.equal(closed.response.status, 200);
    assert.equal(closed.payload.created, 5);
    const monthInvoices = JSON.parse((await readState())['nvp-invoices']).filter((invoice) => invoice.month === '2031-01');
    const invoiceFor = (customerId) => monthInvoices.find((invoice) => invoice.customerId === customerId);
    assert.deepEqual(invoiceFor('e2e-whole').billingLines, { rent: 1000, electricity: 30, water: 70, service: 225, serviceLabel: 'Phí dịch vụ' });
    assert.deepEqual(invoiceFor('e2e-floor').billingLines, { rent: 2000, electricity: 9, water: 11, service: 225, serviceLabel: 'Phí dịch vụ' });
    assert.deepEqual(invoiceFor('e2e-room').billingLines, { rent: 3000, electricity: 13, water: 17, service: 175, serviceLabel: 'Phí dịch vụ' });
    assert.deepEqual([invoiceFor('e2e-bed-1').amount, invoiceFor('e2e-bed-2').amount], [631, 730]);
    assert.equal(monthInvoices.reduce((total, invoice) => total + invoice.amount, 0), 8136);

    const tenantAccount = await request('/api/tenant-users', { cookie: ownerCookie, body: { name: 'Cư dân E2E phòng', email: 'room-e2e@test.local', password: 'RoomTenant@123', customerId: 'e2e-room' } });
    assert.equal(tenantAccount.response.status, 201);
    const roomTenantCookie = (await login('/api/tenant-login', { email: 'room-e2e@test.local', password: 'RoomTenant@123' }, 'nvp_tenant_')).cookie;
    assert.equal((await request('/api/tenant-portal', { cookie: roomTenantCookie })).payload.invoices.length, 0);

    const roomInvoice = invoiceFor('e2e-room');
    assert.equal((await request(`/api/invoices/${roomInvoice.id}/approve`, { cookie: ownerCookie, body: {} })).response.status, 200);
    const portal = await request('/api/tenant-portal', { cookie: roomTenantCookie });
    assert.deepEqual(portal.payload.invoices.map((invoice) => invoice.customerId), ['e2e-room']);
    assert.deepEqual(portal.payload.invoices[0].serviceItems.map((item) => item.amount), [100, 50, 25]);

    const collected = await request(`/api/invoices/${roomInvoice.id}/collect`, { cookie: staffCookie, body: { method: 'cash' } });
    assert.equal(collected.response.status, 200);
    assert.equal(collected.payload.cashflowEntry.amount, roomInvoice.amount);
    const reversed = await request(`/api/invoices/${roomInvoice.id}/reverse`, { cookie: ownerCookie, body: { reason: 'Kiểm tra hoàn tác E2E' } });
    assert.equal(reversed.response.status, 200);
    const finalState = await readState();
    const roomCashflow = JSON.parse(finalState['nvp-cashflow']).filter((entry) => entry.sourceId === roomInvoice.id);
    assert.equal(roomCashflow.length, 2);
    assert.equal(roomCashflow.reduce((total, entry) => total + (entry.type === 'income' ? entry.amount : -entry.amount), 0), 0);
    assert.equal(JSON.parse(finalState['nvp-invoices']).find((invoice) => invoice.id === roomInvoice.id).status, 'unpaid');
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