const staffSensitiveStorageKeys = ['nvp-cashflow', 'nvp-commissions', 'nvp-deposit-ledger', 'nvp-users', 'nvp-smart-home-config'];
let currentUserRole = sessionStorage.getItem('nvp-user-role') || '';
let currentUserName = sessionStorage.getItem('nvp-user-name') || '';
if (currentUserRole === 'staff') staffSensitiveStorageKeys.forEach((key) => localStorage.removeItem(key));

const root = document.documentElement;
const sidebar = document.querySelector('[data-sidebar]');
const overlay = document.querySelector('[data-sidebar-overlay]');
const toastBox = document.querySelector('[data-toast-box]');
const modalBackdrop = document.querySelector('[data-modal-backdrop]');
const modalTitle = document.querySelector('[data-modal-title]');
const modalContent = document.querySelector('[data-modal-content]');
const buildingSelect = document.querySelector('[data-building-select]');
const buildingCount = document.querySelector('.asset-stats .stat-card strong');
const apartmentCount = document.querySelectorAll('.asset-stats .stat-card strong')[1];
const bedCount = document.querySelectorAll('.asset-stats .stat-card strong')[2];
const storageKey = 'nvp-buildings';
const selectionKey = 'nvp-selected-building';
const leadStorageKey = 'nvp-leads';
const reservationStorageKey = 'nvp-reservations';
const taskStorageKey = 'nvp-tasks';
const invoiceStorageKey = 'nvp-invoices';
const cashflowStorageKey = 'nvp-cashflow';
const catalogStorageKey = 'nvp-catalogs';
const customerStorageKey = 'nvp-customers';
const bookingStorageKey = 'nvp-bookings';
const locationStorageKey = 'nvp-locations';
const meterLogStorageKey = 'nvp-meter-logs';
const commissionStorageKey = 'nvp-commissions';
const depositLedgerStorageKey = 'nvp-deposit-ledger';
const notificationStorageKey = 'nvp-notifications';
const userStorageKey = 'nvp-users';
const feedbackStorageKey = 'nvp-feedback';
const invoiceSettingsStorageKey = 'nvp-invoice-settings';
const hydrationReloadKey = 'nvp-hydration-reload-pending';
const apiBaseUrl = '/api';
const stateKeys = [storageKey, leadStorageKey, reservationStorageKey, taskStorageKey, invoiceStorageKey, cashflowStorageKey, catalogStorageKey, customerStorageKey, bookingStorageKey, locationStorageKey, meterLogStorageKey, commissionStorageKey, depositLedgerStorageKey, notificationStorageKey, userStorageKey, feedbackStorageKey, invoiceSettingsStorageKey];
localStorage.removeItem('nvp-contracts');
const pendingSyncKeys = new Set();
let syncTimeout;
let administrativeUnitsPromise;
let bankDirectoryPromise;
let passwordChangeRequired = false;
let modalCloseAction = null;
let customerManagerStatus = 'renting';
function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn(`Không thể đọc dữ liệu ${key}:`, error);
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

const moneyFieldNames = new Set(['amount', 'deposit', 'rentAmount', 'serviceFee', 'electricityRate', 'waterRate', 'managementFee', 'waterFixedAmount', 'rate', 'cost']);

function parseMoney(value) {
  const amount = Number(String(value ?? '').replace(/\D/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function setupMoneyInputs(container) {
  container.querySelectorAll('input').forEach((input) => {
    if (!moneyFieldNames.has(input.name)) return;
    input.type = 'text';
    input.inputMode = 'numeric';
    input.pattern = '[0-9.]*';
    const formatValue = () => {
      const digits = input.value.replace(/\D/g, '');
      input.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
    };
    input.addEventListener('input', formatValue);
    formatValue();
  });
}

async function getAdministrativeUnits() {
  administrativeUnitsPromise ||= fetch('/api/administrative-units').then((response) => {
    if (!response.ok) throw new Error('Administrative data unavailable');
    return response.json();
  });
  return administrativeUnitsPromise;
}

async function setupAdministrativeFields(form, selectedCity, selectedWard) {
  const citySelect = form.querySelector('[data-location-city]');
  const wardSelect = form.querySelector('[data-location-ward]');
  try {
    const provinces = await getAdministrativeUnits();
    const renderWards = () => {
      const province = provinces.find((item) => item.name === citySelect.value);
      const wards = province?.wards || [];
      wardSelect.disabled = !wards.length;
      wardSelect.innerHTML = `<option value="">${wards.length ? 'Chọn xã/phường' : 'Chọn tỉnh/thành phố trước'}</option>${wards.map((ward) => `<option value="${escapeHtml(ward.name)}" ${ward.name === selectedWard ? 'selected' : ''}>${escapeHtml(ward.name)}</option>`).join('')}`;
    };
    citySelect.innerHTML = `<option value="">Chọn tỉnh/thành phố</option>${provinces.map((province) => `<option value="${escapeHtml(province.name)}" ${province.name === selectedCity ? 'selected' : ''}>${escapeHtml(province.name)}</option>`).join('')}`;
    renderWards();
    citySelect.addEventListener('change', () => { selectedWard = ''; renderWards(); });
  } catch (error) {
    citySelect.innerHTML = '<option value="">Không thể tải tỉnh/thành phố</option>';
    wardSelect.innerHTML = '<option value="">Không thể tải xã/phường</option>';
    wardSelect.disabled = true;
  }
}

async function getBankDirectory() {
  bankDirectoryPromise ||= fetch('/api/banks').then(async (response) => {
    if (!response.ok) throw new Error('Bank directory unavailable');
    const payload = await response.json();
    return Array.isArray(payload.banks) ? payload.banks : [];
  });
  return bankDirectoryPromise;
}

async function setupBankFields(form, selectedName, selectedBin) {
  const bankNameInput = form.elements.namedItem('bankName');
  const bankBinInput = form.elements.namedItem('bankBin');
  if (!bankNameInput || !bankBinInput) return;
  const bankSelect = document.createElement('select');
  bankSelect.name = 'bankName';
  bankSelect.innerHTML = selectedName ? `<option value="${escapeHtml(selectedName)}" data-bin="${escapeHtml(selectedBin)}">${escapeHtml(selectedName)}</option>` : '<option value="">Đang tải danh sách ngân hàng...</option>';
  bankNameInput.replaceWith(bankSelect);
  bankBinInput.readOnly = true;
  bankBinInput.placeholder = 'Tự động theo ngân hàng';
  const applySelectedBank = () => {
    const option = bankSelect.selectedOptions[0];
    bankBinInput.value = option?.dataset.bin || '';
  };
  bankSelect.addEventListener('change', applySelectedBank);
  try {
    const banks = await getBankDirectory();
    const selectedBank = banks.find((bank) => bank.bin === selectedBin || bank.shortName.toLowerCase() === String(selectedName || '').toLowerCase());
    const legacyOption = selectedName && !selectedBank ? `<option value="${escapeHtml(selectedName)}" data-bin="${escapeHtml(selectedBin)}">${escapeHtml(selectedName)} (đã lưu)</option>` : '';
    bankSelect.innerHTML = `<option value="">Chọn ngân hàng</option>${legacyOption}${banks.map((bank) => `<option value="${escapeHtml(bank.shortName)}" data-bin="${escapeHtml(bank.bin)}">${escapeHtml(bank.shortName)} - ${escapeHtml(bank.name)}</option>`).join('')}`;
    bankSelect.value = selectedBank?.shortName || selectedName || '';
    applySelectedBank();
  } catch (error) {
    bankSelect.innerHTML = `${selectedName ? `<option value="${escapeHtml(selectedName)}" data-bin="${escapeHtml(selectedBin)}">${escapeHtml(selectedName)} (đã lưu)</option>` : ''}<option value="" ${selectedName ? '' : 'selected'}>Không thể tải danh sách ngân hàng</option>`;
    bankSelect.value = selectedName || '';
    applySelectedBank();
  }
}

const buildings = readStorage(storageKey, []).map((building) => ({
  ...building,
  apartments: Array.isArray(building.apartments)
    ? building.apartments.map((apartment) => apartment.propertyType === 'sleepbox' ? { ...apartment, propertyType: 'shared-room' } : apartment)
    : Array.from({ length: Number(building.apartments) || 0 }, (_, index) => ({ name: `Căn ${index + 1}`, beds: 0, status: 'empty' }))
}));
let selectedBuildingIndex = Math.min(Number(localStorage.getItem(selectionKey) || 0), Math.max(buildings.length - 1, 0));
const leads = readStorage(leadStorageKey, []);
const reservations = readStorage(reservationStorageKey, []);
const tasks = readStorage(taskStorageKey, []);
const invoices = readStorage(invoiceStorageKey, []);
const cashflow = readStorage(cashflowStorageKey, []);
const catalogs = readStorage(catalogStorageKey, {});
delete catalogs['rental-contract'];
const customers = readStorage(customerStorageKey, []);
const bookings = readStorage(bookingStorageKey, []);
const locations = readStorage(locationStorageKey, []);
const meterLogs = readStorage(meterLogStorageKey, []);
const commissions = readStorage(commissionStorageKey, []);
const depositLedger = readStorage(depositLedgerStorageKey, []);
const notifications = readStorage(notificationStorageKey, []);
const users = readStorage(userStorageKey, []);
const feedback = readStorage(feedbackStorageKey, []);
let invoiceSettings = readStorage(invoiceSettingsStorageKey, {});

async function sendPushNotification(payload) {
  try { await fetch('/api/push-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (error) { console.warn('Push notification failed:', error); }
}
const propertyTypes = {
  apartment: 'Căn hộ',
  homestay: 'Homestay theo ngày',
  'shared-room': 'Phòng ở ghép',
  office: 'Văn phòng',
  shophouse: 'Mặt bằng kinh doanh',
  'whole-building': 'Tòa nhà nguyên căn'
};
const bedDisplayPropertyTypes = new Set(['homestay', 'shared-room']);
const rentableBedPropertyTypes = new Set(['shared-room']);
const catalogConfigs = {
  vehicles: ['Phương tiện', 'Biển số hoặc tên phương tiện'],
  assets: ['Tài sản', 'Tên tài sản'],
  hotline: ['Quản lý hotline', 'Tên liên hệ'],
  'work-types': ['Loại công việc', 'Tên loại công việc'],
  categories: ['Danh mục chung', 'Tên danh mục'],
  signatures: ['Mẫu chữ ký', 'Tên mẫu chữ ký'],
  'deposit-contract': ['Mẫu hợp đồng đặt cọc', 'Tên mẫu'],
  handover: ['Mẫu biên bản bàn giao', 'Tên mẫu'],
  'invoice-template': ['Mẫu hóa đơn', 'Tên mẫu'],
  'cash-template': ['Mẫu thu chi', 'Tên mẫu'],
  providers: ['Nhà cung cấp', 'Tên nhà cung cấp'],
  warehouses: ['Kho tài sản', 'Tên kho tài sản'],
  'asset-types': ['Loại tài sản', 'Tên loại tài sản'],
  'moving-logs': ['Lịch sử di chuyển tài sản', 'Tên tài sản hoặc mã tài sản'],
  'asset-fix': ['Lịch sử sửa chữa', 'Tên tài sản hoặc hạng mục sửa chữa']
};
let deferredInstallPrompt;
let lastFocusedElement;
let pwaInstalled = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener('appinstalled', () => {
  pwaInstalled = true;
  deferredInstallPrompt = null;
  document.querySelector('[data-install-app]')?.replaceChildren(document.createTextNode('Ứng dụng đã được cài đặt'));
  document.querySelector('[data-install-app]')?.setAttribute('disabled', '');
  showToast('Đã cài đặt ứng dụng Phú Gia Land');
});

function showToast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toastBox.classList.remove('show'), 2600);
}

function confirmPermanentDeletion(itemLabel, relatedDetails = '') {
  const details = relatedDetails ? `\n\nDữ liệu liên quan: ${relatedDetails}.` : '';
  if (!window.confirm(`Bạn đang yêu cầu xóa ${itemLabel}.${details}\n\nHãy kiểm tra kỹ trước khi tiếp tục.`)) return false;
  return window.confirm(`XÁC NHẬN LẦN CUỐI\n\nXóa vĩnh viễn ${itemLabel}? Thao tác này không thể hoàn tác.`);
}

function openModal(title, content, onReady) {
  lastFocusedElement = document.activeElement;
  modalCloseAction = null;
  modalBackdrop.querySelector('[data-modal]').classList.remove('modal-wide', 'utility-modal', 'building-form-modal', 'apartment-manager-modal', 'apartment-building-picker-modal');
  modalTitle.textContent = title;
  modalContent.innerHTML = content;
  modalBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  onReady?.();
  setupMoneyInputs(modalContent);
  modalBackdrop.querySelector('[data-modal-close]')?.focus();
}

function closeModal() {
  if (passwordChangeRequired) {
    showToast('Bạn cần đổi mật khẩu mặc định để tiếp tục');
    return;
  }
  if (modalCloseAction) {
    const closeAction = modalCloseAction;
    modalCloseAction = null;
    closeAction();
    return;
  }
  modalBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
  lastFocusedElement?.focus();
}

modalBackdrop.addEventListener('keydown', (event) => {
  if (modalBackdrop.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...modalBackdrop.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary')]
    .filter((element) => element.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

async function installApp() {
  if (pwaInstalled) {
    showToast('Ứng dụng đã được cài đặt trên thiết bị này');
    return;
  }
  if (!deferredInstallPrompt) {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openModal('Cài đặt ứng dụng', `<div class="pwa-install-help"><p>${isIos ? 'Trên Safari, mở menu Chia sẻ rồi chọn Thêm vào Màn hình chính.' : 'Dùng menu của trình duyệt và chọn Cài đặt ứng dụng hoặc Thêm vào màn hình chính.'}</p><div class="form-actions"><button type="button" class="primary-button" data-modal-cancel>Đã hiểu</button></div></div>`, () => document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal));
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  showToast(choice.outcome === 'accepted' ? 'Đang cài đặt ứng dụng' : 'Đã hủy cài đặt ứng dụng');
}

function persistBuildings(sync = true) {
  localStorage.setItem(storageKey, JSON.stringify(buildings));
  if (buildingCount) buildingCount.textContent = buildings.length;
  updateDashboard();
  if (sync) queueServerSync(storageKey);
}

function updateDashboard() {
  const apartments = buildings[selectedBuildingIndex]?.apartments || [];
  const bedInventory = apartments.filter((apartment) => rentableBedPropertyTypes.has(apartment.propertyType));
  const beds = bedInventory.reduce((total, apartment) => total + Number(apartment.beds || 0), 0);
  const apartmentStatus = ['rented', 'reserved', 'empty', 'inactive'];
  const apartmentCounts = apartmentStatus.map((status) => apartments.filter((apartment) => apartment.status === status).length);
  const bedCounts = apartmentStatus.map((status) => bedInventory.filter((apartment) => apartment.status === status).reduce((total, apartment) => total + Number(apartment.beds || 0), 0));
  if (apartmentCount) apartmentCount.textContent = apartments.length;
  if (bedCount) bedCount.textContent = beds;
  const hasBedInventory = bedInventory.length > 0;
  document.querySelector('[data-bed-stat-card]')?.classList.toggle('bed-inventory-hidden', !hasBedInventory);
  document.querySelector('[data-bed-status-row]')?.classList.toggle('bed-inventory-hidden', !hasBedInventory);
  document.querySelector('[data-asset-stats]')?.classList.toggle('without-bed-inventory', !hasBedInventory);
  const apartmentCells = document.querySelector('[data-apartment-status-row]')?.querySelectorAll('.status-cell') || [];
  const bedCells = document.querySelector('[data-bed-status-row]')?.querySelectorAll('.status-cell') || [];
  [apartmentCells, bedCells].forEach((cells, rowIndex) => {
    const counts = rowIndex ? bedCounts : apartmentCounts;
    const total = counts.reduce((sum, count) => sum + count, 0);
    counts.forEach((count, index) => {
      if (!cells[index]) return;
      cells[index].querySelector('b').textContent = count;
      cells[index].querySelector('span').innerHTML = `${total ? ((count / total) * 100).toFixed(2) : '0.00'} % <em>${rowIndex ? 'giường' : 'căn hộ'}</em>`;
    });
  });
  const occupancy = apartments.length ? ((apartmentCounts[0] / apartments.length) * 100).toFixed(0) : '0';
  const occupancyCard = document.querySelectorAll('.asset-stats .stat-card strong')[3];
  if (occupancyCard) occupancyCard.textContent = `${occupancy}%`;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const completedBookings = bookings.filter((booking) => booking.status === 'checkedOut' && String(booking.checkedOutAt || booking.checkOut || '').slice(0, 7) === currentMonth);
  const monthlyInvoices = invoices.filter((invoice) => invoice.approvalStatus !== 'pending' && invoice.type !== 'booking' && String(invoice.createdAt || '').slice(0, 7) === currentMonth);
  const invoiceTotals = {
    rent: monthlyInvoices.reduce((total, invoice) => total + Number(invoice.type === 'rent' ? invoice.amount : invoice.billingLines?.rent || 0), 0) + completedBookings.reduce((total, booking) => total + Number(booking.amount || 0), 0),
    electricity: monthlyInvoices.reduce((total, invoice) => total + Number(invoice.type === 'electricity' ? invoice.amount : invoice.billingLines?.electricity || 0), 0),
    water: monthlyInvoices.reduce((total, invoice) => total + Number(invoice.type === 'water' ? invoice.amount : invoice.billingLines?.water || 0), 0),
    service: monthlyInvoices.reduce((total, invoice) => total + Number(invoice.type === 'service' ? invoice.amount : invoice.billingLines?.service || 0), 0) + completedBookings.reduce((total, booking) => total + Number(booking.serviceFee || 0), 0)
  };
  const invoiceTotal = Object.values(invoiceTotals).reduce((total, amount) => total + amount, 0);
  const amountElement = document.querySelector('.amount');
  if (amountElement) amountElement.firstChild.textContent = `${invoiceTotal.toLocaleString('vi-VN')} đ `;
  document.querySelectorAll('.invoice-body li b').forEach((element, index) => {
    const amount = Object.values(invoiceTotals)[index] || 0;
    element.textContent = `${amount.toLocaleString('vi-VN')} đ　${invoiceTotal ? ((amount / invoiceTotal) * 100).toFixed(0) : 0}%`;
  });
  const income = cashflow.filter((entry) => entry.affectsCash !== false && entry.type === 'income').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const expense = cashflow.filter((entry) => entry.affectsCash !== false && entry.type === 'expense').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const chartMax = Math.max(income, expense, 1);
  document.querySelector('.chart-income')?.setAttribute('d', `M0 ${210 - (income / chartMax) * 190} L700 ${210 - (income / chartMax) * 190}`);
  document.querySelector('.chart-expense')?.setAttribute('d', `M0 ${210 - (expense / chartMax) * 190} L700 ${210 - (expense / chartMax) * 190}`);
  const supportMetrics = document.querySelectorAll('.grid-three > .panel:nth-child(1) .split-metrics strong');
  if (supportMetrics[0]) supportMetrics[0].textContent = feedback.filter((item) => item.status === 'new').length;
  if (supportMetrics[1]) supportMetrics[1].textContent = feedback.filter((item) => item.status === 'processing').length;
  const supportFooter = document.querySelectorAll('.grid-three > .panel:nth-child(1) .panel-foot b');
  if (supportFooter[0]) supportFooter[0].textContent = feedback.filter((item) => item.status === 'completed').length;
  if (supportFooter[1]) supportFooter[1].textContent = feedback.length;
  const reservationMetrics = document.querySelectorAll('.grid-three > .panel:nth-child(2) .split-metrics strong');
  if (reservationMetrics[0]) reservationMetrics[0].textContent = reservations.length;
  if (reservationMetrics[1]) reservationMetrics[1].textContent = customers.filter((customer) => customer.status === 'renting').length;
  const taskPanel = document.querySelector('.lower-grid > .panel:first-child');
  if (taskPanel) {
    const taskValues = taskPanel.querySelectorAll('.task-body > p b');
    if (taskValues[0]) taskValues[0].textContent = tasks.length;
    if (taskValues[1]) taskValues[1].textContent = tasks.filter((task) => task.status === 'done').length;
    const taskStatuses = taskPanel.querySelectorAll('.mini-stats span b');
    if (taskStatuses[0]) taskStatuses[0].textContent = tasks.filter((task) => task.status === 'todo').length;
    if (taskStatuses[1]) taskStatuses[1].textContent = tasks.filter((task) => task.status === 'doing').length;
    if (taskStatuses[2]) taskStatuses[2].textContent = tasks.filter((task) => task.status === 'done').length;
  }
  const setDashboardValue = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.firstChild.textContent = `${value}${element.tagName === 'P' ? ' ' : ''}`;
  };
  const rentingCustomers = customers.filter((customer) => customer.status === 'renting');
  setDashboardValue('[data-dashboard-renting]', rentingCustomers.length);
  setDashboardValue('[data-dashboard-moved]', customers.filter((customer) => customer.status === 'moved').length);
  setDashboardValue('[data-dashboard-visitors]', customers.filter((customer) => customer.status === 'visitor').length);
  setDashboardValue('[data-dashboard-linked]', customers.filter((customer) => customer.accountId).length);
  setDashboardValue('[data-dashboard-unlinked]', rentingCustomers.filter((customer) => !customer.accountId).length);
  setDashboardValue('[data-dashboard-unpaid]', invoices.filter((invoice) => invoice.approvalStatus !== 'pending' && invoice.status !== 'paid').length);
  setDashboardValue('[data-dashboard-unmetered]', apartments.filter((apartment) => !String(apartment.meterId || '').trim()).length);
  setDashboardValue('[data-dashboard-urgent]', feedback.filter((item) => item.priority === 'urgent' && item.status !== 'completed').length);
  setDashboardValue('[data-dashboard-open-tasks]', tasks.filter((task) => task.status !== 'done').length);
}

function selectBuilding(index) {
  selectedBuildingIndex = index;
  localStorage.setItem(selectionKey, String(index));
  const building = buildings[index];
  if (!building) return;
  buildingSelect.firstChild.textContent = building.name;
  updateDashboard();
}

function getBuildingFloors(building) {
  const configuredFloors = Array.isArray(building?.floors) ? building.floors : [];
  const existingFloors = (building?.apartments || []).map((apartment) => String(apartment.floor ?? '')).filter(Boolean);
  return normalizeFloors([...configuredFloors, ...existingFloors]);
}

function normalizeFloors(floors) {
  const values = [...new Set(floors.map((floor) => String(floor).trim()).filter(Boolean))];
  const totalFloors = values.length === 1 ? Number(values[0]) : 0;
  const normalized = Number.isInteger(totalFloors) && totalFloors > 0
    ? Array.from({ length: totalFloors }, (_, index) => String(index + 1))
    : values;
  return normalized
    .sort((first, second) => Number(first) - Number(second) || first.localeCompare(second));
}

function parseFloors(value) {
  return normalizeFloors(String(value || '').split(','));
}

function parseFloorRateOverrides(value, fieldLabel) {
  const entries = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  const rates = {};
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    const floor = separator >= 0 ? entry.slice(0, separator).trim() : '';
    const amountText = separator >= 0 ? entry.slice(separator + 1).trim() : '';
    const amount = parseMoney(amountText);
    if (!floor || !amountText || amount <= 0) throw new Error(`${fieldLabel}: dùng định dạng Tầng:Số tiền, ví dụ B1:3.500, 2:4.000`);
    if (Object.prototype.hasOwnProperty.call(rates, floor)) throw new Error(`${fieldLabel}: tầng ${floor} bị lặp`);
    rates[floor] = amount;
  }
  return rates;
}

function setupBillingSettingsForm(form) {
  const field = (name) => form.elements.namedItem(name);
  const label = (name) => field(name)?.closest('label');
  const grid = field('debtAccount')?.closest('.form-grid');
  if (!grid) return;
  const groups = [
    ['Thu tiền', 'Phương thức nhận tiền và hạn thanh toán của hóa đơn hằng tháng.', ['debtAccount', 'paymentDay']],
    ['Tài khoản nhận tiền', 'Chọn ngân hàng và nhập số tài khoản để tạo VietQR trên hóa đơn đã duyệt.', ['bankName', 'bankNumber', 'bankHolder']],
    ['Điện, nước và phí định kỳ', 'Mức tại căn hộ được ưu tiên, sau đó đến mức theo tầng, cuối cùng là mức mặc định của tòa nhà.', ['electricityRate', 'electricityFloorRates', 'waterBillingMode', 'waterRate', 'waterFixedAmount', 'waterFloorRates', 'managementFee']]
  ];
  groups.forEach(([title, description, names]) => {
    const heading = document.createElement('div');
    heading.className = 'settings-group-heading full-field';
    heading.innerHTML = `<strong>${title}</strong><small>${description}</small>`;
    grid.append(heading);
    names.forEach((name) => { const element = label(name); if (element) grid.append(element); });
  });
  const help = {
    debtAccount: 'Chuyển khoản sẽ yêu cầu đủ thông tin ngân hàng và cho phép tạo VietQR.',
    paymentDay: 'Từ ngày 1 đến 31; tháng ngắn hơn sẽ tự dùng ngày cuối tháng.',
    bankName: 'Chọn ngân hàng nhận tiền; hệ thống tự điền BIN tương ứng.',
    bankNumber: 'Chỉ nhập số tài khoản nhận tiền. Không nhập số thẻ, PIN hoặc OTP.',
    bankHolder: 'Không bắt buộc để tạo QR, nhưng nên nhập để người trả tiền đối chiếu.',
    electricityRate: 'Mức mặc định khi căn hộ và tầng chưa có giá riêng.',
    electricityFloorRates: 'Không bắt buộc. Ví dụ: 1:3.500, 2:4.000, B1:3.200.',
    waterBillingMode: 'Theo m³ dùng nhật ký đồng hồ; mức cố định thu đều mỗi tháng.',
    waterRate: 'Mức mặc định khi tính nước theo chỉ số đồng hồ.',
    waterFixedAmount: 'Mức mặc định khi căn hộ và tầng chưa có mức riêng.',
    waterFloorRates: 'Không bắt buộc. Ví dụ: 1:150.000, 2:180.000.',
    managementFee: 'Mức mặc định; phí riêng tại căn hộ sẽ được ưu tiên.'
  };
  Object.entries(help).forEach(([name, text]) => label(name)?.insertAdjacentHTML('beforeend', `<small class="form-hint">${text}</small>`));
  label('debtAccount').firstChild.textContent = 'Phương thức thu tiền';
  field('debtAccount').options[0].textContent = 'Chưa thiết lập';
  field('debtAccount').options[1].textContent = 'Chuyển khoản ngân hàng (VietQR)';
  field('debtAccount').options[2].textContent = 'Tiền mặt';
  label('paymentDay').firstChild.textContent = 'Hạn thanh toán hằng tháng';
  label('waterRate').firstChild.textContent = 'Đơn giá nước mặc định (đ/m³)';
  label('waterFixedAmount').firstChild.textContent = 'Mức nước cố định mặc định (đ/tháng)';
  label('bankName').classList.add('full-field', 'bank-name-field');
  label('bankBin').hidden = true;
  const bankFields = ['bankName', 'bankNumber', 'bankHolder'];
  const requiredBankFields = new Set(['bankName', 'bankNumber']);
  const updateVisibility = () => {
    const usesBank = field('debtAccount').value === 'bank';
    bankFields.forEach((name) => { label(name).hidden = !usesBank; field(name).required = usesBank && requiredBankFields.has(name); });
    const fixedWater = field('waterBillingMode').value === 'fixed';
    ['waterFixedAmount', 'waterFloorRates'].forEach((name) => { label(name).hidden = !fixedWater; });
    label('waterRate').hidden = fixedWater;
  };
  field('debtAccount').addEventListener('change', updateVisibility);
  field('waterBillingMode').addEventListener('change', updateVisibility);
  updateVisibility();
}

function openBuildingForm(buildingToEdit = null) {
  const editIndex = buildingToEdit ? buildings.indexOf(buildingToEdit) : -1;
  const building = buildingToEdit || { services: [], settings: {}, apartments: [] };
  const services = building.services || [];
  const settings = building.settings || {};
  const serviceItems = services.length
    ? services.map((service, index) => `<div class="service-item"><div><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.feeType)} · ${escapeHtml(service.unitType)}</small></div><button type="button" data-service-delete="${index}" aria-label="Xóa dịch vụ">×</button></div>`).join('')
    : '<p class="empty-state">Chưa có dịch vụ nào</p>';
    openModal('Tòa nhà', `<form class="building-form building-form-wide" data-building-form>
    <section class="form-section"><div class="form-section-title"><strong>Thông tin cơ bản</strong><label class="inline-toggle">Hoạt động<input name="active" type="checkbox" ${building.active !== false ? 'checked' : ''}><span></span></label></div><div class="form-grid"><label><span class="field-label">Tên tòa nhà <b>*</b></span><input name="name" required maxlength="80" value="${escapeHtml(building.name || '')}" placeholder="Ví dụ: Vạn Phúc Garden"></label><label>Tên viết tắt/Mã tòa <input name="code" maxlength="30" value="${escapeHtml(building.code || '')}" placeholder="Nhập mã viết tắt"></label><label>Loại hình khai thác<select name="listingType"><option value="mixed" ${!building.listingType || building.listingType === 'mixed' ? 'selected' : ''}>Nhiều loại hình trong tòa</option><option value="whole-building" ${building.listingType === 'whole-building' ? 'selected' : ''}>Tòa nhà nguyên căn</option></select></label></div></section>
    <section class="form-section"><div class="form-section-title"><strong>Thông tin địa chỉ</strong></div><div class="form-grid"><label>Tỉnh/Thành phố <b>*</b><select name="city" data-location-city required><option value="">Đang tải tỉnh/thành phố...</option></select></label><label>Xã/Phường <b>*</b><select name="ward" data-location-ward required disabled><option value="">Chọn tỉnh/thành phố trước</option></select></label><label>Khu vực <input name="area" value="${escapeHtml(settings.area || '')}" placeholder="Ví dụ: KĐT Vạn Phúc"></label><label>Địa chỉ chi tiết <b>*</b><input name="address" required value="${escapeHtml(building.address || '')}" placeholder="Số nhà, đường, khu vực"></label></div></section>
    <section class="form-section"><div class="form-section-title"><strong>Thông tin quản lý</strong></div><div class="form-grid"><label>Họ tên người quản lý<input name="managerName" maxlength="100" value="${escapeHtml(settings.managerName || '')}" placeholder="Ví dụ: Nguyễn Văn An"></label><label>Số điện thoại quản lý<input name="companyPhone" type="tel" maxlength="30" value="${escapeHtml(settings.companyPhone || '')}" placeholder="Ví dụ: 0981 444 413"></label></div></section>
    <section class="form-section"><div class="form-section-title"><strong>Ảnh/video tòa nhà</strong></div><div class="form-grid"><label class="full-field">Media nguyên căn<input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple><small class="form-hint">Dùng cho trường hợp cho thuê nguyên căn. Tối đa 5 ảnh và 1 video.</small></label></div></section>
    <section class="form-section"><div class="form-section-title"><strong>Dịch vụ tòa nhà</strong></div><div class="service-list">${serviceItems}</div><button class="service-add-button" type="button" data-service-add>＋ Thêm dịch vụ</button></section>
    <section class="form-section"><div class="form-section-title"><strong>Cấu hình thanh toán &amp; dịch vụ</strong></div><div class="form-grid"><label>Tài khoản gạch nợ tự động<select name="debtAccount"><option value="">Chọn</option><option ${settings.debtAccount === 'bank' ? 'selected' : ''} value="bank">Tài khoản ngân hàng</option><option ${settings.debtAccount === 'cash' ? 'selected' : ''} value="cash">Tài khoản tiền mặt</option></select></label><label>Ngày thanh toán hằng tháng<input name="paymentDay" type="number" min="1" max="31" value="${Number(settings.paymentDay || 5)}"></label><label>Ngân hàng nhận tiền<input name="bankName" maxlength="80" value="${escapeHtml(settings.bankName || '')}" placeholder="Ví dụ: MB Bank"></label><label>Mã BIN ngân hàng<input name="bankBin" inputmode="numeric" maxlength="12" value="${escapeHtml(settings.bankBin || '')}" placeholder="Ví dụ: 970422"></label><label>Số tài khoản<input name="bankNumber" inputmode="numeric" maxlength="30" value="${escapeHtml(settings.bankNumber || '')}" placeholder="Nhập số tài khoản"></label><label>Tên chủ tài khoản<input name="bankHolder" maxlength="100" value="${escapeHtml(settings.bankHolder || '')}" placeholder="Tên chủ tài khoản"></label><label>Đơn giá điện (đ/kWh)<input name="electricityRate" type="number" min="0" value="${Number(settings.electricityRate || 0)}"></label><label>Đơn giá nước (đ/khối)<input name="waterRate" type="number" min="0" value="${Number(settings.waterRate || 0)}"></label><label>Phí quản lý (đ/tháng)<input name="managementFee" type="number" min="0" value="${Number(settings.managementFee || 0)}"></label></div></section>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy bỏ</button><button class="primary-button" type="submit">Lưu</button></div>
  </form>`, () => {
    document.querySelector('[data-modal]').classList.add('building-form-modal');
    const buildingForm = document.querySelector('[data-building-form]');
    const waterRateField = buildingForm.querySelector('[name="waterRate"]');
    const listingTypeField = buildingForm.querySelector('[name="listingType"]');
    listingTypeField?.closest('label').insertAdjacentHTML('afterend', `<label>Số tầng hoặc danh sách tầng<input name="floors" maxlength="300" value="${escapeHtml(getBuildingFloors(building).join(', '))}" placeholder="Ví dụ: 4 hoặc B1, 1, 2, 3, 4"><small class="form-hint">Nhập 4 để tạo tầng 1 đến tầng 4; nhập danh sách khi có tầng hầm hoặc tầng đặc biệt.</small></label>`);
    const basicInfoGrid = listingTypeField?.closest('.form-grid');
    basicInfoGrid?.classList.add('basic-info-grid');
    buildingForm.querySelector('[name="name"]')?.closest('label').classList.add('basic-info-wide');
    buildingForm.querySelector('[name="floors"]')?.closest('label').classList.add('basic-info-wide');
    listingTypeField?.closest('label').insertAdjacentHTML('beforeend', '<small class="form-hint">Chọn nguyên căn khi toàn bộ tòa nhà được cho thuê như một sản phẩm.</small>');
    if (waterRateField) {
      waterRateField.closest('label').insertAdjacentHTML('afterend', `<label>Chế độ tiền nước<select name="waterBillingMode"><option value="metered" ${settings.waterBillingMode !== 'fixed' ? 'selected' : ''}>Theo m³</option><option value="fixed" ${settings.waterBillingMode === 'fixed' ? 'selected' : ''}>Mức cố định</option></select></label><label>Mức cố định mặc định (đ/tháng)<input name="waterFixedAmount" type="number" min="0" value="${Number(settings.waterFixedAmount || 0)}"></label><label>Mức nước theo tầng<input name="waterFloorRates" maxlength="300" value="${escapeHtml(Object.entries(settings.waterFloorRates || {}).map(([floor, amount]) => `${floor}:${Number(amount).toLocaleString('vi-VN')}`).join(', '))}" placeholder="Ví dụ: 1:150.000, 2:180.000"></label><label>Giá điện theo tầng (đ/kWh)<input name="electricityFloorRates" maxlength="300" value="${escapeHtml(Object.entries(settings.electricityFloorRates || {}).map(([floor, amount]) => `${floor}:${Number(amount).toLocaleString('vi-VN')}`).join(', '))}" placeholder="Ví dụ: 1:3.500, 2:4.000"></label>`);
    }
    setupBankFields(buildingForm, settings.bankName || '', settings.bankBin || '');
    setupBillingSettingsForm(buildingForm);
    setupAdministrativeFields(buildingForm, settings.city || '', settings.ward || '');
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-service-add]').addEventListener('click', () => openServiceForm(building));
    document.querySelectorAll('[data-service-delete]').forEach((button) => button.addEventListener('click', () => {
      services.splice(Number(button.dataset.serviceDelete), 1);
      openBuildingForm(building);
    }));
    buildingForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const apartmentTotal = Number(form.get('apartments') || 0);
      const waterBillingMode = form.get('waterBillingMode') === 'fixed' ? 'fixed' : 'metered';
      const waterFixedAmount = parseMoney(form.get('waterFixedAmount'));
      const debtAccount = ['bank', 'cash'].includes(form.get('debtAccount')) ? form.get('debtAccount') : '';
      const paymentDay = Number(form.get('paymentDay'));
      const bankName = String(form.get('bankName') || '').trim();
      const bankBin = String(form.get('bankBin') || '').replace(/\s/g, '');
      const bankNumber = String(form.get('bankNumber') || '').replace(/\s/g, '');
      const bankHolder = String(form.get('bankHolder') || '').trim().toUpperCase();
      if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) { showToast('Hạn thanh toán phải là ngày từ 1 đến 31'); return; }
      if (debtAccount === 'bank' && !/^\d{6}$/.test(bankBin)) { showToast('Mã BIN ngân hàng phải gồm đúng 6 chữ số'); return; }
      if (debtAccount === 'bank' && !/^\d{6,30}$/.test(bankNumber)) { showToast('Số tài khoản phải gồm từ 6 đến 30 chữ số'); return; }
      let waterFloorRates;
      let electricityFloorRates;
      try {
        waterFloorRates = waterBillingMode === 'fixed' ? parseFloorRateOverrides(form.get('waterFloorRates'), 'Mức nước theo tầng') : {};
        electricityFloorRates = parseFloorRateOverrides(form.get('electricityFloorRates'), 'Giá điện theo tầng');
      } catch (error) {
        showToast(error.message);
        return;
      }
      const mediaFiles = Array.from(form.getAll('media')).filter((file) => file?.size);
      const existingMedia = Array.isArray(building.media) ? building.media : [];
      const imageCount = existingMedia.filter((item) => item.kind === 'image').length + mediaFiles.filter((file) => file.type.startsWith('image/')).length;
      const videoCount = existingMedia.filter((item) => item.kind === 'video').length + mediaFiles.filter((file) => file.type.startsWith('video/')).length;
      if (imageCount > 5 || videoCount > 1) { showToast('Mỗi tòa nhà chỉ được tối đa 5 ảnh và 1 video'); return; }
      if (mediaFiles.some((file) => file.size > (file.type.startsWith('video/') ? 20_000_000 : 5_000_000))) { showToast('Ảnh tối đa 5 MB, video tối đa 20 MB'); return; }
      try {
        const uploadedMedia = [];
        for (const [index, file] of mediaFiles.entries()) uploadedMedia.push(await uploadPropertyMedia(file, { code: form.get('code'), name: form.get('name') }, 'NGUYEN-CAN', existingMedia.length + index + 1));
        const media = [...existingMedia, ...uploadedMedia];
        const nextBuilding = { ...building, name: form.get('name').trim(), code: form.get('code').trim(), listingType: form.get('listingType'), floors: parseFloors(form.get('floors')), address: form.get('address').trim(), active: form.get('active') === 'on', media, image: media.find((item) => item.kind === 'image')?.url || building.image || '', services, settings: { ...settings, city: form.get('city'), ward: form.get('ward').trim(), area: form.get('area').trim(), debtAccount: form.get('debtAccount'), paymentDay: Number(form.get('paymentDay') || 5), bankName: form.get('bankName').trim(), bankBin: form.get('bankBin').trim(), bankNumber: form.get('bankNumber').trim(), bankHolder: form.get('bankHolder').trim(), electricityRate: parseMoney(form.get('electricityRate')), waterRate: parseMoney(form.get('waterRate')), managementFee: parseMoney(form.get('managementFee')) }, apartments: building.apartments || Array.from({ length: apartmentTotal }, (_, index) => ({ name: `Căn ${index + 1}`, beds: 0, status: 'empty' })) };
      delete nextBuilding.settings.contractTemplate;
      nextBuilding.settings.debtAccount = debtAccount;
      nextBuilding.settings.paymentDay = paymentDay;
      nextBuilding.settings.bankName = debtAccount === 'bank' ? bankName : '';
      nextBuilding.settings.bankBin = debtAccount === 'bank' ? bankBin : '';
      nextBuilding.settings.bankNumber = debtAccount === 'bank' ? bankNumber : '';
      nextBuilding.settings.bankHolder = debtAccount === 'bank' ? bankHolder : '';
      nextBuilding.settings.waterBillingMode = waterBillingMode;
      nextBuilding.settings.waterFixedAmount = waterFixedAmount;
      nextBuilding.settings.waterRate = waterBillingMode === 'metered' ? parseMoney(form.get('waterRate')) : 0;
      nextBuilding.settings.waterFloorRates = waterFloorRates;
      nextBuilding.settings.electricityFloorRates = electricityFloorRates;
      nextBuilding.settings.managerName = String(form.get('managerName') || '').trim();
      nextBuilding.settings.companyPhone = String(form.get('companyPhone') || '').trim();
      if (editIndex >= 0) buildings[editIndex] = nextBuilding;
      else buildings.push(nextBuilding);
      selectBuilding(buildings.indexOf(nextBuilding));
      persistBuildings();
      closeModal();
      showToast(editIndex >= 0 ? 'Đã cập nhật tòa nhà' : 'Đã thêm tòa nhà');
      } catch (error) {
        showToast(error.message || 'Không thể lưu media tòa nhà');
      }
    });
  });
}

function openServiceForm(building) {
  openModal('Phí dịch vụ', `<form class="building-form service-form" data-service-form><div class="form-grid"><label>Tên dịch vụ <b>*</b><input name="name" required maxlength="80" placeholder="Tên dịch vụ"></label><label>Loại phí <b>*</b><select name="feeType" required><option value="">Chọn</option><option>Điện</option><option>Nước</option><option>Phí quản lý</option><option>Dịch vụ khác</option></select></label><label>Loại đơn giá <b>*</b><select name="unitType" required><option value="">Chọn</option><option>Theo số lượng</option><option>Theo căn hộ</option><option>Cố định</option></select></label><label>Thuế suất <b>*</b><select name="tax" required><option value="">Chọn</option><option>Không chịu thuế</option><option>5%</option><option>8%</option><option>10%</option></select></label><label>Tòa nhà sử dụng <b>*</b><select name="building" required><option value="${escapeHtml(building.name || '')}">${escapeHtml(building.name || 'Tòa nhà hiện tại')}</option></select></label><label class="full-field">Mô tả<textarea name="description" maxlength="300" placeholder="Mô tả"></textarea></label></div><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy bỏ</button><button class="primary-button" type="submit">Lưu</button></div></form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', () => openBuildingForm(building));
    document.querySelector('[data-service-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      building.services = building.services || [];
      building.services.push({ name: form.get('name').trim(), feeType: form.get('feeType'), unitType: form.get('unitType'), tax: form.get('tax'), description: form.get('description').trim() });
      persistBuildings();
      openBuildingForm(building);
      showToast('Đã thêm dịch vụ tòa nhà');
    });
  });
}

function renderBuildingPicker() {
  const options = buildings.length
    ? buildings.map((building, index) => `<button class="modal-option" type="button" data-building-index="${index}"><span>${escapeHtml(building.name)}</span><small>${building.listingType === 'whole-building' ? 'Tòa nhà nguyên căn' : 'Tòa nhà đa loại hình'} · ${escapeHtml(building.address || 'Chưa cập nhật địa chỉ')}</small></button>`).join('')
    : '<p class="empty-state">Chưa có tòa nhà nào. Hãy tạo tòa nhà đầu tiên.</p>';
  openModal('Chọn tòa nhà', `<div class="modal-list">${options}</div><button class="modal-secondary" type="button" data-modal-add>＋ Tạo tòa nhà mới</button>`, () => {
    document.querySelectorAll('[data-building-index]').forEach((option) => option.addEventListener('click', () => {
      const building = buildings[Number(option.dataset.buildingIndex)];
      selectBuilding(Number(option.dataset.buildingIndex));
      closeModal();
      showToast(`Đã chọn ${building.name}`);
    }));
    document.querySelector('[data-modal-add]').addEventListener('click', openBuildingForm);
  });
}

function openBuildingManager() {
  const renderRows = (query = '', status = 'all') => {
    const filtered = buildings.filter((building) => {
      const matchesQuery = `${building.name} ${building.code || ''} ${building.address || ''}`.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = status === 'all' || (status === 'active' ? building.active !== false : building.active === false);
      return matchesQuery && matchesStatus;
    });
    return filtered.length ? filtered.map((building) => {
      const index = buildings.indexOf(building);
      const code = building.code || `CH${String(index + 1).padStart(6, '0')}`;
      const address = [building.address, building.settings?.area, building.settings?.ward, building.settings?.city].filter(Boolean).join(', ') || 'Chưa cập nhật địa chỉ';
      const apartmentCount = (building.apartments || []).length;
      const typeCounts = (building.apartments || []).reduce((counts, apartment) => { const type = apartment.propertyType || 'apartment'; counts[type] = (counts[type] || 0) + 1; return counts; }, {});
      const inventory = building.listingType === 'whole-building' ? 'Cho thuê nguyên căn' : Object.entries(typeCounts).map(([type, count]) => `${count} ${propertyTypes[type] || 'Không gian'}`).join(' · ') || 'Chưa có không gian';
      return `<tr><td><input type="checkbox" aria-label="Chọn ${escapeHtml(building.name)}"></td><td><strong class="building-code">${escapeHtml(code)}</strong></td><td><div class="table-actions"><button type="button" data-building-edit="${index}" aria-label="Sửa">✎</button><button type="button" class="danger-action" data-building-delete="${index}" aria-label="Xóa">▣</button></div></td><td><strong>${inventory}</strong><a href="#apartments" data-building-apartments="${index}">(Quản lý)</a></td><td><strong>${escapeHtml(building.name)}</strong></td><td><span class="type-badge">${building.listingType === 'whole-building' ? 'Nguyên căn' : 'Đa loại hình'}</span></td><td>Ngày 0</td><td><label class="table-toggle"><input type="checkbox" data-building-toggle="${index}" ${building.active !== false ? 'checked' : ''}><span></span></label></td><td title="${escapeHtml(address)}">${escapeHtml(address)}</td></tr>`;
    }).join('') : '<tr><td colspan="9" class="table-empty">Không có tòa nhà phù hợp.</td></tr>';
  };
  openModal('Danh mục dữ liệu  ›  Tòa nhà', `<div class="building-manager" data-building-manager>
    <div class="manager-stat-grid"><div class="manager-stat blue"><span>▦</span><strong>${buildings.length}</strong><small>Tất cả tòa nhà</small></div><div class="manager-stat green"><span>▦</span><strong>${buildings.filter((building) => building.active !== false).length}</strong><small>Đang hoạt động</small></div><div class="manager-stat red"><span>▦</span><strong>${buildings.filter((building) => building.active === false).length}</strong><small>Ngừng hoạt động</small></div></div>
    <div class="manager-toolbar"><input type="search" placeholder="⌕  Tìm kiếm" data-building-search><select data-building-status><option value="all">Trạng thái hoạt động</option><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option></select><select><option>Khu vực</option></select><button class="primary-button" type="button" data-manager-add>＋</button></div>
      <div class="table-scroll"><table class="building-table"><thead><tr><th><input type="checkbox"></th><th>Mã</th><th>Thao tác</th><th>Bất động sản cho thuê ↕</th><th>Tên tòa nhà ↕</th><th>Loại khai thác</th><th>Ngày TT ↕</th><th>Hoạt động</th><th>Địa chỉ ↕</th></tr></thead><tbody data-building-rows>${renderRows()}</tbody></table></div>
    <div class="manager-footer"><span>Số bản ghi</span><select><option>10</option><option>25</option><option>50</option></select><span data-building-result>${buildings.length ? `1 - ${buildings.length} trên tổng số ${buildings.length} bản ghi` : '0 trên tổng số 0 bản ghi'}</span></div>
  </div>`, () => {
    document.querySelector('[data-modal]').classList.add('modal-wide');
    const manager = document.querySelector('[data-building-manager]');
    const updateRows = () => { manager.querySelector('[data-building-rows]').innerHTML = renderRows(manager.querySelector('[data-building-search]').value, manager.querySelector('[data-building-status]').value); bindManagerActions(); };
      const bindManagerActions = () => {
      manager.querySelectorAll('[data-building-edit]').forEach((button) => button.addEventListener('click', () => openBuildingForm(buildings[Number(button.dataset.buildingEdit)])));
      manager.querySelectorAll('[data-building-delete]').forEach((button) => button.addEventListener('click', () => {
        const index = Number(button.dataset.buildingDelete);
        const building = buildings[index];
        const relatedCustomers = customers.filter((customer) => customer.building === building.name).length;
        const relatedBookings = bookings.filter((booking) => String(booking.apartment || '').startsWith(`${building.name} | `)).length;
        const relatedInvoices = invoices.filter((invoice) => invoice.building === building.name).length;
        const relatedDetails = `${(building.apartments || []).length} phòng, ${relatedCustomers} khách thuê, ${relatedBookings} booking và ${relatedInvoices} hóa đơn sẽ mất liên kết với tòa nhà`;
        if (!confirmPermanentDeletion(`tòa nhà "${building.name}"`, relatedDetails)) return;
        buildings.splice(index, 1);
        selectedBuildingIndex = Math.min(selectedBuildingIndex, Math.max(buildings.length - 1, 0));
        persistBuildings();
        openBuildingManager();
        showToast('Đã xóa tòa nhà');
      }));
      manager.querySelectorAll('[data-building-toggle]').forEach((toggle) => toggle.addEventListener('change', () => {
        buildings[Number(toggle.dataset.buildingToggle)].active = toggle.checked;
        persistBuildings();
        openBuildingManager();
      }));
      manager.querySelectorAll('[data-building-apartments]').forEach((link) => link.addEventListener('click', (event) => {
        event.preventDefault();
        selectBuilding(Number(link.dataset.buildingApartments));
        openApartmentManager();
      }));
    };
    manager.querySelector('[data-building-search]').addEventListener('input', updateRows);
    manager.querySelector('[data-building-status]').addEventListener('change', updateRows);
    manager.querySelector('[data-manager-add]').addEventListener('click', openBuildingForm);
    bindManagerActions();
  });
}

function openApartmentForm(apartmentIndex = -1) {
  if (!buildings[selectedBuildingIndex]) {
    openBuildingForm();
    return;
  }
  const building = buildings[selectedBuildingIndex];
  const apartment = apartmentIndex >= 0 ? building.apartments[apartmentIndex] : null;
  const floorOptions = getBuildingFloors(building).map((floor) => `<option value="${escapeHtml(floor)}" ${String(apartment?.floor ?? '') === floor ? 'selected' : ''}>Tầng ${escapeHtml(floor)}</option>`).join('');
  openModal(apartment ? 'Cập nhật không gian cho thuê' : 'Thêm không gian cho thuê', `<form class="building-form" data-apartment-form>
    <label>Mã căn hộ/văn phòng<input name="name" required maxlength="40" value="${escapeHtml(apartment?.name || '')}" placeholder="Ví dụ: A-101 hoặc VP-201"></label>
    <label>Tiêu đề hiển thị<input name="title" required maxlength="100" value="${escapeHtml(apartment?.title || apartment?.name || '')}" placeholder="Ví dụ: Căn studio hoặc văn phòng đầy đủ nội thất"></label>
    <label>Mô tả chi tiết<textarea name="description" maxlength="1000" rows="4" placeholder="Diện tích, nội thất, tiện ích, điều kiện thuê...">${escapeHtml(apartment?.description || '')}</textarea></label>
    <label>Tầng<select name="floor" required><option value="">Chọn tầng</option>${floorOptions}</select><small class="form-hint">Thiết lập danh sách tầng trong phần Tòa nhà.</small></label>
    <label>Chọn công tơ Smart Home<select name="meterId" data-meter-select><option value="${escapeHtml(apartment?.meterId || '')}">${apartment?.meterId ? escapeHtml(apartment.meterId) : 'Đang tải công tơ trống...'}</option></select><small class="form-hint" data-meter-select-status></small></label>
    <label>Chỉ số công tơ hiện tại (kWh)<input type="number" step="0.01" value="${apartment?.latestElectricityReading === undefined ? '' : Number(apartment.latestElectricityReading)}" data-current-meter-reading readonly placeholder="Chưa đồng bộ"><small class="form-hint">Lấy trực tiếp từ công tơ Tuya, không dùng làm số điện tiêu thụ.</small></label>
    <label>Chỉ số bàn giao điện (kWh)<input name="electricityBaseline" type="number" min="0" step="0.01" value="${Number(apartment?.electricityBaseline || 0)}"><small class="form-hint">Chốt khi khách bắt đầu thuê; tiền điện chỉ tính phần tăng sau mốc này.</small></label>
    <label>Tiền thuê hàng tháng<input name="rentAmount" type="number" min="0" value="${Number(apartment?.rentAmount || 0)}" placeholder="Số tiền nhà mỗi tháng"></label>
    <label>Giá điện riêng phòng/văn phòng (đ/kWh)<input name="electricityRate" type="number" min="0" value="${Number(apartment?.electricityRate || 0)}" placeholder="Để 0 để dùng giá theo tầng/tòa"></label>
    <label>Cách tính nước<select name="waterBillingMode"><option value="metered" ${apartment?.waterBillingMode !== 'fixed' ? 'selected' : ''}>Theo m³</option><option value="fixed" ${apartment?.waterBillingMode === 'fixed' ? 'selected' : ''}>Mức cố định</option></select></label>
    <label>Giá nước riêng (đ/m³)<input name="waterRate" type="number" min="0" value="${Number(apartment?.waterRate || 0)}" placeholder="Để 0 để dùng giá theo tầng/tòa"></label>
    <label>Tiền nước cố định (đ/tháng)<input name="waterFixedAmount" type="number" min="0" value="${Number(apartment?.waterFixedAmount || 0)}" placeholder="Áp dụng khi chọn mức cố định"></label>
    <label>Tên phí dịch vụ<input name="serviceFeeLabel" maxlength="80" value="${escapeHtml(apartment?.serviceFeeLabel || 'Phí dịch vụ')}" placeholder="Ví dụ: Internet, vệ sinh"></label>
    <label>Phí dịch vụ hàng tháng<input name="serviceFee" type="number" min="0" value="${Number(apartment?.serviceFee || 0)}"></label>
    <label>Hình ảnh và video<input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple><small class="form-hint">Tối đa 5 ảnh và 1 video. Tên file được tạo theo mã tòa và mã căn.</small></label>
    <label>Loại hình cho thuê<select name="propertyType">${Object.entries(propertyTypes).map(([value, label]) => `<option value="${value}" ${(apartment?.propertyType || 'apartment') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label data-bed-count-field>Số giường<input name="beds" type="number" min="0" value="${Number(apartment?.beds ?? 1)}"><small class="form-hint" data-bed-count-hint></small></label>
    <label>Trạng thái<select name="status"><option value="empty" ${apartment?.status === 'empty' ? 'selected' : ''}>Đang trống</option><option value="reserved" ${apartment?.status === 'reserved' ? 'selected' : ''}>Đang cọc</option><option value="rented" ${apartment?.status === 'rented' ? 'selected' : ''}>Đang thuê</option><option value="inactive" ${apartment?.status === 'inactive' ? 'selected' : ''}>Ngừng hoạt động</option></select></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">${apartment ? 'Cập nhật căn hộ' : 'Lưu căn hộ'}</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const formElement = document.querySelector('[data-apartment-form]');
    const propertyTypeField = formElement.elements.propertyType;
    const bedCountField = formElement.querySelector('[data-bed-count-field]');
    const updateBedCountField = () => {
      const propertyType = propertyTypeField.value;
      bedCountField.hidden = !bedDisplayPropertyTypes.has(propertyType);
      bedCountField.querySelector('[data-bed-count-hint]').textContent = propertyType === 'homestay' ? 'Chỉ mô tả sức chứa; Homestay vẫn cho thuê nguyên phòng.' : 'Số giường có thể cho từng khách thuê riêng.';
    };
    propertyTypeField.addEventListener('change', updateBedCountField);
    updateBedCountField();
    const meterSelect = formElement.querySelector('[data-meter-select]');
    const meterStatus = formElement.querySelector('[data-meter-select-status]');
    const currentMeterId = String(apartment?.meterId || '').trim();
    const assignedMeterIds = new Set(buildings.flatMap((building, buildingIndex) => (building.apartments || [])
      .filter((item, index) => buildingIndex !== selectedBuildingIndex || index !== apartmentIndex)
      .map((item) => String(item.meterId || '').trim())
    ).filter(Boolean));
    fetch(`${apiBaseUrl}/smart-home/meters`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể tải công tơ từ Tuya');
      const availableMeters = payload.meters.filter((meter) => !assignedMeterIds.has(meter.meterId) || meter.meterId === currentMeterId);
      meterSelect.innerHTML = `<option value="">Chưa gán công tơ</option>${availableMeters.map((meter) => `<option value="${escapeHtml(meter.meterId)}" ${meter.meterId === currentMeterId ? 'selected' : ''}>${escapeHtml(meter.name ? `${meter.name} - ${meter.meterId}` : meter.meterId)}</option>`).join('')}`;
      meterStatus.textContent = availableMeters.length ? `${availableMeters.length} công tơ chưa được gán.` : 'Không có công tơ trống trong Tuya Cloud.';
    }).catch((error) => {
      meterSelect.innerHTML = currentMeterId ? `<option value="${escapeHtml(currentMeterId)}">${escapeHtml(currentMeterId)}</option>` : '<option value="">Chưa gán công tơ</option>';
      meterStatus.textContent = error.message || 'Không thể tải công tơ từ Tuya.';
    });
    fetch(`${apiBaseUrl}/smart-home/current-readings`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể đọc chỉ số hiện tại');
      const reading = payload.readings.find((item) => item.meterId === currentMeterId);
      if (reading) formElement.querySelector('[data-current-meter-reading]').value = reading.current;
    }).catch(() => {});
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const mediaFiles = Array.from(form.getAll('media')).filter((file) => file?.size);
      const existingMedia = Array.isArray(apartment?.media) ? apartment.media : [];
      const imageCount = existingMedia.filter((item) => item.kind === 'image').length + mediaFiles.filter((file) => file.type.startsWith('image/')).length;
      const videoCount = existingMedia.filter((item) => item.kind === 'video').length + mediaFiles.filter((file) => file.type.startsWith('video/')).length;
      if (imageCount > 5 || videoCount > 1) { showToast('Mỗi tài sản chỉ được tối đa 5 ảnh và 1 video'); return; }
      if (mediaFiles.some((file) => file.size > (file.type.startsWith('video/') ? 20_000_000 : 5_000_000))) { showToast('Ảnh tối đa 5 MB, video tối đa 20 MB'); return; }
      const saveApartment = async () => {
        const uploadedMedia = [];
        for (const [index, file] of mediaFiles.entries()) {
          const media = await uploadPropertyMedia(file, buildings[selectedBuildingIndex], form.get('name').trim(), existingMedia.length + index + 1);
          uploadedMedia.push(media);
        }
        const media = [...existingMedia, ...uploadedMedia];
        const image = media.find((item) => item.kind === 'image')?.url || apartment?.image || '';
        const currentReadingValue = formElement.querySelector('[data-current-meter-reading]').value;
        const propertyType = form.get('propertyType');
        const nextApartment = { ...apartment, name: form.get('name').trim(), title: form.get('title').trim(), description: form.get('description').trim(), floor: Number(form.get('floor') || 0), meterId: form.get('meterId').trim(), electricityBaseline: Number(form.get('electricityBaseline') || 0), electricityBaselineAt: apartment?.electricityBaselineAt || new Date().toISOString(), latestElectricityReading: currentReadingValue === '' ? apartment?.latestElectricityReading : Number(currentReadingValue), latestElectricityReadingAt: currentReadingValue === '' ? apartment?.latestElectricityReadingAt : new Date().toISOString(), rentAmount: parseMoney(form.get('rentAmount')), electricityRate: parseMoney(form.get('electricityRate')), waterBillingMode: form.get('waterBillingMode'), waterRate: parseMoney(form.get('waterRate')), waterFixedAmount: parseMoney(form.get('waterFixedAmount')), serviceFeeLabel: form.get('serviceFeeLabel').trim(), serviceFee: parseMoney(form.get('serviceFee')), image, media, propertyType, beds: bedDisplayPropertyTypes.has(propertyType) ? Number(form.get('beds') || 0) : 0, status: form.get('status') };
        if (apartmentIndex >= 0) buildings[selectedBuildingIndex].apartments[apartmentIndex] = nextApartment;
        else buildings[selectedBuildingIndex].apartments.push(nextApartment);
        persistBuildings();
        closeModal();
        showToast(apartment ? 'Đã cập nhật không gian cho thuê' : 'Đã thêm không gian cho thuê');
      };
      try {
        await saveApartment();
      } catch (error) {
        showToast(error.message || 'Không thể lưu media');
      }
    });
  });
}

function formatDateKey(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function datesInRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return [];
  const dates = [];
  for (const cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
}

function openHomestayCalendar(apartmentIndex, month = new Date()) {
  const building = buildings[selectedBuildingIndex];
  const apartment = building?.apartments?.[apartmentIndex];
  if (!apartment || apartment.propertyType !== 'homestay') return;
  const currentMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const bookedDates = new Set((Array.isArray(apartment.bookedDates) ? apartment.bookedDates : []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
  const today = formatDateKey(new Date());
  const firstDay = currentMonth.getDay();
  const lastDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const dayCells = Array.from({ length: firstDay + lastDate }, (_, index) => {
    if (index < firstDay) return '<span class="homestay-calendar-blank"></span>';
    const date = formatDateKey(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), index - firstDay + 1));
    const isPast = date < today;
    return `<button type="button" class="homestay-calendar-day ${bookedDates.has(date) ? 'booked' : 'available'}" data-homestay-date="${date}" ${isPast ? 'disabled' : ''}>${index - firstDay + 1}</button>`;
  }).join('');
  openModal(`Lịch thuê - ${apartment.title || apartment.name}`, `<div class="homestay-calendar"><p class="entity-summary">Chọn khoảng ngày để đánh dấu đã thuê hoặc mở lại. Khoảng ngày bao gồm cả ngày bắt đầu và kết thúc.</p><div class="homestay-range-controls"><label>Từ ngày<input type="date" data-homestay-range-from min="${today}" value="${today}"></label><label>Đến ngày<input type="date" data-homestay-range-to min="${today}" value="${today}"></label><button class="primary-button" type="button" data-homestay-range-book>Đánh dấu đã thuê</button><button class="modal-secondary" type="button" data-homestay-range-open>Mở lại khoảng ngày</button></div><div class="homestay-calendar-toolbar"><button type="button" data-homestay-month="previous" aria-label="Tháng trước">‹</button><strong>${currentMonth.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}</strong><button type="button" data-homestay-month="next" aria-label="Tháng sau">›</button></div><div class="homestay-calendar-weekdays"><span>CN</span><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span></div><div class="homestay-calendar-grid">${dayCells}</div><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Đóng</button></div></div>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const rangeFrom = document.querySelector('[data-homestay-range-from]');
    const rangeTo = document.querySelector('[data-homestay-range-to]');
    rangeFrom.addEventListener('change', () => { rangeTo.min = rangeFrom.value; if (rangeTo.value < rangeFrom.value) rangeTo.value = rangeFrom.value; });
    const updateRange = (booked) => {
      const dates = datesInRange(rangeFrom.value, rangeTo.value);
      if (!dates.length) { showToast('Khoảng ngày không hợp lệ'); return; }
      dates.forEach((date) => booked ? bookedDates.add(date) : bookedDates.delete(date));
      apartment.bookedDates = [...bookedDates].sort();
      persistBuildings();
      openHomestayCalendar(apartmentIndex, new Date(`${rangeFrom.value}T00:00:00`));
      showToast(booked ? `Đã khóa ${dates.length} ngày thuê` : `Đã mở lại ${dates.length} ngày`);
    };
    document.querySelector('[data-homestay-range-book]').addEventListener('click', () => updateRange(true));
    document.querySelector('[data-homestay-range-open]').addEventListener('click', () => updateRange(false));
    document.querySelectorAll('[data-homestay-date]').forEach((button) => button.addEventListener('click', () => {
      const date = button.dataset.homestayDate;
      if (bookedDates.has(date)) bookedDates.delete(date); else bookedDates.add(date);
      apartment.bookedDates = [...bookedDates].sort();
      persistBuildings();
      openHomestayCalendar(apartmentIndex, currentMonth);
    }));
    document.querySelector('[data-homestay-month="previous"]').addEventListener('click', () => openHomestayCalendar(apartmentIndex, new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)));
    document.querySelector('[data-homestay-month="next"]').addEventListener('click', () => openHomestayCalendar(apartmentIndex, new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)));
  });
}

function openApartmentManager() {
  const building = buildings[selectedBuildingIndex];
  if (!building) {
    openBuildingForm();
    return;
  }
  const statusLabels = { empty: 'Đang trống', reserved: 'Đang cọc', rented: 'Đang thuê', inactive: 'Ngừng hoạt động' };
  const statusCounts = building.apartments.reduce((counts, apartment) => ({ ...counts, [apartment.status || 'empty']: (counts[apartment.status || 'empty'] || 0) + 1 }), {});
  const floorOrder = getBuildingFloors(building);
  const groupedApartments = building.apartments.reduce((groups, apartment, index) => {
    const floor = String(apartment.floor || '').trim() || 'unassigned';
    if (!groups.has(floor)) groups.set(floor, []);
    groups.get(floor).push({ apartment, index });
    return groups;
  }, new Map());
  const sortedFloorEntries = [...groupedApartments.entries()].sort(([left], [right]) => {
    if (left === 'unassigned') return 1;
    if (right === 'unassigned') return -1;
    const leftIndex = floorOrder.indexOf(left);
    const rightIndex = floorOrder.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
    return left.localeCompare(right, 'vi', { numeric: true });
  });
  const roomCard = ({ apartment, index }) => `<article class="apartment-room-card">
    ${apartment.image ? `<img src="${escapeHtml(apartment.image)}" alt="${escapeHtml(apartment.title || apartment.name)}">` : `<div class="apartment-room-placeholder" aria-hidden="true">${escapeHtml(String(apartment.name || '?').slice(0, 2).toUpperCase())}</div>`}
    <div class="apartment-record-content">
      <div class="apartment-room-heading"><strong>${escapeHtml(apartment.name)}</strong><span class="apartment-status apartment-status-${escapeHtml(apartment.status || 'empty')}">${statusLabels[apartment.status] || 'Đang trống'}</span></div>
      <span class="apartment-room-title">${escapeHtml(apartment.title || apartment.name)}</span>
      <div class="apartment-room-meta"><span>${propertyTypes[apartment.propertyType || 'apartment']}</span>${bedDisplayPropertyTypes.has(apartment.propertyType) ? `<span>${Number(apartment.beds || 0)} giường${apartment.propertyType === 'homestay' ? ' sức chứa' : ' cho thuê'}</span>` : ''}</div>
      ${apartment.description ? `<p>${escapeHtml(apartment.description)}</p>` : ''}
    </div>
    <div class="catalog-actions">${apartment.propertyType === 'homestay' ? `<button type="button" data-apartment-calendar="${index}">Lịch thuê</button>` : ''}<button type="button" data-apartment-edit="${index}">Sửa</button><button type="button" data-apartment-delete="${index}">Xóa</button></div>
  </article>`;
  const floorGroups = sortedFloorEntries.length
    ? sortedFloorEntries.map(([floor, apartments]) => `<section class="apartment-floor-group"><header><div><span class="apartment-floor-label">${floor === 'unassigned' ? 'Chưa xác định tầng' : `Tầng ${escapeHtml(floor)}`}</span><small>${apartments.length} không gian</small></div></header><div class="apartment-room-grid">${apartments.map(roomCard).join('')}</div></section>`).join('')
    : '<p class="empty-state">Tòa nhà này chưa có căn hộ hoặc văn phòng.</p>';
  const buildingSummary = `<div class="apartment-building-summary"><div><span>TÒA NHÀ</span><strong>${escapeHtml(building.name)}</strong><small>${escapeHtml(building.address || 'Chưa cập nhật địa chỉ')}</small></div><div class="apartment-summary-counts"><span><strong>${building.apartments.length}</strong>Tổng số</span><span class="is-empty"><strong>${statusCounts.empty || 0}</strong>Đang trống</span><span class="is-rented"><strong>${statusCounts.rented || 0}</strong>Đang thuê</span><span class="is-reserved"><strong>${statusCounts.reserved || 0}</strong>Đang cọc</span></div></div>`;
  openModal(`Không gian cho thuê · ${building.name}`, `${buildingSummary}<div class="apartment-floor-list">${floorGroups}</div><div class="apartment-manager-footer"><button class="modal-secondary" type="button" data-apartment-buildings-back>← Tất cả tòa nhà</button><button class="modal-secondary" type="button" data-modal-add-apartment>＋ Thêm không gian cho thuê</button></div>`, () => {
    document.querySelector('[data-modal]').classList.add('apartment-manager-modal');
    document.querySelector('[data-apartment-buildings-back]').addEventListener('click', openApartmentBuildingPicker);
    document.querySelector('[data-modal-add-apartment]').addEventListener('click', openApartmentForm);
    document.querySelectorAll('[data-apartment-calendar]').forEach((button) => button.addEventListener('click', () => openHomestayCalendar(Number(button.dataset.apartmentCalendar))));
    document.querySelectorAll('[data-apartment-edit]').forEach((button) => button.addEventListener('click', () => openApartmentForm(Number(button.dataset.apartmentEdit))));
    document.querySelectorAll('[data-apartment-delete]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.apartmentDelete);
      const apartment = building.apartments[index];
      const apartmentKey = `${building.name} | ${apartment.name}`;
      const relatedCustomers = customers.filter((customer) => customer.building === building.name && customer.apartment === apartment.name).length;
      const relatedBookings = bookings.filter((booking) => booking.apartment === apartmentKey).length;
      const relatedInvoices = invoices.filter((invoice) => invoice.building === building.name && invoice.apartment === apartment.name).length;
      const relatedDetails = `${relatedCustomers} khách thuê, ${relatedBookings} booking và ${relatedInvoices} hóa đơn sẽ mất liên kết với phòng`;
      if (!confirmPermanentDeletion(`phòng "${apartment.name}" tại ${building.name}`, relatedDetails)) return;
      building.apartments.splice(index, 1);
      persistBuildings();
      openApartmentManager();
    }));
  });
}

function openApartmentBuildingPicker() {
  const buildingCards = buildings.length
    ? buildings.map((building, index) => {
      const apartments = building.apartments || [];
      const emptyCount = apartments.filter((apartment) => (apartment.status || 'empty') === 'empty').length;
      const rentedCount = apartments.filter((apartment) => apartment.status === 'rented').length;
      const floorCount = new Set(apartments.map((apartment) => String(apartment.floor || '').trim()).filter(Boolean)).size || getBuildingFloors(building).length;
      return `<button class="apartment-building-card" type="button" data-apartment-building="${index}">
        <div class="apartment-building-card-heading"><span>${escapeHtml(building.code || `T${index + 1}`)}</span><em class="${building.active === false ? 'is-inactive' : ''}">${building.active === false ? 'Ngừng hoạt động' : 'Đang hoạt động'}</em></div>
        <strong>${escapeHtml(building.name)}</strong>
        <small>${escapeHtml(building.address || 'Chưa cập nhật địa chỉ')}</small>
        <div class="apartment-building-card-stats"><span><b>${apartments.length}</b>Không gian</span><span><b>${floorCount}</b>Tầng</span><span class="is-empty"><b>${emptyCount}</b>Đang trống</span><span class="is-rented"><b>${rentedCount}</b>Đang thuê</span></div>
        <span class="apartment-building-open">Xem tầng và phòng <b>→</b></span>
      </button>`;
    }).join('')
    : '<p class="empty-state">Chưa có tòa nhà nào trong hệ thống.</p>';
  openModal('Sơ đồ tòa nhà và phòng', `<div class="apartment-building-picker-intro"><div><span>DANH SÁCH TÒA NHÀ</span><strong>Chọn tòa nhà cần xem</strong><small>${buildings.length} tòa nhà trong hệ thống</small></div><button class="modal-secondary" type="button" data-apartment-add-building>＋ Thêm tòa nhà</button></div><div class="apartment-building-grid">${buildingCards}</div>`, () => {
    document.querySelector('[data-modal]').classList.add('apartment-building-picker-modal');
    document.querySelectorAll('[data-apartment-building]').forEach((card) => card.addEventListener('click', () => {
      selectBuilding(Number(card.dataset.apartmentBuilding));
      openApartmentManager();
    }));
    document.querySelector('[data-apartment-add-building]').addEventListener('click', openBuildingForm);
  });
}

function openBedManager() {
  const building = buildings[selectedBuildingIndex];
  if (!building) {
    openBuildingForm();
    return;
  }
  const bedSpaces = building.apartments.filter((apartment) => rentableBedPropertyTypes.has(apartment.propertyType));
  const totalBeds = bedSpaces.reduce((total, apartment) => total + Number(apartment.beds || 0), 0);
  const options = bedSpaces.length
    ? bedSpaces.map((apartment) => `<div class="modal-option"><span>${escapeHtml(apartment.name)}</span><small>${apartment.beds} giường cho thuê · ${apartment.status === 'rented' ? 'Đang thuê' : apartment.status === 'reserved' ? 'Đang cọc' : 'Đang trống'}</small></div>`).join('')
    : '<p class="empty-state">Chưa có phòng ở ghép.</p>';
  openModal(`Giường phòng ở ghép - ${building.name}`, `<p class="entity-summary">Tổng số giường cho thuê: <strong>${totalBeds}</strong></p><div class="modal-list">${options}</div><button class="modal-secondary" type="button" data-modal-add-apartment>＋ Thêm phòng ở ghép</button>`, () => {
    document.querySelector('[data-modal-add-apartment]').addEventListener('click', openApartmentForm);
  });
}

function openPropertyReport(type) {
  const building = buildings[selectedBuildingIndex];
  if (!building) {
    openBuildingForm();
    return;
  }
  const apartments = building.apartments || [];
  const status = type === 'empty' ? 'empty' : type === 'depositing' ? 'reserved' : null;
  const title = type === 'occupancy' ? `Tỷ lệ lấp đầy - ${building.name}` : type === 'empty' ? `Không gian đang trống - ${building.name}` : `Không gian đang đặt cọc - ${building.name}`;
  const filtered = status ? apartments.filter((apartment) => apartment.status === status) : apartments;
  const occupied = apartments.filter((apartment) => apartment.status === 'rented').length;
  const occupancy = apartments.length ? ((occupied / apartments.length) * 100).toFixed(2) : '0.00';
  const items = filtered.length
    ? filtered.map((apartment) => `<div class="modal-option"><span>${escapeHtml(apartment.name)}</span><small>${propertyTypes[apartment.propertyType || 'apartment']}${bedDisplayPropertyTypes.has(apartment.propertyType) ? ` · ${Number(apartment.beds || 0)} giường${apartment.propertyType === 'homestay' ? ' sức chứa' : ' cho thuê'}` : ''} · ${apartment.status === 'rented' ? 'Đang thuê' : apartment.status === 'reserved' ? 'Đang cọc' : 'Đang trống'}</small></div>`).join('')
    : '<p class="empty-state">Không có căn hộ phù hợp.</p>';
  openModal(title, `<div class="entity-summary">${type === 'occupancy' ? `Đang thuê: <strong>${occupied}/${apartments.length} căn (${occupancy}%)</strong>` : `Kết quả: <strong>${filtered.length} căn</strong>`}</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-apartment>＋ Thêm căn hộ</button>`, () => {
    document.querySelector('[data-modal-add-apartment]').addEventListener('click', openApartmentForm);
  });
}

function persistLeads() {
  persistCollection(leadStorageKey, leads);
}

function openLeadForm() {
  const apartmentOptions = (buildings[selectedBuildingIndex]?.apartments || []).map((apartment) => `<option value="${escapeHtml(apartment.name)}">${escapeHtml(apartment.name)}</option>`).join('');
  openModal('Thêm khách hẹn', `<form class="building-form" data-lead-form>
    <label>Họ và tên<input name="name" required maxlength="80" placeholder="Nhập họ tên khách hàng"></label>
    <label>Số điện thoại<input name="phone" required pattern="[0-9 +()-]{8,}" placeholder="09xx xxx xxx"></label>
    <label>Căn hộ quan tâm<select name="apartment"><option value="">Chưa xác định</option>${apartmentOptions}</select></label>
    <label>Trạng thái<select name="status"><option value="new">Khách hẹn mới</option><option value="contacted">Đã liên hệ</option><option value="success">Đã ký hợp đồng</option><option value="cancelled">Đã hủy</option></select></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu khách hẹn</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-lead-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      leads.push({ name: form.get('name').trim(), phone: form.get('phone').trim(), apartment: form.get('apartment'), status: form.get('status'), createdAt: new Date().toISOString() });
      persistLeads();
      updateDashboard();
      closeModal();
      showToast('Đã thêm khách hẹn mới');
    });
  });
}

function openLeadManager() {
  const statusLabels = { new: 'Khách hẹn mới', contacted: 'Đã liên hệ', success: 'Đã ký hợp đồng', cancelled: 'Đã hủy' };
  const items = leads.length
    ? leads.map((lead) => `<div class="modal-option"><span>${escapeHtml(lead.name)}</span><small>${escapeHtml(lead.phone)} · ${statusLabels[lead.status] || 'Khách hẹn mới'}${lead.apartment ? ` · ${escapeHtml(lead.apartment)}` : ''}</small></div>`).join('')
    : '<p class="empty-state">Chưa có khách hẹn nào.</p>';
  openModal('Khách hẹn', `<div class="entity-summary">Tổng khách hẹn: <strong>${leads.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-lead>＋ Thêm khách hẹn</button>`, () => {
    document.querySelector('[data-modal-add-lead]').addEventListener('click', openLeadForm);
  });
}

function persistCustomers() {
  persistCollection(customerStorageKey, customers);
}

function setApartmentStatus(apartmentName, status, buildingName = '', handoverReadings = null) {
  if (!apartmentName) return false;
  const apartment = buildings.find((building) => !buildingName || building.name === buildingName)?.apartments?.find((item) => item.name === apartmentName)
    || buildings.flatMap((building) => building.apartments || []).find((item) => item.name === apartmentName);
  if (!apartment) return false;
  if (status === 'rented' && apartment.status !== 'rented') {
    const electricityReading = Number(handoverReadings?.electricity ?? apartment.latestElectricityReading);
    const waterReading = Number(handoverReadings?.water ?? apartment.latestWaterReading);
    const handoverAt = new Date().toISOString();
    if (Number.isFinite(electricityReading)) apartment.electricityBaseline = electricityReading;
    if (Number.isFinite(waterReading)) apartment.waterBaseline = waterReading;
    apartment.electricityBaselineAt = handoverAt;
    apartment.waterBaselineAt = handoverAt;
  }
  apartment.status = status;
  persistBuildings();
  return true;
}

function apartmentReference(value) {
  const [building = '', apartment = ''] = String(value || '').split(' | ');
  return { building, apartment: apartment || building };
}

function synchronizeRentedApartments() {
  let changed = false;
  customers.filter((customer) => customer.status === 'renting' && customer.apartment).forEach((customer) => {
    const apartment = buildings.find((building) => !customer.building || building.name === customer.building)?.apartments?.find((item) => item.name === customer.apartment)
      || buildings.flatMap((building) => building.apartments || []).find((item) => item.name === customer.apartment);
    if (apartment && apartment.status !== 'rented') { apartment.status = 'rented'; changed = true; }
  });
  if (changed) persistBuildings(false);
}

function openCustomerForm(customerIndex = -1) {
  const customer = customerIndex >= 0 ? customers[customerIndex] : null;
  const apartmentOptions = buildings.flatMap((building) => (building.apartments || []).map((apartment) => `<option value="${escapeHtml(`${building.name} | ${apartment.name}`)}">${escapeHtml(building.name)} · ${escapeHtml(apartment.name)}</option>`)).join('');
  openModal(customer ? 'Cập nhật khách hàng' : 'Thêm khách hàng', `<form class="building-form" data-customer-form><div class="form-grid"><label><span class="field-label">Họ và tên <b>*</b></span><input name="name" required maxlength="80" value="${escapeHtml(customer?.name || '')}" placeholder="Nhập họ tên"></label><label>Email tài khoản<input name="email" type="email" maxlength="120" value="${escapeHtml(customer?.email || '')}" placeholder="Email đăng nhập người thuê"></label><label>Mã khách hàng<input name="code" maxlength="30" value="${escapeHtml(customer?.code || '')}" placeholder="Tự động nếu bỏ trống"></label><label><span class="field-label">Số điện thoại <b>*</b></span><input name="phone" required pattern="[0-9 +()-]{8,}" value="${escapeHtml(customer?.phone || '')}" placeholder="09xx xxx xxx"></label><label>Số CCCD/Hộ chiếu<input name="identity" maxlength="30" value="${escapeHtml(customer?.identity || '')}" placeholder="Có thể để trống"></label><label>Ảnh/PDF CCCD hoặc hộ chiếu<input name="identityFile" type="file" accept="image/*,.pdf"><small class="form-hint">Không bắt buộc. Tệp tối đa 700 KB${customer?.documentName ? `; hiện có: ${escapeHtml(customer.documentName)}` : ''}.</small></label><label>Ngày sinh<input name="birthDate" type="date" value="${escapeHtml(customer?.birthDate || '')}"></label><label>Loại khách<select name="type"><option value="personal" ${customer?.type === 'personal' ? 'selected' : ''}>Cá nhân</option><option value="business" ${customer?.type === 'business' ? 'selected' : ''}>Doanh nghiệp</option><option value="foreign" ${customer?.type === 'foreign' ? 'selected' : ''}>Khách nước ngoài</option></select></label><label>Căn hộ đang ở<select name="apartment"><option value="">Chưa xác định</option>${apartmentOptions}</select></label><label>Trạng thái<select name="status"><option value="renting" ${customer?.status === 'renting' ? 'selected' : ''}>Đang thuê</option><option value="moved" ${customer?.status === 'moved' ? 'selected' : ''}>Đã chuyển đi</option><option value="visitor" ${customer?.status === 'visitor' ? 'selected' : ''}>Khách vãng lai</option></select></label><label class="full-field">Địa chỉ<textarea name="address" placeholder="Địa chỉ liên hệ">${escapeHtml(customer?.address || '')}</textarea></label></div><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy bỏ</button><button class="primary-button" type="submit">${customer ? 'Cập nhật khách hàng' : 'Lưu khách hàng'}</button></div></form>`, () => {
    document.querySelector('[data-modal]').classList.add('customer-form-modal');
    modalCloseAction = openCustomerManager;
    const apartmentSelect = document.querySelector('[data-customer-form] [name="apartment"]');
    apartmentSelect.value = customer?.apartment ? `${customer.building || buildings.find((building) => (building.apartments || []).some((apartment) => apartment.name === customer.apartment))?.name || ''} | ${customer.apartment}` : '';
    document.querySelector('[data-customer-form] [name="status"]').closest('label').insertAdjacentHTML('afterend', '<label>Chỉ số điện bàn giao (kWh)<input name="initialElectricityReading" type="number" min="0" step="0.01" value="0"><small class="form-hint" data-electricity-handover-status>Chọn căn để lấy chỉ số Tuya hiện tại.</small></label><label>Chỉ số nước bàn giao (m³)<input name="initialWaterReading" type="number" min="0" step="0.01" value="0"><small class="form-hint">Nhập số đang hiển thị trên đồng hồ nước.</small></label>');
    const customerForm = document.querySelector('[data-customer-form]');
    let currentReadings = new Map();
    const updateHandoverReadings = () => {
      const reference = apartmentReference(apartmentSelect.value);
      const selected = buildings.find((building) => building.name === reference.building)?.apartments?.find((apartment) => apartment.name === reference.apartment);
      const liveReading = currentReadings.get(selected?.meterId);
      customerForm.elements.initialElectricityReading.value = liveReading?.current ?? selected?.electricityBaseline ?? selected?.latestElectricityReading ?? 0;
      customerForm.elements.initialWaterReading.value = selected?.waterBaseline ?? selected?.latestWaterReading ?? 0;
      customerForm.querySelector('[data-electricity-handover-status]').textContent = liveReading ? `Đã lấy từ Tuya lúc ${new Date(liveReading.timestamp).toLocaleTimeString('vi-VN')}.` : selected?.meterId ? 'Chưa lấy được chỉ số Tuya; có thể nhập thủ công.' : 'Căn chưa gán công tơ Tuya; nhập thủ công.';
    };
    apartmentSelect.addEventListener('change', updateHandoverReadings);
    fetch(`${apiBaseUrl}/smart-home/current-readings`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể đọc chỉ số Tuya');
      currentReadings = new Map(payload.readings.map((reading) => [reading.meterId, reading]));
      updateHandoverReadings();
    }).catch(() => updateHandoverReadings());
    updateHandoverReadings();
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-customer-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const selectedApartment = apartmentReference(form.get('apartment'));
      const previousApartment = customer ? { building: customer.building || '', apartment: customer.apartment || '', status: customer.status } : null;
      const identityFile = form.get('identityFile');
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      submitButton.disabled = true;
      let document = { documentName: customer?.documentName || '', documentUrl: customer?.documentUrl || '' };
      try {
        if (identityFile?.size) document = await uploadBookingDocument(identityFile);
      } catch (error) {
        submitButton.disabled = false;
        showToast(error.message);
        return;
      }
      const nextCustomer = { id: customer?.id || crypto.randomUUID(), ...customer, ...document, name: form.get('name').trim(), email: form.get('email').trim().toLowerCase(), code: form.get('code').trim() || customer?.code || `KH${String(customers.length + 1).padStart(6, '0')}`, phone: form.get('phone').trim(), identity: form.get('identity').trim(), birthDate: form.get('birthDate'), type: form.get('type'), building: selectedApartment.building, apartment: selectedApartment.apartment, status: form.get('status'), address: form.get('address').trim(), createdAt: customer?.createdAt || new Date().toISOString() };
      const startingTenancy = nextCustomer.status === 'renting' && nextCustomer.apartment && (!previousApartment || previousApartment.status !== 'renting' || previousApartment.building !== nextCustomer.building || previousApartment.apartment !== nextCustomer.apartment);
      const targetApartment = buildings.find((building) => building.name === nextCustomer.building)?.apartments?.find((item) => item.name === nextCustomer.apartment);
      const handoverReadings = { electricity: Number(form.get('initialElectricityReading') || 0), water: Number(form.get('initialWaterReading') || 0) };
      if (startingTenancy && targetApartment) {
        targetApartment.latestElectricityReading = handoverReadings.electricity;
        targetApartment.latestWaterReading = handoverReadings.water;
      }
      if (customerIndex >= 0) customers[customerIndex] = nextCustomer;
      else customers.push(nextCustomer);
      const changedApartment = previousApartment && (previousApartment.building !== nextCustomer.building || previousApartment.apartment !== nextCustomer.apartment);
      if (previousApartment?.apartment && previousApartment.status === 'renting' && (changedApartment || nextCustomer.status !== 'renting') && !customers.some((item) => item !== nextCustomer && item.status === 'renting' && item.apartment === previousApartment.apartment && (!previousApartment.building || item.building === previousApartment.building))) setApartmentStatus(previousApartment.apartment, 'empty', previousApartment.building);
      if (nextCustomer.status === 'renting' && nextCustomer.apartment) setApartmentStatus(nextCustomer.apartment, 'rented', nextCustomer.building, handoverReadings);
      persistCustomers();
      closeModal();
      showToast(customer ? 'Đã cập nhật khách hàng' : 'Đã thêm khách hàng');
    });
  });
}

function openCustomerDetails(customerIndex) {
  const customer = customers[customerIndex];
  if (!customer) return;
  const statusLabels = { renting: 'Đang thuê', moved: 'Đã chuyển đi', visitor: 'Khách vãng lai' };
  const typeLabels = { personal: 'Cá nhân', business: 'Doanh nghiệp', foreign: 'Khách nước ngoài' };
  const building = buildings.find((item) => item.name === customer.building) || buildings.find((item) => (item.apartments || []).some((apartment) => apartment.name === customer.apartment));
  const relatedInvoices = invoices.filter((invoice) => invoice.approvalStatus !== 'pending' && invoice.status !== 'paid' && (invoice.tenantEmail === customer.email || (invoice.apartment === customer.apartment && invoice.building === building?.name)));
  const outstanding = relatedInvoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const invoicesHtml = relatedInvoices.length ? relatedInvoices.map((invoice) => `<li>${escapeHtml(invoice.title)} · ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ${invoice.dueDate ? ` · hạn ${escapeHtml(invoice.dueDate)}` : ''}</li>`).join('') : '<li>Không có hóa đơn chưa thanh toán.</li>';
  openModal(`Hồ sơ khách hàng · ${customer.name}`, `<div class="entity-summary customer-detail-summary"><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.code || 'Chưa có mã')} · ${escapeHtml(statusLabels[customer.status] || 'Chưa xác định')}</span></div><div class="customer-detail-grid"><div><small>Số điện thoại</small><strong>${escapeHtml(customer.phone || 'Chưa cập nhật')}</strong></div><div><small>Email</small><strong>${escapeHtml(customer.email || 'Chưa cập nhật')}</strong></div><div><small>Loại khách</small><strong>${escapeHtml(typeLabels[customer.type] || 'Cá nhân')}</strong></div><div><small>Số CCCD/Hộ chiếu</small><strong>${escapeHtml(customer.identity || 'Không cung cấp')}</strong></div><div><small>Tệp CCCD/Hộ chiếu</small><strong>${customer.documentUrl ? `<a href="${escapeHtml(customer.documentUrl)}" target="_blank" rel="noopener">${escapeHtml(customer.documentName || 'Xem giấy tờ')}</a>` : 'Không cung cấp'}</strong></div><div><small>Tòa nhà</small><strong>${escapeHtml(building?.name || customer.building || 'Chưa xác định')}</strong></div><div><small>Căn hộ/Văn phòng</small><strong>${escapeHtml(customer.apartment || 'Chưa xác định')}</strong></div><div class="full"><small>Địa chỉ liên hệ</small><strong>${escapeHtml(customer.address || 'Chưa cập nhật')}</strong></div></div><div class="entity-summary customer-detail-balance"><span>Hóa đơn chưa thanh toán</span><strong>${outstanding.toLocaleString('vi-VN')} đ</strong></div><section class="customer-detail-section"><h3>Hóa đơn chưa thanh toán</h3><ul>${invoicesHtml}</ul></section><div class="form-actions"><button class="modal-secondary" type="button" data-customer-detail-close>Quay lại danh sách</button><button class="primary-button" type="button" data-customer-detail-edit>Sửa hồ sơ</button></div>`, () => {
    modalCloseAction = openCustomerManager;
    document.querySelector('[data-customer-detail-close]').addEventListener('click', closeModal);
    document.querySelector('[data-customer-detail-edit]').addEventListener('click', () => openCustomerForm(customerIndex));
  });
}

function openCustomerManager() {
  const renderRows = (query = '', status = 'renting') => {
    const filtered = customers.filter((customer) => customer.status === status && `${customer.name} ${customer.code} ${customer.identity} ${customer.apartment}`.toLowerCase().includes(query.toLowerCase()));
    return filtered.length ? filtered.map((customer) => `<tr><td><input type="checkbox"></td><td><strong class="building-code">${escapeHtml(customer.code)}</strong></td><td><div class="table-actions customer-table-actions"><button type="button" data-customer-view="${customers.indexOf(customer)}" aria-label="Xem thông tin khách">Xem</button><button type="button" data-customer-edit="${customers.indexOf(customer)}" aria-label="Sửa thông tin khách">Sửa</button><button type="button" class="danger-action" data-customer-delete="${customers.indexOf(customer)}" aria-label="Xóa khách" ${customer.status === 'renting' ? 'disabled title="Khách đang thuê không thể xóa"' : ''}>Xóa</button></div></td><td><button type="button" class="customer-name-link" data-customer-view="${customers.indexOf(customer)}">${escapeHtml(customer.name)}</button><small class="table-muted">${escapeHtml(customer.type === 'business' ? 'Doanh nghiệp' : customer.type === 'foreign' ? 'Khách nước ngoài' : 'Cá nhân')}</small></td><td>${escapeHtml(customer.apartment || 'Chưa xác định')}</td><td>${escapeHtml(customer.identity || 'Không cung cấp')}</td><td>${escapeHtml(customer.birthDate || 'Chưa cập nhật')}</td><td>${escapeHtml(customer.address || 'Chưa cập nhật')}</td></tr>`).join('') : '<tr><td colspan="8" class="table-empty">Không có dữ liệu nào để hiển thị</td></tr>';
  };
  const count = (status) => customers.filter((customer) => customer.status === status).length;
  openModal('Khách hàng', `<div class="customer-manager" data-customer-manager><div class="customer-tabs"><button class="active" data-customer-tab="renting">♙　Đang thuê</button><button data-customer-tab="moved">♙　Đã chuyển đi</button><button data-customer-tab="visitor">♙　Khách vãng lai</button></div><div class="manager-stat-grid customer-stat-grid"><div class="manager-stat blue"><span>♧</span><strong>${customers.length}</strong><small>Tất cả</small></div><div class="manager-stat green"><span>♙</span><strong>${customers.filter((customer) => customer.type === 'personal').length}</strong><small>Cá nhân</small></div><div class="manager-stat orange"><span>▣</span><strong>${customers.filter((customer) => customer.type === 'business').length}</strong><small>Doanh nghiệp</small></div><div class="manager-stat red"><span>◎</span><strong>${customers.filter((customer) => customer.type === 'foreign').length}</strong><small>Khách nước ngoài</small></div></div><div class="customer-toolbar"><select><option>Chọn khu vực</option></select><select><option>Chọn tòa nhà</option>${buildings.map((building) => `<option>${escapeHtml(building.name)}</option>`).join('')}</select><select disabled><option>Chọn phòng</option></select><select disabled><option>Chọn giường</option></select></div><div class="manager-toolbar"><input type="search" placeholder="⌕  Tìm kiếm" data-customer-search><button class="primary-button" type="button" data-customer-add>＋</button></div><div class="table-scroll"><table class="building-table customer-table"><thead><tr><th><input type="checkbox"></th><th>Mã KH</th><th>Thao tác</th><th>Khách hàng ↕</th><th>Căn hộ đang ở</th><th>CMND/CCCD/Hộ chiếu ↕</th><th>Ngày sinh ↕</th><th>Địa chỉ ↕</th></tr></thead><tbody data-customer-rows>${renderRows()}</tbody></table></div><div class="manager-footer"><span>Số bản ghi</span><select><option>10</option><option>25</option></select><span data-customer-result>${count('renting') ? `1 - ${count('renting')} trên tổng số ${count('renting')} bản ghi` : '1 - 0 trên tổng số 0 bản ghi'}</span></div><div class="faq"><h3>Câu hỏi thường gặp</h3><details><summary>Khách hàng có ứng dụng cư dân không?</summary><p>Khách thuê có thể sử dụng ứng dụng cư dân để xem hóa đơn và thông báo.</p></details><details><summary>Khách hàng sử dụng app cư dân có mất phí không?</summary><p>Chính sách phí phụ thuộc cấu hình của chủ nhà và tòa nhà.</p></details></div></div>`, () => {
    modalTitle.textContent = 'Hồ sơ khách thuê';
    document.querySelector('[data-modal]').classList.add('modal-wide');
    const manager = document.querySelector('[data-customer-manager]');
    let currentStatus = customerManagerStatus;
    const updateRows = () => { customerManagerStatus = currentStatus; manager.querySelectorAll('[data-customer-tab]').forEach((item) => item.classList.toggle('active', item.dataset.customerTab === currentStatus)); manager.querySelector('[data-customer-rows]').innerHTML = renderRows(manager.querySelector('[data-customer-search]').value, currentStatus); manager.querySelector('[data-customer-result]').textContent = `${customers.filter((customer) => customer.status === currentStatus).length} bản ghi`; bindActions(); };
    const bindActions = () => { manager.querySelectorAll('[data-customer-view]').forEach((button) => button.addEventListener('click', () => openCustomerDetails(Number(button.dataset.customerView)))); manager.querySelectorAll('[data-customer-edit]').forEach((button) => button.addEventListener('click', () => openCustomerForm(Number(button.dataset.customerEdit)))); manager.querySelectorAll('[data-customer-delete]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.customerDelete); const customer = customers[index]; if (customer.status === 'renting') { showToast('Khách đang thuê không thể xóa. Hãy chuyển trạng thái khách trước.'); return; } const relatedInvoices = invoices.filter((invoice) => invoice.tenantEmail === customer.email || (invoice.building === customer.building && invoice.apartment === customer.apartment)).length; const hasAccount = users.some((user) => user.customerId === customer.id || (customer.email && user.email === customer.email)); const relatedDetails = `${relatedInvoices} hóa đơn${hasAccount ? ' và 1 tài khoản đăng nhập' : ''} sẽ không còn gắn với hồ sơ này`; if (!confirmPermanentDeletion(`khách hàng "${customer.name}"`, relatedDetails)) return; customers.splice(index, 1); persistCustomers(); openCustomerManager(); showToast('Đã xóa khách hàng'); })); };
    manager.querySelectorAll('[data-customer-tab]').forEach((tab) => tab.addEventListener('click', () => { currentStatus = tab.dataset.customerTab; updateRows(); }));
    manager.querySelector('[data-customer-search]').addEventListener('input', updateRows);
    manager.querySelector('[data-customer-add]').addEventListener('click', openCustomerForm);
    updateRows();
  });
}

function openWorkflowForm() {
  const apartmentOptions = buildings.flatMap((building) => (building.apartments || []).map((apartment) => `<option value="${escapeHtml(`${building.name} | ${apartment.name}`)}">${escapeHtml(building.name)} · ${escapeHtml(apartment.name)}</option>`)).join('');
  const customerOptions = customers.map((customer) => `<option value="${escapeHtml(customer.id || '')}">${escapeHtml(customer.name)}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ''}</option>`).join('');
  openModal('Thêm đặt cọc', `<form class="building-form" data-workflow-form>
    <label>Hồ sơ khách hàng<select name="customerId"><option value="">Nhập khách chưa có hồ sơ</option>${customerOptions}</select></label>
    <label>Khách hàng<input name="name" required maxlength="80" placeholder="Họ và tên"></label>
    <label>Số điện thoại<input name="phone" required pattern="[0-9 +()-]{8,}" placeholder="09xx xxx xxx"></label>
    <label>Căn hộ<select name="apartment"><option value="">Chưa xác định</option>${apartmentOptions}</select></label>
    <label>Tiền đặt cọc<input name="amount" inputmode="numeric" value="0"></label>
    <label>Phương thức nhận cọc<select name="method"><option value="bank-transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu đặt cọc</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const formElement = document.querySelector('[data-workflow-form]');
    setupMoneyInputs(formElement);
    formElement.elements.customerId.addEventListener('change', () => {
      const customer = customers.find((item) => item.id === formElement.elements.customerId.value);
      if (!customer) return;
      formElement.elements.name.value = customer.name || '';
      formElement.elements.phone.value = customer.phone || '';
      if (customer.apartment) formElement.elements.apartment.value = `${customer.building || ''} | ${customer.apartment}`;
    });
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = formElement.querySelector('[type="submit"]');
      submitButton.disabled = true;
      const form = new FormData(formElement);
      const reference = apartmentReference(form.get('apartment'));
      const customer = customers.find((item) => item.id === form.get('customerId'));
      const reservation = { id: crypto.randomUUID(), customerId: customer?.id || '', tenantEmail: customer?.email || '', name: form.get('name').trim(), phone: form.get('phone').trim(), building: reference.building, apartment: reference.apartment, amount: parseMoney(form.get('amount')), paymentMethod: form.get('method'), status: 'held', createdAt: new Date().toISOString() };
      try {
        if (reservation.amount > 0) await postFinancialEvent({ sourceType: 'deposit-receipt', sourceId: reservation.id, title: `Thu tiền cọc - ${reservation.name}`, type: 'income', amount: reservation.amount, category: 'deposit', method: reservation.paymentMethod, building: reservation.building, apartment: reservation.apartment });
        reservations.push(reservation);
        persistCollection(reservationStorageKey, reservations);
        if (reservation.apartment) setApartmentStatus(reservation.apartment, 'reserved', reservation.building);
        updateDashboard();
        closeModal();
        showToast('Đã nhận cọc và đồng bộ Sổ thu chi');
      } catch (error) { submitButton.disabled = false; showToast(error.message); }
    });
  });
}

function openDepositDispositionForm(reservationIndex) {
  const reservation = reservations[reservationIndex];
  if (!reservation || !['active', 'held'].includes(reservation.status) || currentUserRole !== 'owner') return;
  const eligibleInvoices = invoices.filter((invoice) => invoice.approvalStatus === 'approved' && invoice.status !== 'paid' && (reservation.tenantEmail && invoice.tenantEmail === reservation.tenantEmail || invoice.building === reservation.building && invoice.apartment === reservation.apartment));
  openModal('Xử lý tiền cọc', `<form class="building-form" data-deposit-disposition-form><div class="entity-summary">${escapeHtml(reservation.name)} · <strong>${Number(reservation.amount || 0).toLocaleString('vi-VN')} đ</strong></div><label>Hình thức xử lý<select name="disposition"><option value="refunded">Hoàn lại khách</option><option value="applied" ${eligibleInvoices.length ? '' : 'disabled'}>Khấu trừ hóa đơn</option><option value="forfeited">Ghi nhận cọc giữ lại</option></select></label><label data-deposit-invoice hidden>Hóa đơn<select name="invoiceId">${eligibleInvoices.map((invoice) => `<option value="${escapeHtml(invoice.id)}">${escapeHtml(invoice.title)} · ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ</option>`).join('')}</select></label><label data-deposit-method>Phương thức hoàn<select name="method"><option value="bank-transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label><label>Ghi chú<textarea name="note" maxlength="300"></textarea></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Xác nhận xử lý</button></div></form>`, () => {
    const formElement = document.querySelector('[data-deposit-disposition-form]');
    const updateFields = () => {
      formElement.querySelector('[data-deposit-invoice]').hidden = formElement.elements.disposition.value !== 'applied';
      formElement.querySelector('[data-deposit-method]').hidden = formElement.elements.disposition.value !== 'refunded';
    };
    formElement.elements.disposition.addEventListener('change', updateFields);
    document.querySelector('[data-modal-cancel]').addEventListener('click', openWorkflowManager);
    updateFields();
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = formElement.querySelector('[type="submit"]');
      submitButton.disabled = true;
      const form = new FormData(formElement);
      try {
        const response = await fetch(`${apiBaseUrl}/deposits/${encodeURIComponent(reservation.id)}/dispose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disposition: form.get('disposition'), invoiceId: form.get('invoiceId'), method: form.get('method'), note: form.get('note').trim() }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Không thể xử lý tiền cọc');
        reservations[reservationIndex] = payload.reservation;
        localStorage.setItem(reservationStorageKey, JSON.stringify(reservations));
        mergeFinancialResponse(payload);
        openWorkflowManager();
        showToast('Đã xử lý tiền cọc và cập nhật tài chính');
      } catch (error) { submitButton.disabled = false; showToast(error.message); }
    });
  });
}

function openWorkflowManager() {
  let addedIds = false;
  reservations.forEach((record) => { if (!record.id) { record.id = crypto.randomUUID(); addedIds = true; } });
  if (addedIds) persistCollection(reservationStorageKey, reservations);
  const statusLabels = { active: 'Đang giữ', held: 'Đang giữ', completed: 'Đã kết thúc', refunded: 'Đã hoàn', forfeited: 'Đã giữ lại', applied: 'Đã khấu trừ' };
  const items = reservations.length
    ? reservations.map((record, index) => `<article class="modal-option"><div><span>${escapeHtml(record.name)}</span><small>${escapeHtml(record.phone || 'Chưa có SĐT')} · ${escapeHtml([record.building, record.apartment].filter(Boolean).join(' · ') || 'Chưa xác định')} · ${Number(record.amount).toLocaleString('vi-VN')} đ · ${statusLabels[record.status] || 'Đang giữ'}</small></div>${currentUserRole === 'owner' && ['active', 'held'].includes(record.status) ? `<div class="catalog-actions"><button type="button" data-deposit-dispose="${index}">Xử lý cọc</button></div>` : ''}</article>`).join('')
    : '<p class="empty-state">Chưa có đặt cọc nào.</p>';
  openModal('Đặt cọc thuê', `<div class="entity-summary">Tổng số: <strong>${reservations.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-workflow>＋ Thêm đặt cọc</button>`, () => {
    document.querySelector('[data-modal-add-workflow]').addEventListener('click', openWorkflowForm);
    document.querySelectorAll('[data-deposit-dispose]').forEach((button) => button.addEventListener('click', () => openDepositDispositionForm(Number(button.dataset.depositDispose))));
  });
}

function persistCollection(key, records) {
  localStorage.setItem(key, JSON.stringify(records));
  queueServerSync(key);
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : 'Chưa xác định';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', reject);
    reader.readAsDataURL(file);
  });
}

async function uploadPropertyMedia(file, building, assetCode, index) {
  const response = await fetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ buildingCode: building.code || building.name, assetCode, index, dataUrl: await fileToDataUrl(file) })
  });
  const payload = await response.json();
  if (!response.ok || !payload.media) throw new Error(payload.error || 'Không thể tải media lên máy chủ');
  return payload.media;
}

async function uploadBookingDocument(file) {
  if (!file?.size) return { documentName: '', documentUrl: '' };
  if (file.size > 700_000) throw new Error('Tệp CCCD/Hộ chiếu cần nhỏ hơn 700 KB');
  const response = await fetch('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, dataUrl: await fileToDataUrl(file) }) });
  if (!response.ok) throw new Error('Không thể tải tệp giấy tờ lên máy chủ');
  const payload = await response.json();
  return { documentName: payload.fileName, documentUrl: payload.url };
}

function bookingDateRange(checkIn, checkOut) {
  const from = String(checkIn || '').slice(0, 10);
  const to = String(checkOut || '').slice(0, 10);
  return datesInRange(from, to);
}

function hasBookingConflict(candidate, ignoredBookingId = '') {
  const candidateDates = new Set(bookingDateRange(candidate.checkIn, candidate.checkOut));
  return bookings.some((booking) => booking.id !== ignoredBookingId && booking.status !== 'checkedOut' && booking.apartment === candidate.apartment && bookingDateRange(booking.checkIn, booking.checkOut).some((date) => candidateDates.has(date)));
}

function synchronizeBooking(booking, previousBooking = null) {
  const [buildingName = '', apartmentName = ''] = String(booking.apartment || '').split(' | ');
  const previousDates = new Set(previousBooking?.syncedDates || []);
  const nextDates = booking.status === 'checkedOut' ? [] : bookingDateRange(booking.checkIn, booking.checkOut);
  const previousApartment = previousBooking ? buildings.find((building) => building.name === String(previousBooking.apartment || '').split(' | ')[0])?.apartments?.find((apartment) => apartment.name === String(previousBooking.apartment || '').split(' | ')[1]) : null;
  if (previousApartment) {
    const datesUsedElsewhere = new Set(bookings.filter((item) => item.id !== booking.id && item.status !== 'checkedOut').flatMap((item) => item.syncedDates || []));
    previousApartment.bookedDates = (previousApartment.bookedDates || []).filter((date) => !previousDates.has(date) || datesUsedElsewhere.has(date));
    if (previousBooking.apartment !== booking.apartment && previousApartment.propertyType !== 'homestay' && !bookings.some((item) => item.id !== booking.id && item.apartment === previousBooking.apartment && item.status !== 'checkedOut')) previousApartment.status = 'empty';
  }
  const apartment = buildings.find((building) => building.name === buildingName)?.apartments?.find((item) => item.name === apartmentName);
  if (apartment) {
    if (apartment.propertyType === 'homestay') apartment.bookedDates = [...new Set([...(apartment.bookedDates || []), ...nextDates])].sort();
    else apartment.status = booking.status === 'checkedIn' ? 'rented' : booking.status === 'checkedOut' ? 'empty' : 'reserved';
  }
  booking.syncedDates = nextDates;
  const customerIndex = customers.findIndex((customer) => customer.sourceBookingId === booking.id);
  const customer = { ...(customers[customerIndex] || {}), id: customers[customerIndex]?.id || crypto.randomUUID(), sourceBookingId: booking.id, name: booking.name, phone: booking.phone, building: buildingName, apartment: apartmentName, status: 'visitor', type: 'personal', createdAt: customers[customerIndex]?.createdAt || booking.createdAt };
  if (customerIndex >= 0) customers[customerIndex] = customer; else customers.push(customer);
  const reservationIndex = reservations.findIndex((reservation) => reservation.sourceBookingId === booking.id);
  const reservation = { ...(reservations[reservationIndex] || {}), id: reservations[reservationIndex]?.id || crypto.randomUUID(), sourceBookingId: booking.id, name: booking.name, phone: booking.phone, building: buildingName, apartment: apartmentName, amount: booking.deposit, paymentMethod: booking.depositMethod || 'cash', status: booking.status === 'checkedOut' ? 'applied' : 'held', createdAt: reservations[reservationIndex]?.createdAt || booking.createdAt };
  if (booking.deposit > 0 && reservationIndex >= 0) reservations[reservationIndex] = reservation;
  else if (booking.deposit > 0) reservations.push(reservation);
  else if (reservationIndex >= 0) reservations.splice(reservationIndex, 1);
  if (booking.deposit > 0) {
    const event = booking.status === 'checkedOut'
      ? { sourceType: 'deposit-apply', sourceId: reservation.id, title: `Khấu trừ cọc booking - ${booking.name}`, type: 'income', amount: booking.deposit, category: 'deposit', method: 'other', building: buildingName, apartment: apartmentName }
      : { sourceType: 'deposit-receipt', sourceId: reservation.id, title: `Thu cọc booking - ${booking.name}`, type: 'income', amount: booking.deposit, category: 'deposit', method: reservation.paymentMethod, building: buildingName, apartment: apartmentName };
    postFinancialEvent(event).catch((error) => showToast(error.message));
  }
  const invoiceIndex = invoices.findIndex((invoice) => invoice.sourceBookingId === booking.id);
  const totalCharge = Number(booking.amount || 0) + Number(booking.serviceFee || 0);
  const balance = Math.max(totalCharge - Number(booking.deposit || 0), 0);
  const invoice = { ...(invoices[invoiceIndex] || {}), id: invoices[invoiceIndex]?.id || crypto.randomUUID(), sourceBookingId: booking.id, paymentCode: invoices[invoiceIndex]?.paymentCode || `NVP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, building: buildingName, apartment: apartmentName, tenantName: booking.name, title: `Chốt trả phòng - ${booking.name}`, type: 'booking', roomAmount: Number(booking.amount || 0), serviceFee: Number(booking.serviceFee || 0), deposit: Number(booking.deposit || 0), amount: balance, dueDate: String(booking.checkedOutAt || booking.checkOut || '').slice(0, 10), approvalStatus: invoices[invoiceIndex]?.approvalStatus || 'pending', status: invoices[invoiceIndex]?.status || 'unpaid', createdAt: invoices[invoiceIndex]?.createdAt || booking.checkedOutAt || booking.createdAt };
  if (booking.status === 'checkedOut' && balance > 0 && invoiceIndex >= 0) invoices[invoiceIndex] = invoice;
  else if (booking.status === 'checkedOut' && balance > 0) invoices.push(invoice);
  else if (invoiceIndex >= 0) invoices.splice(invoiceIndex, 1);
  booking.relatedDataSyncedAt = new Date().toISOString();
  persistCollection(storageKey, buildings);
  persistCollection(customerStorageKey, customers);
  persistCollection(reservationStorageKey, reservations);
  persistCollection(invoiceStorageKey, invoices);
  updateDashboard();
}

function reconcileBookingInvoices() {
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  let changed = false;
  for (let index = invoices.length - 1; index >= 0; index -= 1) {
    const invoice = invoices[index];
    if (!invoice.sourceBookingId) continue;
    const booking = bookingById.get(invoice.sourceBookingId);
    if (!booking || booking.status !== 'checkedOut') {
      invoices.splice(index, 1);
      changed = true;
    }
  }
  if (changed) persistCollection(invoiceStorageKey, invoices);
}

function openBookingForm(bookingIndex = -1) {
  const booking = bookingIndex >= 0 ? bookings[bookingIndex] : null;
  const apartmentOptions = buildings.flatMap((building) => (building.apartments || []).filter((apartment) => apartment.status === 'empty' || apartment.status === 'reserved' || `${building.name} | ${apartment.name}` === booking?.apartment).map((apartment) => `<option value="${escapeHtml(building.name)} | ${escapeHtml(apartment.name)}" ${`${building.name} | ${apartment.name}` === booking?.apartment ? 'selected' : ''}>${escapeHtml(building.name)} - ${escapeHtml(apartment.name)}</option>`)).join('');
  const now = new Date();
  const checkIn = booking?.checkIn || new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);
  const checkOut = booking?.checkOut || new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().slice(0, 16);
  openModal(booking ? 'Sửa booking' : 'Tạo booking', `<form class="building-form" data-booking-form>
    <label>Khách lưu trú<input name="name" required maxlength="80" value="${escapeHtml(booking?.name || '')}" placeholder="Họ và tên khách"></label>
    <label>Số điện thoại<input name="phone" required pattern="[0-9 +()-]{8,}" value="${escapeHtml(booking?.phone || '')}" placeholder="09xx xxx xxx"></label>
    <label>Căn hộ/Homestay<select name="apartment" required><option value="">Chọn căn hộ hoặc Homestay</option>${apartmentOptions}</select></label>
    <label>Nhận phòng<input name="checkIn" type="datetime-local" required value="${checkIn}"></label>
    <label>Trả phòng<input name="checkOut" type="datetime-local" required value="${checkOut}"></label>
    <label>Tiền phòng<input name="amount" type="number" min="0" required value="${Number(booking?.amount || 0)}"></label>
    <label>Đã đặt cọc<input name="deposit" type="number" min="0" required value="${Number(booking?.deposit || 0)}"></label>
    <label>Phương thức nhận cọc<select name="depositMethod"><option value="bank-transfer" ${booking?.depositMethod === 'bank-transfer' ? 'selected' : ''}>Chuyển khoản</option><option value="cash" ${!booking?.depositMethod || booking?.depositMethod === 'cash' ? 'selected' : ''}>Tiền mặt</option><option value="other" ${booking?.depositMethod === 'other' ? 'selected' : ''}>Khác</option></select></label>
    <label>Số CCCD/Hộ chiếu<input name="identity" maxlength="30" value="${escapeHtml(booking?.identity || '')}" placeholder="Có thể để trống"></label>
    <label>Ảnh/PDF CCCD hoặc hộ chiếu<input name="identityFile" type="file" accept="image/*,.pdf"><small class="form-hint">Không bắt buộc. Tệp tối đa 700 KB${booking?.documentName ? `; hiện có: ${escapeHtml(booking.documentName)}` : ''}.</small></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">${booking ? 'Cập nhật booking' : 'Tạo booking'}</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-booking-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const documentFile = form.get('identityFile');
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = 'Đang lưu...';
      let document = { documentName: booking?.documentName || '', documentUrl: booking?.documentUrl || '' };
      try {
        if (documentFile?.size) document = await uploadBookingDocument(documentFile);
      } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = booking ? 'Cập nhật booking' : 'Tạo booking';
        showToast(error.message);
        return;
      }
      const previousBooking = booking ? { ...booking, syncedDates: [...(booking.syncedDates || [])] } : null;
      const nextBooking = { ...booking, id: booking?.id || crypto.randomUUID(), name: form.get('name').trim(), phone: form.get('phone').trim(), identity: form.get('identity').trim(), apartment: form.get('apartment'), checkIn: form.get('checkIn'), checkOut: form.get('checkOut'), amount: parseMoney(form.get('amount')), deposit: parseMoney(form.get('deposit')), depositMethod: form.get('depositMethod'), ...document, status: booking?.status || 'booked', createdAt: booking?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (new Date(nextBooking.checkOut) <= new Date(nextBooking.checkIn)) { submitButton.disabled = false; submitButton.textContent = booking ? 'Cập nhật booking' : 'Tạo booking'; showToast('Thời gian trả phòng phải sau thời gian nhận phòng'); return; }
      if (bookingIndex >= 0) bookings[bookingIndex] = nextBooking; else bookings.push(nextBooking);
      synchronizeBooking(nextBooking, previousBooking);
      persistCollection(bookingStorageKey, bookings);
      closeModal();
      showToast(booking ? 'Đã cập nhật booking và dữ liệu liên quan' : 'Đã tạo booking và đồng bộ dữ liệu liên quan');
    });
  });
}

function openBookingCheckout(bookingIndex) {
  const booking = bookings[bookingIndex];
  if (!booking || booking.status !== 'checkedIn') return;
  openModal(`Chốt trả phòng · ${booking.name}`, `<form class="building-form" data-booking-checkout-form>
    <p class="entity-summary">Doanh thu chỉ được ghi nhận sau khi xác nhận trả phòng.</p>
    <label>Tiền phòng<input name="amount" value="${Number(booking.amount || 0)}" readonly></label>
    <label>Tiền cọc đã nhận<input name="deposit" value="${Number(booking.deposit || 0)}" readonly></label>
    <label>Phí dịch vụ phát sinh<input name="serviceFee" inputmode="numeric" value="${Number(booking.serviceFee || 0)}" placeholder="Ví dụ: minibar, giặt ủi, phụ thu..."></label>
    <label>Nội dung phí dịch vụ<textarea name="serviceNote" maxlength="300" rows="3" placeholder="Để trống nếu không phát sinh">${escapeHtml(booking.serviceNote || '')}</textarea></label>
    <div class="booking-checkout-summary" data-booking-checkout-total></div>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Quay lại</button><button class="primary-button" type="submit">Xác nhận trả phòng</button></div>
  </form>`, () => {
    const formElement = document.querySelector('[data-booking-checkout-form]');
    const totalElement = formElement.querySelector('[data-booking-checkout-total]');
    const updateTotal = () => {
      const roomAmount = parseMoney(formElement.elements.amount.value);
      const deposit = parseMoney(formElement.elements.deposit.value);
      const serviceFee = parseMoney(formElement.elements.serviceFee.value);
      const total = roomAmount + serviceFee;
      const remaining = Math.max(total - deposit, 0);
      totalElement.innerHTML = `<span><small>Tổng doanh thu</small><strong>${total.toLocaleString('vi-VN')} đ</strong></span><span><small>Đã nhận cọc</small><strong>${deposit.toLocaleString('vi-VN')} đ</strong></span><span><small>Còn phải thu</small><strong>${remaining.toLocaleString('vi-VN')} đ</strong></span>`;
    };
    document.querySelector('[data-modal-cancel]').addEventListener('click', openBookingManager);
    formElement.elements.serviceFee.addEventListener('input', updateTotal);
    updateTotal();
    formElement.addEventListener('submit', (event) => {
      event.preventDefault();
      const previousBooking = { ...booking, syncedDates: [...(booking.syncedDates || [])] };
      booking.serviceFee = parseMoney(new FormData(formElement).get('serviceFee'));
      booking.serviceNote = formElement.elements.serviceNote.value.trim();
      booking.status = 'checkedOut';
      booking.checkedOutAt = new Date().toISOString();
      booking.updatedAt = booking.checkedOutAt;
      synchronizeBooking(booking, previousBooking);
      persistCollection(bookingStorageKey, bookings);
      openBookingManager();
      showToast(`Đã trả phòng và ghi nhận ${(Number(booking.amount || 0) + booking.serviceFee).toLocaleString('vi-VN')} đ doanh thu`);
    });
  });
}

function openBookingManager() {
  reconcileBookingInvoices();
  const unsynchronizedBookings = bookings.filter((booking) => !booking.relatedDataSyncedAt);
  if (unsynchronizedBookings.length) {
    unsynchronizedBookings.forEach((booking) => synchronizeBooking(booking));
    persistCollection(bookingStorageKey, bookings);
  }
  const labels = { booked: 'Đã đặt', checkedIn: 'Đang ở', checkedOut: 'Đã trả phòng' };
  const items = bookings.length ? bookings.map((booking, index) => `<article class="modal-option"><div><span>${escapeHtml(booking.name)} <small>(${labels[booking.status]})</small></span><small>${escapeHtml(booking.apartment)} · ${formatDateTime(booking.checkIn)} - ${formatDateTime(booking.checkOut)}${booking.serviceFee ? ` · Phí dịch vụ ${Number(booking.serviceFee).toLocaleString('vi-VN')} đ` : ''}${booking.identity ? ` · CCCD/Hộ chiếu: ${escapeHtml(booking.identity)}` : ''}${booking.documentName ? ` · <a href="${escapeHtml(booking.documentUrl)}" target="_blank" rel="noopener">${escapeHtml(booking.documentName)}</a>` : ''}</small></div><div class="catalog-actions"><button type="button" data-booking-edit="${index}">Sửa</button>${booking.status !== 'checkedOut' ? `<button type="button" data-booking-status="${index}">${booking.status === 'booked' ? 'Nhận phòng' : 'Trả phòng'}</button>` : ''}</div></article>`).join('') : '<p class="empty-state">Chưa có booking nào.</p>';
  openModal('Đặt phòng ngắn hạn', `<div class="entity-summary">Lịch đặt phòng và lưu trú ngắn hạn</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-booking>＋ Tạo booking</button>`, () => {
    document.querySelector('[data-modal-add-booking]').addEventListener('click', openBookingForm);
    document.querySelectorAll('[data-booking-edit]').forEach((button) => button.addEventListener('click', () => openBookingForm(Number(button.dataset.bookingEdit))));
    document.querySelectorAll('[data-booking-status]').forEach((button) => button.addEventListener('click', () => {
      const booking = bookings[Number(button.dataset.bookingStatus)];
      if (booking.status === 'booked') booking.status = 'checkedIn';
      else if (booking.status === 'checkedIn') { openBookingCheckout(Number(button.dataset.bookingStatus)); return; }
      else return;
      synchronizeBooking(booking, booking);
      persistCollection(bookingStorageKey, bookings);
      openBookingManager();
      showToast(`Đã cập nhật trạng thái ${booking.name}`);
    }));
  });
}

function findPreviousMeterLog(apartment, service, readingDate) {
  const cutoff = readingDate ? new Date(`${readingDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
  return meterLogs
    .filter((item) => item.apartment === apartment && item.service === service && new Date(`${item.readingDate || item.createdAt || '1970-01-01'}`).getTime() <= cutoff)
    .sort((first, second) => new Date(first.readingDate || first.createdAt || 0) - new Date(second.readingDate || second.createdAt || 0))
    .at(-1);
}

function openMeterForm() {
  const buildingSettings = buildings[selectedBuildingIndex]?.settings || {};
  const electricityRate = Number(buildingSettings.electricityRate || 0);
  const apartmentOptions = buildings.flatMap((building) => (building.apartments || []).map((apartment) => {
    const floorRate = Number((building.settings?.waterFloorRates || {})[apartment.floor] || 0);
    const electricityFloorRate = Number((building.settings?.electricityFloorRates || {})[apartment.floor] || 0);
    const electricityRateForApartment = Number(apartment.electricityRate || electricityFloorRate || building.settings?.electricityRate || electricityRate);
    const fixedAmount = Number(apartment.waterFixedAmount || floorRate || building.settings?.waterFixedAmount || 0);
    return `<option value="${escapeHtml(building.name)} | ${escapeHtml(apartment.name)}" data-building-index="${buildings.indexOf(building)}" data-meter-id="${escapeHtml(apartment.meterId || '')}" data-electricity-rate="${electricityRateForApartment}" data-electricity-baseline="${Number(apartment.electricityBaseline || 0)}" data-water-baseline="${Number(apartment.waterBaseline || 0)}" data-water-mode="${escapeHtml(apartment.waterFixedAmount || floorRate || building.settings?.waterFixedAmount ? 'fixed' : (building.settings?.waterBillingMode || 'metered'))}" data-water-fixed="${fixedAmount}" data-water-floor="${Number(apartment.floor || 0)}">${escapeHtml(building.name)} - ${escapeHtml(apartment.name)}${apartment.floor ? ` · Tầng ${apartment.floor}` : ''}</option>`;
  })).join('');
  const today = new Date().toISOString().slice(0, 10);
  openModal('Ghi chỉ số', `<form class="building-form" data-meter-form>
    <label>Căn hộ<select name="apartment" required><option value="">Chọn căn hộ</option>${apartmentOptions}</select></label>
    <label>Ngày chốt<input name="readingDate" type="date" required value="${today}"><small class="form-hint">Có thể chọn ngày bất kỳ để chốt tiền trước hạn.</small></label>
    <section class="form-section"><div class="form-section-title"><strong>Chỉ số điện</strong></div><div class="form-grid">
      <label>Chỉ số điện cũ (kWh)<input name="electricityPrevious" type="number" min="0" step="0.01" required value="0"></label>
      <label>Chỉ số điện mới (kWh)<input name="electricityCurrent" type="number" min="0" step="0.01" required value="0"></label>
      <label>Đơn giá điện (đ/kWh)<input name="electricityRate" type="number" min="0" required value="${electricityRate}"></label>
    </div></section>
    <section class="form-section"><div class="form-section-title"><strong>Chỉ số nước</strong></div><div class="form-grid">
      <label>Cách tính nước<select name="waterMode" data-water-mode-select><option value="metered">Theo m³</option><option value="fixed">Mức cố định</option></select></label>
      <label>Chỉ số nước cũ (m³)<input name="waterPrevious" type="number" min="0" step="0.01" required value="0"></label>
      <label>Chỉ số nước mới (m³)<input name="waterCurrent" type="number" min="0" step="0.01" required value="0"></label>
      <label>Đơn giá / mức thu nước<input name="waterRate" type="number" min="0" required value="0"><small class="form-hint" data-water-rate-hint></small></label>
    </div></section>
    <p class="form-hint" data-smart-home-status></p><div class="form-actions"><button class="modal-secondary" type="button" data-smart-home-sync>↻ Lấy chỉ số Smart Home</button><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu và tạo hóa đơn</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const form = document.querySelector('[data-meter-form]');
    const updateDefaults = () => {
      const selectedApartment = form.querySelector('[name="apartment"] option:checked');
      const selectedBuilding = buildings[Number(selectedApartment?.dataset.buildingIndex)] || buildings[selectedBuildingIndex];
      const selectedSettings = selectedBuilding?.settings || buildingSettings;
      const apartmentKey = selectedApartment?.value || '';
      const readingDate = form.elements.readingDate.value;
      const electricityLog = findPreviousMeterLog(apartmentKey, 'electricity', readingDate);
      const waterLog = findPreviousMeterLog(apartmentKey, 'water', readingDate);
      const waterMode = selectedApartment?.dataset.waterMode || selectedSettings.waterBillingMode || 'metered';
      const waterRate = waterMode === 'fixed' ? Number(selectedApartment?.dataset.waterFixed || selectedSettings.waterFixedAmount || 0) : Number(selectedSettings.waterRate || 0);
      form.elements.electricityPrevious.value = electricityLog?.current ?? selectedApartment?.dataset.electricityBaseline ?? 0;
      form.elements.waterPrevious.value = waterLog?.current ?? selectedApartment?.dataset.waterBaseline ?? 0;
      form.elements.electricityRate.value = Number(selectedApartment?.dataset.electricityRate || selectedSettings.electricityRate || electricityRate);
      form.elements.waterMode.value = waterMode;
      form.elements.waterRate.value = waterRate;
      form.elements.waterCurrent.disabled = waterMode === 'fixed';
      form.elements.waterPrevious.disabled = waterMode === 'fixed';
      if (waterMode === 'fixed') form.elements.waterCurrent.value = form.elements.waterPrevious.value;
      form.querySelector('[data-water-rate-hint]').textContent = waterMode === 'fixed' ? 'Mức thu cố định, không tính theo chỉ số.' : 'Số tiền = m³ tiêu thụ × đơn giá.';
    };
    form.elements.apartment.addEventListener('change', updateDefaults);
    form.elements.readingDate.addEventListener('change', updateDefaults);
    form.elements.waterMode.addEventListener('change', () => {
      const fixed = form.elements.waterMode.value === 'fixed';
      form.elements.waterCurrent.disabled = fixed;
      form.elements.waterPrevious.disabled = fixed;
      if (fixed) form.elements.waterCurrent.value = form.elements.waterPrevious.value;
      form.querySelector('[data-water-rate-hint]').textContent = fixed ? 'Mức thu cố định, không tính theo chỉ số.' : 'Số tiền = m³ tiêu thụ × đơn giá.';
    });
    updateDefaults();
    document.querySelector('[data-smart-home-sync]').addEventListener('click', async () => {
      const option = form.querySelector('[name="apartment"] option:checked');
      const meterId = option?.dataset.meterId;
      const status = form.querySelector('[data-smart-home-status]');
      if (!meterId) { status.textContent = 'Phòng chưa có mã công tơ Smart Home.'; return; }
      status.textContent = 'Đang lấy chỉ số...';
      try {
        const response = await fetch('/api/smart-home/current-readings');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Không thể lấy chỉ số');
        const reading = (payload.readings || []).find((item) => item.meterId === meterId);
        if (!reading) throw new Error(`Không tìm thấy công tơ ${meterId}`);
        const previousLog = findPreviousMeterLog(form.elements.apartment.value, 'electricity', form.elements.readingDate.value);
        form.elements.electricityPrevious.value = previousLog?.current ?? option?.dataset.electricityBaseline ?? 0;
        form.elements.electricityCurrent.value = reading.current;
        status.textContent = `Đã lấy chỉ số ${reading.current} từ Smart Home.`;
      } catch (error) {
        status.textContent = error.message || 'Không thể lấy chỉ số Smart Home.';
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const values = new FormData(formElement);
      const readingDate = values.get('readingDate');
      const month = String(readingDate).slice(0, 7);
      const electricityPrevious = Number(values.get('electricityPrevious') || 0);
      const electricityCurrent = Number(values.get('electricityCurrent') || 0);
      const waterMode = values.get('waterMode') || 'metered';
      const waterPrevious = waterMode === 'fixed' ? Number(formElement.elements.waterPrevious.value || 0) : Number(values.get('waterPrevious') || 0);
      const waterCurrent = waterMode === 'fixed' ? waterPrevious : Number(values.get('waterCurrent') || 0);
      if (electricityCurrent < electricityPrevious) { showToast('Chỉ số điện mới phải lớn hơn hoặc bằng chỉ số cũ'); return; }
      if (waterCurrent < waterPrevious) { showToast('Chỉ số nước mới phải lớn hơn hoặc bằng chỉ số cũ'); return; }
      const electricityUsage = electricityCurrent - electricityPrevious;
      const waterUsage = waterCurrent - waterPrevious;
      const electricityUnitRate = parseMoney(values.get('electricityRate'));
      const waterUnitRate = parseMoney(values.get('waterRate'));
      const electricityAmount = electricityUsage * electricityUnitRate;
      const waterAmount = waterMode === 'fixed' ? waterUnitRate : waterUsage * waterUnitRate;
      const apartmentKey = values.get('apartment');
      const createdAt = new Date().toISOString();
      meterLogs.push(
        { apartment: apartmentKey, service: 'electricity', waterMode: 'metered', previous: electricityPrevious, current: electricityCurrent, usage: electricityUsage, rate: electricityUnitRate, amount: electricityAmount, month, readingDate, createdAt },
        { apartment: apartmentKey, service: 'water', waterMode, previous: waterPrevious, current: waterCurrent, usage: waterUsage, rate: waterUnitRate, amount: waterAmount, month, readingDate, createdAt }
      );
      const selectedApartment = formElement.querySelector('[name="apartment"] option:checked');
      const apartmentName = selectedApartment?.value.split(' | ').slice(-1)[0] || '';
      const apartmentRecord = buildings[Number(selectedApartment?.dataset.buildingIndex)]?.apartments?.find((apartment) => apartment.name === apartmentName);
      if (apartmentRecord) {
        apartmentRecord.latestElectricityReading = electricityCurrent;
        apartmentRecord.latestWaterReading = waterCurrent;
        persistBuildings(false);
      }
      const buildingName = buildings[Number(selectedApartment?.dataset.buildingIndex)]?.name || '';
      const tenant = customers.find((customer) => customer.apartment === apartmentName && (!customer.building || customer.building === buildingName) && customer.status === 'renting');
      invoices.push({ id: crypto.randomUUID(), paymentCode: `NVP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, title: `Điện nước ${month} - ${apartmentName}`, building: buildingName, apartment: apartmentName, tenantEmail: tenant?.email || '', tenantName: tenant?.name || '', type: 'utilities', month, amount: electricityAmount + waterAmount, utilityLines: { electricity: electricityAmount, water: waterAmount }, dueDate: readingDate, approvalStatus: 'pending', status: 'unpaid', createdAt });
      persistCollection(meterLogStorageKey, meterLogs);
      persistCollection(invoiceStorageKey, invoices);
      updateDashboard();
      closeModal();
      showToast(`Đã chốt điện nước ngày ${new Date(`${readingDate}T00:00:00`).toLocaleDateString('vi-VN')}`);
    });
  });
}

function openMeterManager() {
  const items = meterLogs.length ? meterLogs.map((log) => `<div class="modal-option"><span>${escapeHtml(log.apartment)}</span><small>${log.service === 'electricity' ? 'Điện' : 'Nước'} · chốt ${new Date(log.readingDate ? `${log.readingDate}T00:00:00` : log.createdAt).toLocaleDateString('vi-VN')} · ${log.previous} → ${log.current} (${log.usage} đơn vị) · ${Number(log.amount).toLocaleString('vi-VN')} đ</small></div>`).join('') : '<p class="empty-state">Chưa có chỉ số nào được ghi.</p>';
  openModal('Ghi chỉ số điện nước', `<div class="entity-summary">Lưu chỉ số và tự tạo hóa đơn điện, nước</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-meter>＋ Ghi chỉ số</button>`, () => document.querySelector('[data-modal-add-meter]').addEventListener('click', openMeterForm));
}

function openUtilityManager() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  let liveReadings = new Map();
  const render = (month = currentMonth, buildingName = '') => {
    const apartments = buildings.filter((building) => !buildingName || building.name === buildingName).flatMap((building) => (building.apartments || []).map((apartment) => ({ building: building.name, apartment: apartment.name, meterId: apartment.meterId || '', currentReading: liveReadings.get(apartment.meterId)?.current ?? apartment.latestElectricityReading, key: `${building.name} | ${apartment.name}` })));
    const rows = apartments.map((item) => {
      const records = meterLogs.filter((log) => log.month === month && log.apartment === item.key);
      const electricity = records.filter((log) => log.service === 'electricity').reduce((total, log) => total + Number(log.usage || 0), 0);
      const water = records.filter((log) => log.service === 'water').reduce((total, log) => total + Number(log.usage || 0), 0);
      const electricityAmount = records.filter((log) => log.service === 'electricity').reduce((total, log) => total + Number(log.amount || 0), 0);
      const waterAmount = records.filter((log) => log.service === 'water').reduce((total, log) => total + Number(log.amount || 0), 0);
      return { ...item, electricity, water, electricityAmount, waterAmount, total: electricityAmount + waterAmount };
    });
    const total = rows.reduce((summary, item) => ({ electricity: summary.electricity + item.electricity, water: summary.water + item.water, electricityAmount: summary.electricityAmount + item.electricityAmount, waterAmount: summary.waterAmount + item.waterAmount, amount: summary.amount + item.total }), { electricity: 0, water: 0, electricityAmount: 0, waterAmount: 0, amount: 0 });
    return `<div class="utility-toolbar"><label>Tháng<input type="month" data-utility-month value="${month}"></label><label>Tòa nhà<select data-utility-building><option value="">Toàn hệ thống</option>${buildings.map((building) => `<option value="${escapeHtml(building.name)}" ${building.name === buildingName ? 'selected' : ''}>${escapeHtml(building.name)}</option>`).join('')}</select></label><button class="modal-secondary" type="button" data-utility-close>Chốt & tạo hóa đơn</button><button class="primary-button" type="button" data-utility-add>＋ Ghi chỉ số</button></div><section class="utility-summary"><article><span>Tiêu thụ điện trong tháng</span><strong>${total.electricity.toLocaleString('vi-VN')} kWh</strong><small>${total.electricityAmount.toLocaleString('vi-VN')} đ</small></article><article><span>Tiêu thụ nước trong tháng</span><strong>${total.water.toLocaleString('vi-VN')} m³</strong><small>${total.waterAmount.toLocaleString('vi-VN')} đ</small></article><article><span>Tổng tiền điện nước</span><strong>${total.amount.toLocaleString('vi-VN')} đ</strong><small>${rows.length} căn hộ trong phạm vi</small></article></section><div class="utility-table-wrap"><table class="utility-table"><thead><tr><th>Tòa nhà</th><th>Căn hộ</th><th>Chỉ số hiện tại</th><th>Điện tiêu thụ</th><th>Tiền điện</th><th>Nước</th><th>Tiền nước</th><th>Tổng căn</th></tr></thead><tbody>${rows.length ? rows.map((item) => `<tr><td>${escapeHtml(item.building)}</td><td><strong>${escapeHtml(item.apartment)}</strong></td><td>${Number.isFinite(Number(item.currentReading)) ? `${Number(item.currentReading).toLocaleString('vi-VN')} kWh` : item.meterId ? 'Đang tải...' : 'Chưa gán công tơ'}</td><td>${item.electricity.toLocaleString('vi-VN')} kWh</td><td>${item.electricityAmount.toLocaleString('vi-VN')} đ</td><td>${item.water.toLocaleString('vi-VN')} m³</td><td>${item.waterAmount.toLocaleString('vi-VN')} đ</td><td><strong>${item.total.toLocaleString('vi-VN')} đ</strong></td></tr>`).join('') : '<tr><td colspan="8" class="utility-empty">Chưa có căn hộ trong phạm vi lựa chọn.</td></tr>'}</tbody></table></div>`;
  };
  const bind = () => {
    const container = document.querySelector('[data-utility-manager]');
    const refresh = () => { container.innerHTML = render(container.querySelector('[data-utility-month]').value, container.querySelector('[data-utility-building]').value); bind(); };
    container.querySelector('[data-utility-month]').addEventListener('change', refresh);
    container.querySelector('[data-utility-building]').addEventListener('change', refresh);
    container.querySelector('[data-utility-add]').addEventListener('click', openMeterForm);
    container.querySelector('[data-utility-close]').addEventListener('click', async () => {
      const button = container.querySelector('[data-utility-close]');
      button.disabled = true;
      try {
        const response = await fetch(`${apiBaseUrl}/utilities/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: container.querySelector('[data-utility-month]').value }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Không thể chốt điện nước');
        showToast(`Đã tạo ${result.created} hóa đơn điện nước.`);
      } catch (error) { button.disabled = false; showToast(error.message || 'Không thể chốt điện nước'); }
    });
  };
  openModal('Tổng hợp điện nước', `<div class="entity-summary">Theo dõi chỉ số và chi phí điện nước của toàn hệ thống, từng tòa nhà và từng căn hộ.</div><div data-utility-manager>${render()}</div>`, () => {
    document.querySelector('[data-modal]').classList.add('utility-modal');
    bind();
    fetch(`${apiBaseUrl}/smart-home/current-readings`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Không thể đọc chỉ số Tuya');
      liveReadings = new Map(payload.readings.map((reading) => [reading.meterId, reading]));
      const container = document.querySelector('[data-utility-manager]');
      if (!container) return;
      container.innerHTML = render(container.querySelector('[data-utility-month]').value, container.querySelector('[data-utility-building]').value);
      bind();
    }).catch((error) => showToast(error.message || 'Không thể đọc chỉ số Tuya'));
  });
}

function openCommissionForm() {
  openModal('Thêm hoa hồng', `<form class="building-form" data-commission-form>
    <label>CTV/đối tác<input name="partner" required maxlength="80" placeholder="Tên người nhận hoa hồng"></label>
    <label>Khách hàng hoặc booking<input name="reference" maxlength="80" placeholder="Mã booking hoặc tên khách"></label>
    <label>Số tiền<input name="amount" type="number" min="0" required value="0"></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Tạo hoa hồng</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-commission-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      commissions.push({ id: crypto.randomUUID(), partner: form.get('partner').trim(), reference: form.get('reference').trim(), amount: parseMoney(form.get('amount')), status: 'pending', createdAt: new Date().toISOString() });
      persistCollection(commissionStorageKey, commissions);
      closeModal();
      showToast('Đã tạo khoản hoa hồng');
    });
  });
}

function openCommissionManager() {
  const items = commissions.length ? commissions.map((commission, index) => `<article class="modal-option"><div><span>${escapeHtml(commission.partner)}</span><small>${escapeHtml(commission.reference || 'Chưa gắn giao dịch')} · ${Number(commission.amount).toLocaleString('vi-VN')} đ · ${commission.status === 'paid' ? 'Đã thanh toán' : 'Chờ thanh toán'}</small></div><div class="catalog-actions"><button type="button" data-commission-pay="${index}">${commission.status === 'paid' ? 'Đã trả' : 'Thanh toán'}</button></div></article>`).join('') : '<p class="empty-state">Chưa có khoản hoa hồng nào.</p>';
  const pending = commissions.filter((commission) => commission.status !== 'paid').reduce((total, commission) => total + Number(commission.amount || 0), 0);
  openModal('Hoa hồng', `<div class="entity-summary">Chờ thanh toán: <strong>${pending.toLocaleString('vi-VN')} đ</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-commission>＋ Thêm hoa hồng</button>`, () => {
    document.querySelector('[data-modal-add-commission]').addEventListener('click', openCommissionForm);
    document.querySelectorAll('[data-commission-pay]').forEach((button) => button.addEventListener('click', () => {
      const commission = commissions[Number(button.dataset.commissionPay)];
      if (commission.status === 'paid') return;
      commission.id ||= crypto.randomUUID();
      openModal('Thanh toán hoa hồng', `<form class="building-form" data-commission-payment-form><div class="entity-summary">${escapeHtml(commission.partner)} · <strong>${Number(commission.amount || 0).toLocaleString('vi-VN')} đ</strong></div><label>Phương thức<select name="method"><option value="bank-transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Xác nhận chi</button></div></form>`, () => {
        document.querySelector('[data-modal-cancel]').addEventListener('click', openCommissionManager);
        const formElement = document.querySelector('[data-commission-payment-form]');
        formElement.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submitButton = formElement.querySelector('[type="submit"]');
          submitButton.disabled = true;
          const method = new FormData(formElement).get('method');
          try {
            await postFinancialEvent({ sourceType: 'commission-payment', sourceId: commission.id, title: `Chi hoa hồng - ${commission.partner}`, type: 'expense', amount: commission.amount, category: 'commission', method });
            commission.status = 'paid';
            commission.paidAt = new Date().toISOString();
            commission.paymentMethod = method;
            persistCollection(commissionStorageKey, commissions);
            openCommissionManager();
            showToast('Đã chi hoa hồng và đồng bộ Sổ thu chi');
          } catch (error) { submitButton.disabled = false; showToast(error.message); }
        });
      });
    }));
  });
}

function openLocationManager() {
  const items = locations.length ? locations.map((location, index) => `<article class="modal-option"><div><span>${escapeHtml(location.name)}</span><small>${escapeHtml(location.note || 'Chưa có ghi chú')}</small></div><div class="catalog-actions"><button type="button" data-location-delete="${index}">Xóa</button></div></article>`).join('') : '<p class="empty-state">Chưa có khu vực nào.</p>';
  openModal('Khu vực', `<div class="entity-summary">Dùng để phân nhóm tòa nhà và báo cáo</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-location>＋ Thêm khu vực</button>`, () => {
    document.querySelector('[data-modal-add-location]').addEventListener('click', () => openModal('Thêm khu vực', `<form class="building-form" data-location-form><label>Tên khu vực<input name="name" required maxlength="80" placeholder="Ví dụ: KĐT Vạn Phúc"></label><label>Ghi chú<input name="note" maxlength="160"></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu khu vực</button></div></form>`, () => {
      document.querySelector('[data-modal-cancel]').addEventListener('click', openLocationManager);
      document.querySelector('[data-location-form]').addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); locations.push({ name: form.get('name').trim(), note: form.get('note').trim() }); persistCollection(locationStorageKey, locations); openLocationManager(); });
    }));
    document.querySelectorAll('[data-location-delete]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.locationDelete); const location = locations[index]; const relatedBuildings = buildings.filter((building) => building.settings?.area === location.name).length; if (!confirmPermanentDeletion(`khu vực "${location.name}"`, `${relatedBuildings} tòa nhà đang tham chiếu khu vực này`)) return; locations.splice(index, 1); persistCollection(locationStorageKey, locations); openLocationManager(); showToast('Đã xóa khu vực'); }));
  });
}

function openDepositSummary() {
  const statusLabels = { active: 'Đang giữ', held: 'Đang giữ', completed: 'Đã kết thúc', refunded: 'Đã hoàn', forfeited: 'Đã giữ lại', applied: 'Đã khấu trừ' };
  const rows = [...reservations, ...depositLedger.map((record) => ({ ...record, legacy: true }))];
  const held = reservations.filter((record) => ['active', 'held'].includes(record.status)).reduce((total, record) => total + Number(record.amount || 0), 0);
  const refunded = reservations.filter((record) => record.status === 'refunded').reduce((total, record) => total + Number(record.amount || 0), 0);
  const settled = reservations.filter((record) => ['forfeited', 'applied'].includes(record.status)).reduce((total, record) => total + Number(record.appliedAmount || record.amount || 0), 0);
  const items = rows.length ? rows.map((record) => `<div class="modal-option"><span>${escapeHtml(record.name || 'Khoản tiền')}</span><small>${escapeHtml([record.building, record.note || record.apartment].filter(Boolean).join(' · ') || 'Chưa xác định')} · ${Number(record.amount || 0).toLocaleString('vi-VN')} đ · ${record.legacy ? 'Dữ liệu cũ' : statusLabels[record.status] || 'Đang giữ'}</small></div>`).join('') : '<p class="empty-state">Chưa có dữ liệu phát sinh.</p>';
  openModal('Tổng hợp tiền cọc', `<div class="cashflow-summary"><article><span>Đang giữ</span><strong>${held.toLocaleString('vi-VN')} đ</strong></article><article><span>Đã hoàn</span><strong>${refunded.toLocaleString('vi-VN')} đ</strong></article><article><span>Đã khấu trừ/giữ lại</span><strong>${settled.toLocaleString('vi-VN')} đ</strong></article></div><div class="modal-list">${items}</div>`);
}

function mergeFinancialResponse(payload) {
  const invoiceIndex = payload.invoice ? invoices.findIndex((item) => item.id === payload.invoice.id) : -1;
  if (invoiceIndex >= 0) invoices[invoiceIndex] = payload.invoice;
  if (payload.invoice) localStorage.setItem(invoiceStorageKey, JSON.stringify(invoices));
  if (currentUserRole === 'owner' && payload.cashflowEntry && !cashflow.some((entry) => entry.id === payload.cashflowEntry.id)) {
    cashflow.push(payload.cashflowEntry);
    localStorage.setItem(cashflowStorageKey, JSON.stringify(cashflow));
  }
  updateDashboard();
}

async function postFinancialEvent(event) {
  const response = await fetch(`${apiBaseUrl}/financial-events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Không thể ghi nhận giao dịch');
  if (currentUserRole === 'owner' && payload.cashflowEntry && !cashflow.some((entry) => entry.id === payload.cashflowEntry.id)) {
    cashflow.push(payload.cashflowEntry);
    localStorage.setItem(cashflowStorageKey, JSON.stringify(cashflow));
  }
  return payload;
}

function openInvoiceCollectionForm(invoiceIndex, returnView = 'invoices') {
  const invoice = invoices[invoiceIndex];
  if (!invoice || invoice.status === 'paid' || invoice.approvalStatus === 'pending') return;
  openModal('Ghi nhận thu tiền', `<form class="building-form" data-invoice-collection-form><div class="entity-summary">${escapeHtml(invoice.title)} · <strong>${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ</strong></div><label>Số tiền thực nhận<input name="amount" inputmode="numeric" required value="${Number(invoice.amount || 0)}"></label><label>Phương thức<select name="method"><option value="cash">Tiền mặt</option><option value="bank-transfer">Chuyển khoản</option><option value="other">Khác</option></select></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Xác nhận đã thu</button></div></form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', () => returnView === 'schedule' ? openPaymentSchedule() : openInvoiceManager('unpaid'));
    const formElement = document.querySelector('[data-invoice-collection-form]');
    setupMoneyInputs(formElement);
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(formElement);
      const submitButton = formElement.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        const response = await fetch(`${apiBaseUrl}/invoices/${encodeURIComponent(invoice.id)}/collect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: parseMoney(form.get('amount')), method: form.get('method') }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Không thể ghi nhận thanh toán');
        mergeFinancialResponse(payload);
        returnView === 'schedule' ? openPaymentSchedule() : openInvoiceManager('paid');
        showToast(payload.duplicate ? 'Khoản thu đã được ghi nhận trước đó' : 'Đã thu và đồng bộ Sổ thu chi');
      } catch (error) { submitButton.disabled = false; showToast(error.message); }
    });
  });
}

function openInvoiceReversalForm(invoiceIndex) {
  const invoice = invoices[invoiceIndex];
  if (!invoice || invoice.status !== 'paid' || currentUserRole !== 'owner') return;
  openModal('Hoàn tác thu tiền', `<form class="building-form" data-invoice-reversal-form><div class="entity-summary">Giao dịch gốc vẫn được giữ lại. Hệ thống sẽ tạo một dòng đối ứng trong Sổ thu chi.</div><label>Lý do hoàn tác<textarea name="reason" required minlength="3" maxlength="300" placeholder="Ví dụ: Ghi nhận nhầm hóa đơn hoặc sai phương thức"></textarea></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Xác nhận hoàn tác</button></div></form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', () => openInvoiceManager('paid'));
    const formElement = document.querySelector('[data-invoice-reversal-form]');
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = formElement.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        const response = await fetch(`${apiBaseUrl}/invoices/${encodeURIComponent(invoice.id)}/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: new FormData(formElement).get('reason').trim() }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Không thể hoàn tác thanh toán');
        mergeFinancialResponse(payload);
        openInvoiceManager('unpaid');
        showToast('Đã hoàn tác và tạo giao dịch đối ứng');
      } catch (error) { submitButton.disabled = false; showToast(error.message); }
    });
  });
}

function openPaymentSchedule() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buildingOptions = [...new Set(invoices.map((invoice) => invoice.building).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'vi'));
  const groups = [
    { key: 'overdue', title: 'Quá hạn' },
    { key: 'today', title: 'Hôm nay' },
    { key: 'upcoming', title: '7 ngày tới' },
    { key: 'later', title: 'Sau đó' },
    { key: 'unscheduled', title: 'Chưa đặt hạn' }
  ];
  const render = (month = '', buildingName = '') => {
    const rows = invoices.filter((invoice) => invoice.approvalStatus !== 'pending' && invoice.status !== 'paid' && (!month || String(invoice.dueDate || '').slice(0, 7) === month) && (!buildingName || invoice.building === buildingName)).map((invoice) => {
      const dueDate = invoice.dueDate ? new Date(`${invoice.dueDate}T00:00:00`) : null;
      const daysUntilDue = dueDate ? Math.round((dueDate - today) / 86_400_000) : null;
      const group = daysUntilDue === null ? 'unscheduled' : daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'today' : daysUntilDue <= 7 ? 'upcoming' : 'later';
      const customer = getInvoiceDetails(invoice).customer;
      return { invoice, index: invoices.indexOf(invoice), dueDate, daysUntilDue, group, customer, amount: Number(invoice.amount || 0) };
    }).sort((left, right) => String(left.invoice.dueDate || '9999-12-31').localeCompare(String(right.invoice.dueDate || '9999-12-31')));
    const overdueRows = rows.filter((row) => row.group === 'overdue');
    const upcomingRows = rows.filter((row) => row.group !== 'overdue');
    const renderRow = (row) => {
      const dueLabel = row.daysUntilDue === null ? 'Chưa đặt hạn' : row.daysUntilDue < 0 ? `Quá hạn ${Math.abs(row.daysUntilDue)} ngày` : row.daysUntilDue === 0 ? 'Đến hạn hôm nay' : `Hạn ${row.dueDate.toLocaleDateString('vi-VN')}`;
      const location = [row.invoice.building, row.invoice.apartment].filter(Boolean).join(' · ') || 'Chưa xác định căn hộ';
      return `<article class="payment-schedule-item${row.group === 'overdue' ? ' is-overdue' : ''}"><div class="payment-schedule-date"><strong>${row.dueDate ? row.dueDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : '--/--'}</strong><small>${row.dueDate?.getFullYear() || ''}</small></div><div class="payment-schedule-detail"><strong>${escapeHtml(row.customer)}</strong><span>${escapeHtml(row.invoice.title || 'Hóa đơn')} · ${escapeHtml(location)}</span><small>${escapeHtml(dueLabel)}</small></div><strong class="payment-schedule-amount">${row.amount.toLocaleString('vi-VN')} đ</strong><div class="payment-schedule-actions"><button type="button" data-payment-qr="${row.index}">VietQR</button><button type="button" data-payment-collected="${row.index}">Đã thu</button></div></article>`;
    };
    const sections = groups.map((group) => {
      const groupRows = rows.filter((row) => row.group === group.key);
      if (!groupRows.length) return '';
      return `<section class="payment-schedule-group"><header><strong>${group.title}</strong><span>${groupRows.length} khoản · ${groupRows.reduce((total, row) => total + row.amount, 0).toLocaleString('vi-VN')} đ</span></header>${groupRows.map(renderRow).join('')}</section>`;
    }).join('');
    return `<div class="payment-schedule-toolbar"><label>Kỳ thu<input type="month" data-payment-month value="${escapeHtml(month)}"></label><label>Tòa nhà<select data-payment-building><option value="">Toàn hệ thống</option>${buildingOptions.map((building) => `<option value="${escapeHtml(building)}" ${building === buildingName ? 'selected' : ''}>${escapeHtml(building)}</option>`).join('')}</select></label></div><div class="payment-schedule-summary"><article><span>Quá hạn</span><strong>${overdueRows.reduce((total, row) => total + row.amount, 0).toLocaleString('vi-VN')} đ</strong><small>${overdueRows.length} khoản cần xử lý</small></article><article><span>Chưa quá hạn</span><strong>${upcomingRows.reduce((total, row) => total + row.amount, 0).toLocaleString('vi-VN')} đ</strong><small>${upcomingRows.length} khoản đang chờ thu</small></article></div><div class="payment-schedule-list">${sections || '<p class="empty-state">Không có hóa đơn đã duyệt cần thu trong phạm vi này.</p>'}</div>`;
  };
  const bind = () => {
    const container = document.querySelector('[data-payment-schedule]');
    const refresh = () => {
      const month = container.querySelector('[data-payment-month]').value;
      const buildingName = container.querySelector('[data-payment-building]').value;
      container.innerHTML = render(month, buildingName);
      bind();
    };
    container.querySelector('[data-payment-month]').addEventListener('change', refresh);
    container.querySelector('[data-payment-building]').addEventListener('change', refresh);
    container.querySelectorAll('[data-payment-qr]').forEach((button) => button.addEventListener('click', () => openInvoicePayment(invoices[Number(button.dataset.paymentQr)])));
    container.querySelectorAll('[data-payment-collected]').forEach((button) => button.addEventListener('click', () => openInvoiceCollectionForm(Number(button.dataset.paymentCollected), 'schedule')));
  };
  openModal('Lịch thu tiền', `<div data-payment-schedule>${render()}</div>`, () => {
    document.querySelector('[data-modal]').classList.add('payment-schedule-modal');
    bind();
  });
}

function openFinancialReport(type) {
  const profitEntries = cashflow.filter((entry) => entry.affectsProfit !== false);
  const reportConfigs = {
    profit: { title: 'Thu chi thực tế', rows: [{ name: 'Khoản thu đã ghi nhận', detail: 'Không bao gồm tiền cọc đang giữ', amount: profitEntries.filter((entry) => entry.type === 'income').reduce((total, entry) => total + Number(entry.amount || 0), 0) }, { name: 'Khoản chi đã ghi nhận', detail: 'Gồm hoa hồng, sửa chữa và mua tài sản', amount: -profitEntries.filter((entry) => entry.type === 'expense').reduce((total, entry) => total + Number(entry.amount || 0), 0) }] },
    debts: { title: 'Công nợ khách thuê', rows: invoices.filter((invoice) => invoice.approvalStatus === 'approved' && invoice.status !== 'paid').map((invoice) => ({ name: invoice.title, detail: [getInvoiceDetails(invoice).customer, invoice.building, invoice.apartment, invoice.dueDate && `Hạn ${new Date(`${invoice.dueDate}T00:00:00`).toLocaleDateString('vi-VN')}`].filter(Boolean).join(' · '), amount: Number(invoice.amount || 0) })) }
  };
  const report = reportConfigs[type];
  const total = report.rows.reduce((sum, row) => sum + row.amount, 0);
  const items = report.rows.length ? report.rows.map((row) => `<div class="modal-option"><span>${escapeHtml(row.name)}</span><small class="${row.overdue ? 'negative' : ''}">${escapeHtml(row.detail)} · <strong>${row.amount.toLocaleString('vi-VN')} đ</strong></small></div>`).join('') : '<p class="empty-state">Chưa có dữ liệu phát sinh.</p>';
  openModal(report.title, `<div class="entity-summary">Tổng hợp: <strong>${total.toLocaleString('vi-VN')} đ</strong></div><div class="modal-list">${items}</div>`);
}

function openTaskForm() {
  openModal('Thêm công việc', `<form class="building-form" data-task-form>
    <label>Tên công việc<input name="title" required maxlength="100" placeholder="Ví dụ: Kiểm tra thiết bị phòng 101"></label>
    <label>Người phụ trách<input name="assignee" maxlength="60" placeholder="Tên nhân viên"></label>
    <label>Mức ưu tiên<select name="priority"><option value="normal">Bình thường</option><option value="high">Cao</option><option value="urgent">Khẩn cấp</option></select></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu công việc</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-task-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      tasks.push({ title: form.get('title').trim(), assignee: form.get('assignee').trim(), priority: form.get('priority'), status: 'todo', createdAt: new Date().toISOString() });
      persistCollection(taskStorageKey, tasks);
      updateDashboard();
      closeModal();
      showToast('Đã thêm công việc mới');
    });
  });
}

function openTaskManager() {
  const priorityLabels = { normal: 'Bình thường', high: 'Ưu tiên cao', urgent: 'Khẩn cấp' };
  const statusLabels = { todo: 'Chưa làm', doing: 'Đang làm', done: 'Hoàn thành' };
  const items = tasks.length
    ? tasks.map((task, index) => `<button class="modal-option" type="button" data-task-index="${index}"><span>${escapeHtml(task.title)}</span><small>${statusLabels[task.status]} · ${priorityLabels[task.priority]}${task.assignee ? ` · ${escapeHtml(task.assignee)}` : ''}</small></button>`).join('')
    : '<p class="empty-state">Chưa có công việc nào.</p>';
  openModal('Công việc nội bộ', `<div class="entity-summary">Tổng số: <strong>${tasks.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-task>＋ Thêm công việc</button>`, () => {
    document.querySelector('[data-modal-add-task]').addEventListener('click', openTaskForm);
    document.querySelectorAll('[data-task-index]').forEach((button) => button.addEventListener('click', () => {
      const task = tasks[Number(button.dataset.taskIndex)];
      const nextStatus = task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : 'todo';
      task.status = nextStatus;
      persistCollection(taskStorageKey, tasks);
      updateDashboard();
      closeModal();
      showToast(`Đã chuyển công việc sang: ${statusLabels[nextStatus]}`);
    }));
  });
}

function openInvoiceForm() {
  const buildingSettings = buildings[selectedBuildingIndex]?.settings || {};
  const paymentDay = Math.min(Math.max(Number(buildingSettings.paymentDay || 5), 1), 28);
  const dueDate = new Date();
  dueDate.setDate(paymentDay);
  const tenantOptions = users.filter((user) => user.role === 'tenant' && user.active !== false).map((user) => `<option value="${escapeHtml(user.email)}">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</option>`).join('');
  openModal('Thêm hóa đơn', `<form class="building-form" data-invoice-form>
    <label>Nội dung<input name="title" required maxlength="80" placeholder="Ví dụ: Tiền điện tháng 09"></label>
    <label>Người thuê<select name="tenantEmail"><option value="">Chưa gán người thuê</option>${tenantOptions}</select></label>
    <label>Loại phí<select name="type"><option value="rent">Tiền nhà</option><option value="electricity">Tiền điện</option><option value="water">Tiền nước</option><option value="service">Dịch vụ khác</option></select></label>
    <label>Số tiền<input name="amount" type="number" min="0" required value="0"></label>
    <label>Hạn thanh toán<input name="dueDate" type="date" value="${dueDate.toISOString().slice(0, 10)}"></label>
    <label>Trạng thái<select name="status"><option value="unpaid">Chưa thu</option><option value="paid">Đã thu</option></select></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu hóa đơn</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-invoice-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const tenantEmail = form.get('tenantEmail');
      const invoice = { id: crypto.randomUUID(), paymentCode: `NVP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, building: buildings[selectedBuildingIndex]?.name || '', tenantEmail, title: form.get('title').trim(), type: form.get('type'), amount: parseMoney(form.get('amount')), dueDate: form.get('dueDate'), approvalStatus: 'pending', status: form.get('status'), createdAt: new Date().toISOString() };
      invoices.push(invoice);
      persistCollection(invoiceStorageKey, invoices);
      updateDashboard();
      closeModal();
      showToast('Đã tạo hóa đơn chờ duyệt');
    });
  });
}

function openInvoicePayment(invoice) {
  const building = buildings.find((item) => item.name === invoice.building) || buildings[selectedBuildingIndex];
  const settings = building?.settings || {};
  if (settings.debtAccount !== 'bank') {
    showToast('Tòa nhà chưa chọn phương thức chuyển khoản ngân hàng');
    return;
  }
  if (!settings.bankBin || !settings.bankNumber) {
    showToast('Cần chọn ngân hàng và nhập số tài khoản cho tòa nhà');
    return;
  }
  const paymentCode = invoice.paymentCode || `NVP-${String(invoice.createdAt || '').slice(0, 10).replaceAll('-', '')}`;
  const query = new URLSearchParams({ amount: String(invoice.amount), addInfo: paymentCode });
  if (settings.bankHolder) query.set('accountName', settings.bankHolder);
  const imageUrl = `https://img.vietqr.io/image/${encodeURIComponent(settings.bankBin)}-${encodeURIComponent(settings.bankNumber)}-compact2.png?${query}`;
  openModal(`Thanh toán hóa đơn`, `<div class="payment-qr"><img src="${imageUrl}" alt="VietQR thanh toán ${escapeHtml(paymentCode)}"><div><p><strong>${escapeHtml(invoice.title)}</strong></p><p>Số tiền: <strong>${Number(invoice.amount).toLocaleString('vi-VN')} đ</strong></p><p>Nội dung bắt buộc: <strong>${escapeHtml(paymentCode)}</strong></p><p>${escapeHtml(settings.bankName)} · ${escapeHtml(settings.bankNumber)} · ${escapeHtml(settings.bankHolder)}</p></div></div>`);
}

function resolveInvoiceSettings(building = {}) {
  const legacySettings = building.settings || {};
  return {
    companyName: invoiceSettings.companyName || legacySettings.companyName || 'Phú Gia Land',
    invoiceLogoUrl: invoiceSettings.invoiceLogoUrl || legacySettings.invoiceLogoUrl || 'assets/Logo BPG.jpg'
  };
}

function getInvoiceDetails(invoice) {
  const building = buildings.find((item) => item.name === invoice.building) || buildings[selectedBuildingIndex] || {};
  const settings = building.settings || {};
  const sharedSettings = resolveInvoiceSettings(building);
  return { company: sharedSettings.companyName, logo: sharedSettings.invoiceLogoUrl, manager: settings.managerName || '', phone: settings.companyPhone || '', address: [building.address, settings.area, settings.ward, settings.city].filter(Boolean).join(', '), bank: [settings.bankName, settings.bankNumber, settings.bankHolder].filter(Boolean).join(' · '), customer: invoice.tenantName || customers.find((item) => item.email === invoice.tenantEmail)?.name || invoice.tenantEmail || 'Chưa gán khách hàng' };
}

function getInvoiceLineItems(invoice) {
  if (invoice.billingLines) return [
    ['Tiền nhà', invoice.billingLines.rent],
    ['Tiền điện', invoice.billingLines.electricity],
    ['Tiền nước', invoice.billingLines.water],
    [invoice.billingLines.serviceLabel || 'Phí dịch vụ', invoice.billingLines.service],
    ...(invoice.extraCharges || []).map((charge) => [charge.label || 'Chi phí phát sinh', charge.amount]),
    ...(Number(invoice.depositApplied || 0) > 0 ? [['Khấu trừ tiền cọc', -Number(invoice.depositApplied)]] : [])
  ].filter(([, amount]) => Number(amount || 0) !== 0);
  if (invoice.utilityLines) return [['Tiền điện', invoice.utilityLines.electricity], ['Tiền nước', invoice.utilityLines.water]].filter(([, amount]) => Number(amount || 0) > 0);
  return [[invoice.title, invoice.amount]];
}

function openInvoiceEditForm(invoiceIndex) {
  const invoice = invoices[invoiceIndex];
  if (!invoice || invoice.approvalStatus !== 'pending') return;
  const invoiceDetails = getInvoiceDetails(invoice);
  const billingLines = invoice.billingLines || {
    rent: invoice.type === 'rent' ? invoice.amount : 0,
    electricity: invoice.type === 'electricity' ? invoice.amount : invoice.utilityLines?.electricity || 0,
    water: invoice.type === 'water' ? invoice.amount : invoice.utilityLines?.water || 0,
    service: invoice.type === 'service' ? invoice.amount : 0,
    serviceLabel: 'Phí dịch vụ'
  };
  const charges = Array.isArray(invoice.extraCharges) ? invoice.extraCharges : [];
  const renderCharge = (charge = {}) => `<div class="form-grid" data-extra-charge><label>Nội dung phát sinh<input name="extraLabel" maxlength="100" value="${escapeHtml(charge.label || '')}" placeholder="Ví dụ: Sửa khóa, vệ sinh"></label><label>Số tiền<input name="extraAmount" inputmode="numeric" value="${Number(charge.amount || 0)}"></label><button class="modal-secondary" type="button" data-remove-charge>Xóa</button></div>`;
  openModal('Xem, duyệt & gửi hóa đơn', `<form class="building-form" data-invoice-edit-form>
    <div class="entity-summary">Khách thuê: <strong>${escapeHtml(invoiceDetails.customer)}</strong> · Phòng: <strong>${escapeHtml(invoice.apartment || 'Chưa xác định')}</strong>${invoice.month ? ` · Tháng: <strong>${escapeHtml(invoice.month)}</strong>` : ''}</div>
    <label>Nội dung hóa đơn<input name="title" required maxlength="100" value="${escapeHtml(invoice.title || '')}"></label>
    <label>Hạn thanh toán<input name="dueDate" type="date" required value="${escapeHtml(invoice.dueDate || '')}"></label>
    <section class="form-section"><div class="form-section-title"><strong>Các khoản định kỳ</strong></div><div class="form-grid">
      <label>Tiền nhà<input name="rent" inputmode="numeric" value="${Number(billingLines.rent || 0)}"></label>
      <label>Tiền điện<input name="electricity" inputmode="numeric" value="${Number(billingLines.electricity || 0)}"></label>
      <label>Tiền nước<input name="water" inputmode="numeric" value="${Number(billingLines.water || 0)}"></label>
      <label>Tên phí dịch vụ<input name="serviceLabel" maxlength="80" value="${escapeHtml(billingLines.serviceLabel || 'Phí dịch vụ')}"></label>
      <label>Phí dịch vụ<input name="service" inputmode="numeric" value="${Number(billingLines.service || 0)}"></label>
    </div></section>
    <section class="form-section"><div class="form-section-title"><strong>Chi phí phát sinh</strong><button class="modal-secondary" type="button" data-add-charge>＋ Thêm khoản</button></div><div data-extra-charges>${charges.map(renderCharge).join('')}</div></section>
    <div class="entity-summary">Tổng hóa đơn: <strong data-invoice-edit-total>0 đ</strong></div>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="modal-secondary" type="submit">Lưu chỉnh sửa</button>${currentUserRole === 'owner' ? '<button class="primary-button" type="submit" data-invoice-approve-submit>Duyệt & gửi</button>' : ''}</div>
  </form>`, () => {
    const formElement = document.querySelector('[data-invoice-edit-form]');
    const chargeContainer = formElement.querySelector('[data-extra-charges]');
    const updateTotal = () => {
      const form = new FormData(formElement);
      const recurring = ['rent', 'electricity', 'water', 'service'].reduce((total, name) => total + parseMoney(form.get(name)), 0);
      const extras = Array.from(chargeContainer.querySelectorAll('[data-extra-charge]')).reduce((total, row) => total + parseMoney(row.querySelector('[name="extraAmount"]').value), 0);
      formElement.querySelector('[data-invoice-edit-total]').textContent = `${(recurring + extras).toLocaleString('vi-VN')} đ`;
    };
    const bindCharge = (row) => {
      row.querySelector('[data-remove-charge]').addEventListener('click', () => { row.remove(); updateTotal(); });
      row.querySelector('[name="extraAmount"]').addEventListener('input', updateTotal);
    };
    chargeContainer.querySelectorAll('[data-extra-charge]').forEach(bindCharge);
    formElement.querySelectorAll('[name="rent"], [name="electricity"], [name="water"], [name="service"]').forEach((input) => input.addEventListener('input', updateTotal));
    formElement.querySelector('[data-add-charge]').addEventListener('click', () => {
      chargeContainer.insertAdjacentHTML('beforeend', renderCharge());
      const row = chargeContainer.lastElementChild;
      setupMoneyInputs(row);
      bindCharge(row);
    });
    document.querySelector('[data-modal-cancel]').addEventListener('click', () => openInvoiceManager('pending'));
    updateTotal();
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const shouldApprove = event.submitter?.hasAttribute('data-invoice-approve-submit');
      const submitButtons = formElement.querySelectorAll('button[type="submit"]');
      submitButtons.forEach((button) => { button.disabled = true; });
      const form = new FormData(formElement);
      const nextBillingLines = { rent: parseMoney(form.get('rent')), electricity: parseMoney(form.get('electricity')), water: parseMoney(form.get('water')), service: parseMoney(form.get('service')), serviceLabel: form.get('serviceLabel').trim() || 'Phí dịch vụ' };
      const extraCharges = Array.from(chargeContainer.querySelectorAll('[data-extra-charge]')).map((row) => ({ label: row.querySelector('[name="extraLabel"]').value.trim(), amount: parseMoney(row.querySelector('[name="extraAmount"]').value) })).filter((charge) => charge.label && charge.amount > 0);
      Object.assign(invoice, { title: form.get('title').trim(), dueDate: form.get('dueDate'), type: 'monthly', billingLines: nextBillingLines, utilityLines: { electricity: nextBillingLines.electricity, water: nextBillingLines.water }, extraCharges, amount: Object.values(nextBillingLines).filter((value) => typeof value === 'number').reduce((total, value) => total + value, 0) + extraCharges.reduce((total, charge) => total + charge.amount, 0), updatedAt: new Date().toISOString() });
      localStorage.setItem(invoiceStorageKey, JSON.stringify(invoices));
      try {
        const response = await fetch(`${apiBaseUrl}/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { [invoiceStorageKey]: JSON.stringify(invoices) } }) });
        if (!response.ok) throw new Error('Không thể lưu hóa đơn');
        if (shouldApprove) {
          const approvalResponse = await fetch(`${apiBaseUrl}/invoices/${encodeURIComponent(invoice.id)}/approve`, { method: 'POST' });
          const payload = await approvalResponse.json();
          if (!approvalResponse.ok) throw new Error(payload.error || 'Không thể duyệt hóa đơn');
          Object.assign(invoice, payload.invoice);
          localStorage.setItem(invoiceStorageKey, JSON.stringify(invoices));
        }
        updateDashboard();
        openInvoiceManager(shouldApprove ? 'approved' : 'pending');
        showToast(shouldApprove ? 'Đã lưu, duyệt và gửi hóa đơn cho cư dân' : 'Đã lưu chỉnh sửa hóa đơn');
      } catch (error) {
        submitButtons.forEach((button) => { button.disabled = false; });
        showToast(error.message || (shouldApprove ? 'Không thể duyệt và gửi hóa đơn' : 'Không thể lưu hóa đơn'));
      }
    });
  });
}

function printInvoice(invoice) {
  const detail = getInvoiceDetails(invoice);
  const lines = getInvoiceLineItems(invoice).map(([label, amount]) => `<tr><td>${escapeHtml(label)}</td><td>${Number(amount || 0).toLocaleString('vi-VN')} đ</td></tr>`).join('');
  const page = window.open('', '_blank', 'width=760,height=900');
  page.document.write(`<title>Hóa đơn ${escapeHtml(invoice.paymentCode || '')}</title><style>body{font-family:Arial,sans-serif;color:#17231d;padding:38px;max-width:680px;margin:auto}header{border-bottom:3px solid #138b54;padding-bottom:16px;display:flex;gap:18px;align-items:center}header img{width:76px;height:76px;object-fit:contain}h1{margin:0;color:#0b6e40;font-size:26px}p{margin:6px 0;color:#516058}table{width:100%;border-collapse:collapse;margin-top:28px}td,th{border-bottom:1px solid #dce4de;padding:12px;text-align:left}td:last-child,th:last-child{text-align:right}.total{font-size:22px;font-weight:bold;color:#0b6e40;text-align:right;margin-top:20px}.code{background:#f2f7f3;padding:12px;margin-top:20px}</style><header><img src="${escapeHtml(detail.logo)}" alt=""><div><h1>${escapeHtml(detail.company)}</h1><p>${escapeHtml(detail.address)}</p><p>${escapeHtml([detail.manager, detail.phone].filter(Boolean).join(' · '))}</p></div></header><h2>HÓA ĐƠN THANH TOÁN</h2><p>Khách hàng: <b>${escapeHtml(detail.customer)}</b></p><p>Căn hộ: <b>${escapeHtml(invoice.apartment || '')}</b> · Tháng: <b>${escapeHtml(invoice.month || '')}</b></p><table><thead><tr><th>Nội dung</th><th>Thành tiền</th></tr></thead><tbody>${lines}</tbody></table><div class="total">Tổng thanh toán: ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ</div><div class="code">Mã thanh toán: <b>${escapeHtml(invoice.paymentCode || '')}</b><br>Hạn thanh toán: ${escapeHtml(invoice.dueDate || 'Chưa xác định')}<br>Ngân hàng: ${escapeHtml(detail.bank || 'Chưa cấu hình')}</div>`);
  page.document.close();
  page.print();
}

async function copyInvoiceImage(invoice) {
  const detail = getInvoiceDetails(invoice);
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 900;
  const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1200, 900);
  let textLeft = 60;
  if (detail.logo) {
    try {
      const logo = new Image();
      logo.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => { logo.onload = resolve; logo.onerror = reject; logo.src = detail.logo; });
      context.drawImage(logo, 60, 32, 100, 100);
      textLeft = 185;
    } catch {}
  }
  context.fillStyle = '#0b6e40'; context.font = 'bold 42px Arial'; context.fillText(detail.company, textLeft, 80); context.fillStyle = '#34433a'; context.font = '25px Arial';
  const lines = [detail.address, [detail.manager, detail.phone].filter(Boolean).join(' · '), 'HÓA ĐƠN THANH TOÁN', `Khách hàng: ${detail.customer}`, `Căn hộ: ${invoice.apartment || ''}  |  Tháng: ${invoice.month || ''}`, ...getInvoiceLineItems(invoice).map(([label, amount]) => `${label}: ${Number(amount || 0).toLocaleString('vi-VN')} đ`), `TỔNG THANH TOÁN: ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ`, `Hạn thanh toán: ${invoice.dueDate || 'Chưa xác định'}`, `Mã thanh toán: ${invoice.paymentCode || ''}`, `Ngân hàng: ${detail.bank || 'Chưa cấu hình'}`].filter(Boolean);
  lines.forEach((line, index) => context.fillText(line, 60, 140 + index * 58));
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (navigator.clipboard?.write && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); showToast('Đã sao chép hóa đơn dạng ảnh.'); return; }
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `hoa-don-${invoice.paymentCode || 'dien-nuoc'}.png`; link.click(); URL.revokeObjectURL(link.href); showToast('Đã tải ảnh hóa đơn.');
}

function openInvoiceManager(filter = 'pending') {
  const matchesFilter = (invoice) => filter === 'pending' ? invoice.approvalStatus === 'pending' : filter === 'approved' ? invoice.approvalStatus !== 'pending' : filter === 'unpaid' ? invoice.approvalStatus !== 'pending' && invoice.status !== 'paid' : invoice.status === 'paid';
  const filteredInvoices = invoices.filter(matchesFilter);
  const items = filteredInvoices.length
    ? filteredInvoices.map((invoice) => { const index = invoices.indexOf(invoice); return `<article class="modal-option"><div><span>${escapeHtml(invoice.title)}</span><small>${escapeHtml(invoice.paymentCode || 'Chưa có mã thanh toán')} · ${Number(invoice.amount).toLocaleString('vi-VN')} đ · ${invoice.approvalStatus === 'pending' ? 'Chờ duyệt' : invoice.status === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán'}</small></div><div class="catalog-actions">${invoice.approvalStatus === 'pending' ? `<button type="button" data-invoice-edit="${index}">${currentUserRole === 'owner' ? 'Xem, duyệt & gửi' : 'Xem & chỉnh sửa'}</button>` : ''}${invoice.approvalStatus !== 'pending' && invoice.status !== 'paid' ? `<button type="button" data-invoice-qr="${index}">VietQR</button>` : ''}<button type="button" data-invoice-print="${index}">PDF</button><button type="button" data-invoice-image="${index}">Ảnh</button>${invoice.approvalStatus === 'pending' || (invoice.status === 'paid' && currentUserRole !== 'owner') ? '' : `<button type="button" data-invoice-index="${index}">${invoice.status === 'paid' ? 'Hoàn tác' : 'Đã thu'}</button>`}</div></article>`; }).join('')
    : '<p class="empty-state">Chưa có hóa đơn nào.</p>';
  openModal('Hóa đơn khách thuê', `<div class="customer-tabs invoice-tabs"><button class="${filter === 'pending' ? 'active' : ''}" data-invoice-filter="pending">Chờ duyệt (${invoices.filter((item) => item.approvalStatus === 'pending').length})</button><button class="${filter === 'approved' ? 'active' : ''}" data-invoice-filter="approved">Đã duyệt</button><button class="${filter === 'unpaid' ? 'active' : ''}" data-invoice-filter="unpaid">Chưa thanh toán</button><button class="${filter === 'paid' ? 'active' : ''}" data-invoice-filter="paid">Đã thanh toán</button></div><div class="entity-summary">Tổng tiền trong mục: <strong>${filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0).toLocaleString('vi-VN')} đ</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-invoice>＋ Thêm hóa đơn</button>`, () => {
    document.querySelectorAll('[data-invoice-filter]').forEach((button) => button.addEventListener('click', () => openInvoiceManager(button.dataset.invoiceFilter)));
    document.querySelector('[data-modal-add-invoice]').addEventListener('click', openInvoiceForm);
    document.querySelectorAll('[data-invoice-edit]').forEach((button) => button.addEventListener('click', () => openInvoiceEditForm(Number(button.dataset.invoiceEdit))));
    document.querySelectorAll('[data-invoice-qr]').forEach((button) => button.addEventListener('click', () => openInvoicePayment(invoices[Number(button.dataset.invoiceQr)])));
    document.querySelectorAll('[data-invoice-print]').forEach((button) => button.addEventListener('click', () => printInvoice(invoices[Number(button.dataset.invoicePrint)])));
    document.querySelectorAll('[data-invoice-image]').forEach((button) => button.addEventListener('click', () => copyInvoiceImage(invoices[Number(button.dataset.invoiceImage)]).catch(() => showToast('Không thể tạo ảnh hóa đơn.'))));
    document.querySelectorAll('[data-invoice-index]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.invoiceIndex);
      invoices[index].status === 'paid' ? openInvoiceReversalForm(index) : openInvoiceCollectionForm(index);
    }));
  });
}

function openCashflowForm() {
  openModal('Thêm giao dịch', `<form class="building-form" data-cashflow-form><div class="form-grid">
    <label>Nội dung<input name="title" required maxlength="80" placeholder="Ví dụ: Mua vật tư sửa chữa"></label>
    <label>Loại giao dịch<select name="type"><option value="income">Khoản thu</option><option value="expense">Khoản chi</option></select></label>
    <label>Nhóm thu chi<select name="category"><option value="other-income">Thu khác</option><option value="rent">Tiền nhà</option><option value="utilities">Điện nước</option><option value="service">Dịch vụ</option><option value="other-expense">Chi khác</option><option value="maintenance">Sửa chữa</option><option value="commission">Hoa hồng</option><option value="asset-purchase">Mua tài sản</option></select></label>
    <label>Phương thức<select name="method"><option value="bank-transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label>
    <label>Số tiền<input name="amount" inputmode="numeric" required value="0"></label>
    <label>Ngày giao dịch<input name="transactionDate" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
    <label>Tòa nhà<select name="building"><option value="">Toàn hệ thống/không xác định</option>${buildings.map((building) => `<option value="${escapeHtml(building.name)}">${escapeHtml(building.name)}</option>`).join('')}</select></label>
    <label>Căn hộ<input name="apartment" maxlength="80" placeholder="Có thể để trống"></label></div>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu giao dịch</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    setupMoneyInputs(document.querySelector('[data-cashflow-form]'));
    document.querySelector('[data-cashflow-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      cashflow.push({ id: crypto.randomUUID(), title: form.get('title').trim(), type: form.get('type'), amount: parseMoney(form.get('amount')), category: form.get('category'), method: form.get('method'), building: form.get('building'), apartment: form.get('apartment').trim(), transactionDate: form.get('transactionDate'), sourceType: 'manual', sourceId: crypto.randomUUID(), recordedBy: currentUserName, affectsCash: true, affectsProfit: true, createdAt: new Date().toISOString() });
      persistCollection(cashflowStorageKey, cashflow);
      updateDashboard();
      closeModal();
      showToast('Đã thêm giao dịch');
    });
  });
}

function openCashflowReversalForm(entryIndex) {
  const entry = cashflow[entryIndex];
  if (!entry?.id || entry.reversalOf || cashflow.some((item) => item.reversalOf === entry.id)) return;
  openModal('Hoàn tác giao dịch', `<form class="building-form" data-cashflow-reversal-form><div class="entity-summary">${escapeHtml(entry.title)} · <strong>${Number(entry.amount || 0).toLocaleString('vi-VN')} đ</strong></div><label>Lý do hoàn tác<textarea name="reason" required minlength="3" maxlength="300"></textarea></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Tạo giao dịch đối ứng</button></div></form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', openCashflowManager);
    const formElement = document.querySelector('[data-cashflow-reversal-form]');
    formElement.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = formElement.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        const response = await fetch(`${apiBaseUrl}/cashflow/${encodeURIComponent(entry.id)}/reverse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: new FormData(formElement).get('reason').trim() }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Không thể hoàn tác giao dịch');
        if (!cashflow.some((item) => item.id === payload.cashflowEntry.id)) cashflow.push(payload.cashflowEntry);
        localStorage.setItem(cashflowStorageKey, JSON.stringify(cashflow));
        openCashflowManager();
        showToast('Đã tạo giao dịch đối ứng, dữ liệu gốc được giữ nguyên');
      } catch (error) { submitButton.disabled = false; showToast(error.message); }
    });
  });
}

function openCashflowManager() {
  const categoryLabels = { 'invoice-payment': 'Thu hóa đơn', commission: 'Hoa hồng', 'asset-repair': 'Sửa chữa', 'asset-purchase': 'Mua tài sản', deposit: 'Tiền cọc', 'deposit-receipt': 'Thu cọc', 'deposit-refund': 'Hoàn cọc', 'deposit-forfeit': 'Giữ cọc', 'deposit-apply': 'Khấu trừ cọc', 'payment-reversal': 'Hoàn tác thu', 'transaction-reversal': 'Hoàn tác', rent: 'Tiền nhà', utilities: 'Điện nước', service: 'Dịch vụ', 'other-income': 'Thu khác', 'other-expense': 'Chi khác' };
  const methodLabels = { cash: 'Tiền mặt', 'bank-transfer': 'Chuyển khoản', other: 'Khác', deposit: 'Tiền cọc' };
  const render = (month = '', buildingName = '', type = '') => {
    const rows = cashflow.map((entry, index) => ({ entry, index })).filter(({ entry }) => (!month || String(entry.transactionDate || entry.createdAt || '').slice(0, 7) === month) && (!buildingName || entry.building === buildingName) && (!type || entry.type === type));
    const cashIncome = rows.filter(({ entry }) => entry.affectsCash !== false && entry.type === 'income').reduce((sum, { entry }) => sum + Number(entry.amount || 0), 0);
    const cashExpense = rows.filter(({ entry }) => entry.affectsCash !== false && entry.type === 'expense').reduce((sum, { entry }) => sum + Number(entry.amount || 0), 0);
    const profit = rows.filter(({ entry }) => entry.affectsProfit !== false).reduce((sum, { entry }) => sum + (entry.type === 'income' ? Number(entry.amount || 0) : -Number(entry.amount || 0)), 0);
    const items = rows.length ? rows.slice().reverse().map(({ entry, index }) => { const reversed = cashflow.some((item) => item.reversalOf === entry.id); const canReverseHere = entry.sourceType === 'manual' && !entry.reversalOf && !reversed; return `<article class="modal-option cashflow-entry"><div><span>${escapeHtml(entry.title)}</span><small>${escapeHtml(categoryLabels[entry.category] || categoryLabels[entry.sourceType] || 'Chưa phân loại')} · ${escapeHtml(methodLabels[entry.method] || 'Chưa xác định')} · ${escapeHtml([entry.building, entry.apartment].filter(Boolean).join(' · ') || 'Toàn hệ thống')} · ${new Date(entry.transactionDate ? `${entry.transactionDate}T00:00:00` : entry.createdAt).toLocaleDateString('vi-VN')}</small>${entry.note ? `<small>Lý do: ${escapeHtml(entry.note)}</small>` : ''}</div><div class="cashflow-value"><strong class="${entry.type === 'income' ? 'green-text' : 'negative'}">${entry.type === 'income' ? '+' : '-'}${Number(entry.amount).toLocaleString('vi-VN')} đ</strong>${canReverseHere ? `<button type="button" data-cashflow-reverse="${index}">Hoàn tác</button>` : (entry.reversalOf || reversed ? `<small>${entry.reversalOf ? 'Dòng đối ứng' : 'Đã hoàn tác'}</small>` : '<small>Quản lý tại nghiệp vụ gốc</small>')}</div></article>`; }).join('') : '<p class="empty-state">Không có giao dịch trong phạm vi lọc.</p>';
    return `<div class="cashflow-toolbar"><label>Tháng<input type="month" data-cashflow-month value="${escapeHtml(month)}"></label><label>Tòa nhà<select data-cashflow-building><option value="">Toàn hệ thống</option>${buildings.map((building) => `<option value="${escapeHtml(building.name)}" ${building.name === buildingName ? 'selected' : ''}>${escapeHtml(building.name)}</option>`).join('')}</select></label><label>Loại<select data-cashflow-type><option value="">Tất cả</option><option value="income" ${type === 'income' ? 'selected' : ''}>Khoản thu</option><option value="expense" ${type === 'expense' ? 'selected' : ''}>Khoản chi</option></select></label></div><div class="cashflow-summary"><article><span>Tiền vào</span><strong>${cashIncome.toLocaleString('vi-VN')} đ</strong></article><article><span>Tiền ra</span><strong>${cashExpense.toLocaleString('vi-VN')} đ</strong></article><article><span>Thu chi thực tế</span><strong class="${profit < 0 ? 'negative' : 'green-text'}">${profit.toLocaleString('vi-VN')} đ</strong></article></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-cashflow>＋ Thêm giao dịch</button>`;
  };
  const bind = () => {
    const container = document.querySelector('[data-cashflow-manager]');
    const refresh = () => { const month = container.querySelector('[data-cashflow-month]').value; const buildingName = container.querySelector('[data-cashflow-building]').value; const type = container.querySelector('[data-cashflow-type]').value; container.innerHTML = render(month, buildingName, type); bind(); };
    container.querySelector('[data-cashflow-month]').addEventListener('change', refresh);
    container.querySelector('[data-cashflow-building]').addEventListener('change', refresh);
    container.querySelector('[data-cashflow-type]').addEventListener('change', refresh);
    container.querySelector('[data-modal-add-cashflow]').addEventListener('click', openCashflowForm);
    container.querySelectorAll('[data-cashflow-reverse]').forEach((button) => button.addEventListener('click', () => openCashflowReversalForm(Number(button.dataset.cashflowReverse))));
  };
  openModal('Sổ thu chi', `<div data-cashflow-manager>${render()}</div>`, () => {
    document.querySelector('[data-modal]').classList.add('finance-ledger-modal');
    bind();
  });
}

function persistCatalogs() {
  persistCollection(catalogStorageKey, catalogs);
}

function openCatalogForm(type, recordIndex = -1) {
  const [title, fieldLabel] = catalogConfigs[type];
  const records = catalogs[type] || (catalogs[type] = []);
  const record = records[recordIndex] || { name: '', note: '', amount: 0 };
  const action = recordIndex >= 0 ? 'Cập nhật dữ liệu' : 'Lưu dữ liệu';
  openModal(`${recordIndex >= 0 ? 'Sửa' : 'Thêm'} - ${title}`, `<form class="building-form" data-catalog-form>
    <label>${fieldLabel}<input name="name" required maxlength="100" value="${escapeHtml(record.name)}" placeholder="Nhập ${fieldLabel.toLowerCase()}"></label>
    <label>Ghi chú<input name="note" maxlength="160" value="${escapeHtml(record.note)}" placeholder="Thông tin bổ sung"></label>
    <label>Giá trị (nếu có)<input name="amount" type="number" min="0" value="${Number(record.amount || 0)}"></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu dữ liệu</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-catalog-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const nextRecord = { name: form.get('name').trim(), note: form.get('note').trim(), amount: parseMoney(form.get('amount')), createdAt: record.createdAt || new Date().toISOString() };
      if (recordIndex >= 0) records[recordIndex] = nextRecord;
      else records.push(nextRecord);
      persistCatalogs();
      closeModal();
      showToast(`${recordIndex >= 0 ? 'Đã cập nhật' : 'Đã thêm'} dữ liệu: ${title}`);
    });
  });
}

function openCatalogManager(type) {
  const [title] = catalogConfigs[type];
  const records = catalogs[type] || (catalogs[type] = []);
  const items = records.length
    ? records.map((record, index) => `<div class="modal-option catalog-record"><div><span>${escapeHtml(record.name)}</span><small>${escapeHtml(record.note || 'Chưa có ghi chú')}${record.amount ? ` · ${Number(record.amount).toLocaleString('vi-VN')} đ` : ''}</small></div><div class="catalog-actions"><button type="button" data-catalog-edit="${index}">Sửa</button><button type="button" data-catalog-delete="${index}">Xóa</button></div></div>`).join('')
    : '<p class="empty-state">Chưa có dữ liệu trong phân hệ này.</p>';
  openModal(title, `<div class="entity-summary">Tổng số: <strong>${records.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-catalog>＋ Thêm dữ liệu</button>`, () => {
    document.querySelector('[data-modal-add-catalog]').addEventListener('click', () => openCatalogForm(type));
    document.querySelectorAll('[data-catalog-edit]').forEach((button) => button.addEventListener('click', () => openCatalogForm(type, Number(button.dataset.catalogEdit))));
    document.querySelectorAll('[data-catalog-delete]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.catalogDelete);
      if (!confirmPermanentDeletion(`dữ liệu "${records[index].name}"`)) return;
      records.splice(index, 1);
      persistCatalogs();
      closeModal();
      showToast('Đã xóa dữ liệu');
    }));
  });
}

function openAssetOperations(type) {
  const records = catalogs[type] || (catalogs[type] = []);
  const optionsFor = (items, placeholder) => `<option value="">${placeholder}</option>${items.map((item) => `<option value="${escapeHtml(item.name || item.code)}">${escapeHtml(item.name || item.code)}${item.code && item.name ? ` · ${escapeHtml(item.code)}` : ''}</option>`).join('')}`;
  const assetOptions = optionsFor(catalogs.assets || [], 'Chọn tài sản');
  const providerOptions = optionsFor(catalogs.providers || [], 'Chưa chọn nhà cung cấp');
  const warehouseOptions = optionsFor(catalogs.warehouses || [], 'Chọn kho tài sản');
  const assetTypeOptions = optionsFor(catalogs['asset-types'] || [], 'Chưa phân loại');
  const configs = {
    assets: { title: 'Danh sách tài sản', fields: `<label>Mã tài sản<input name="code" required maxlength="40" placeholder="TS-0001"></label><label>Tên tài sản<input name="name" required maxlength="100"></label><label>Loại tài sản<select name="assetType">${assetTypeOptions}</select></label><label>Nhà cung cấp<select name="provider">${providerOptions}</select></label><label>Kho tài sản<select name="warehouse">${warehouseOptions}</select></label><label>Số lượng<input name="quantity" type="number" min="1" value="1"></label><label>Giá mua<input name="purchaseAmount" inputmode="numeric" value="0"></label><label>Ngày mua<input name="purchasedAt" type="date"></label><label>Phương thức thanh toán<select name="paymentMethod"><option value="bank-transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label><label>Trạng thái<select name="status"><option value="active">Đang sử dụng</option><option value="stored">Trong kho</option><option value="broken">Hỏng</option><option value="disposed">Đã thanh lý</option></select></label>` },
    providers: { title: 'Nhà cung cấp', fields: '<label>Tên nhà cung cấp<input name="name" required maxlength="100"></label><label>Mã số thuế<input name="taxCode" maxlength="30"></label><label>Người liên hệ<input name="contact" maxlength="80"></label><label>Số điện thoại<input name="phone" maxlength="30"></label><label>Email<input name="email" type="email" maxlength="120"></label><label>Ghi chú<textarea name="note" maxlength="300"></textarea></label>' },
    warehouses: { title: 'Kho tài sản', fields: '<label>Tên kho<input name="name" required maxlength="100"></label><label>Mã kho<input name="code" required maxlength="40"></label><label>Địa chỉ<input name="address" maxlength="180"></label><label>Người phụ trách<input name="manager" maxlength="80"></label><label>Ghi chú<textarea name="note" maxlength="300"></textarea></label>' },
    'asset-types': { title: 'Loại tài sản', fields: '<label>Tên loại tài sản<input name="name" required maxlength="100"></label><label>Mã loại<input name="code" maxlength="40"></label><label>Thời gian khấu hao (tháng)<input name="lifeMonths" type="number" min="0" value="0"></label><label>Mô tả<textarea name="note" maxlength="300"></textarea></label>' },
    'moving-logs': { title: 'Điều chuyển tài sản', fields: `<label>Tài sản<select name="asset" required>${assetOptions}</select></label><label>Nơi đi<select name="from" required>${warehouseOptions}</select></label><label>Nơi đến<select name="to" required>${warehouseOptions}</select></label><label>Người thực hiện<input name="actor" maxlength="80"></label><label>Ngày di chuyển<input name="date" type="date" required></label><label>Ghi chú<textarea name="note" maxlength="300"></textarea></label>` },
    'asset-fix': { title: 'Sửa chữa tài sản', fields: `<label>Tài sản<select name="asset" required>${assetOptions}</select></label><label>Nội dung lỗi<input name="issue" required maxlength="160"></label><label>Nhà cung cấp sửa chữa<select name="provider">${providerOptions}</select></label><label>Chi phí<input name="cost" inputmode="numeric" value="0"></label><label>Phương thức thanh toán<select name="paymentMethod"><option value="bank-transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="other">Khác</option></select></label><label>Ngày báo lỗi<input name="reportedAt" type="date" required></label><label>Ngày hoàn tất<input name="completedAt" type="date"></label><label>Trạng thái<select name="status"><option value="new">Mới báo</option><option value="processing">Đang sửa</option><option value="completed">Đã hoàn tất</option></select></label>` }
  };
  const config = configs[type];
  const statusLabels = { active: 'Đang sử dụng', stored: 'Trong kho', broken: 'Đang hỏng', disposed: 'Đã thanh lý', new: 'Mới báo', processing: 'Đang sửa', completed: 'Đã hoàn tất' };
  const recordSummary = (record) => {
    if (type === 'assets') return `${record.code || 'Chưa có mã'} · ${record.assetType || 'Chưa phân loại'} · ${record.warehouse || 'Chưa xếp kho'} · SL ${record.quantity || 1}${Number(record.purchaseAmount || 0) > 0 ? ` · ${Number(record.purchaseAmount).toLocaleString('vi-VN')} đ` : ''} · ${statusLabels[record.status] || 'Chưa xác định'}`;
    if (type === 'providers') return [record.taxCode && `MST ${record.taxCode}`, record.contact, record.phone, record.email].filter(Boolean).join(' · ') || 'Chưa có thông tin liên hệ';
    if (type === 'warehouses') return [record.code, record.address, record.manager && `Phụ trách: ${record.manager}`].filter(Boolean).join(' · ') || 'Chưa có thông tin kho';
    if (type === 'asset-types') return [record.code, Number(record.lifeMonths) > 0 && `Khấu hao ${record.lifeMonths} tháng`, record.note].filter(Boolean).join(' · ') || 'Chưa có mô tả';
    if (type === 'moving-logs') return `${record.from || 'Chưa xác định'} → ${record.to || 'Chưa xác định'} · ${record.date || 'Chưa có ngày'}${record.actor ? ` · ${record.actor}` : ''}`;
    return `${record.issue || 'Chưa có nội dung lỗi'} · ${Number(record.cost || 0).toLocaleString('vi-VN')} đ · ${statusLabels[record.status] || 'Chưa xác định'}`;
  };
  const items = records.length ? records.map((record, index) => `<article class="modal-option"><div><span>${escapeHtml(record.name || record.asset || record.code)}</span><small>${escapeHtml(recordSummary(record))}</small></div><div class="catalog-actions"><button type="button" data-operation-edit="${index}">Sửa</button><button type="button" data-operation-delete="${index}">Xóa</button></div></article>`).join('') : '<p class="empty-state">Chưa có dữ liệu.</p>';
  openModal(config.title, `<div class="entity-summary">Tổng số: <strong>${records.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-operation-add>＋ Thêm dữ liệu</button>`, () => {
    const openForm = (recordIndex = -1) => {
      const record = records[recordIndex] || {};
      openModal(`${recordIndex >= 0 ? 'Sửa' : 'Thêm'} - ${config.title}`, `<form class="building-form" data-operation-form>${config.fields}<div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu</button></div></form>`, () => {
        const formElement = document.querySelector('[data-operation-form]');
        Object.entries(record).forEach(([key, value]) => { const field = formElement.elements[key]; if (field) field.value = value; });
        document.querySelector('[data-modal-cancel]').addEventListener('click', () => openAssetOperations(type));
        setupMoneyInputs(formElement);
        formElement.addEventListener('submit', async (event) => {
          event.preventDefault();
          const submitButton = formElement.querySelector('[type="submit"]');
          submitButton.disabled = true;
          const form = new FormData(formElement);
          const next = { ...record, ...Object.fromEntries(form.entries()), id: record.id || crypto.randomUUID(), quantity: Number(form.get('quantity') || 0), cost: parseMoney(form.get('cost')), purchaseAmount: parseMoney(form.get('purchaseAmount')), updatedAt: new Date().toISOString() };
          try {
            if (type === 'assets' && next.purchaseAmount > 0) await postFinancialEvent({ sourceType: 'asset-purchase', sourceId: next.id, title: `Mua tài sản - ${next.name}`, type: 'expense', amount: next.purchaseAmount, category: 'asset-purchase', method: next.paymentMethod });
            if (type === 'asset-fix' && next.status === 'completed' && next.cost > 0) await postFinancialEvent({ sourceType: 'asset-repair', sourceId: next.id, title: `Sửa chữa tài sản - ${next.asset}`, type: 'expense', amount: next.cost, category: 'asset-repair', method: next.paymentMethod });
            if (recordIndex >= 0) records[recordIndex] = next; else records.push(next);
            if (type === 'moving-logs') { const asset = (catalogs.assets || []).find((item) => item.code === next.asset || item.name === next.asset); if (asset) { asset.warehouse = next.to; asset.status = 'active'; } }
            if (type === 'asset-fix') { const asset = (catalogs.assets || []).find((item) => item.code === next.asset || item.name === next.asset); if (asset) asset.status = next.status === 'completed' ? 'active' : 'broken'; }
            persistCatalogs();
            openAssetOperations(type);
            showToast(type === 'assets' && next.purchaseAmount > 0 || type === 'asset-fix' && next.status === 'completed' && next.cost > 0 ? 'Đã lưu và đồng bộ chi phí vào Sổ thu chi' : 'Đã lưu dữ liệu vận hành');
          } catch (error) { submitButton.disabled = false; showToast(error.message); }
        });
      });
    };
    document.querySelector('[data-operation-add]').addEventListener('click', () => openForm());
    document.querySelectorAll('[data-operation-edit]').forEach((button) => button.addEventListener('click', () => openForm(Number(button.dataset.operationEdit))));
    document.querySelectorAll('[data-operation-delete]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.operationDelete); const record = records[index]; if (!confirmPermanentDeletion(`bản ghi "${record.name || record.asset || record.code || 'không tên'}"`)) return; records.splice(index, 1); persistCatalogs(); openAssetOperations(type); showToast('Đã xóa bản ghi'); }));
  });
}

function openTemplateManager(type) {
  const templateMeta = {
    signatures: ['Mẫu chữ ký', 'Họ tên, chức danh và chữ ký người ký'],
    'deposit-contract': ['Hợp đồng đặt cọc', 'Thông tin đặt cọc, các bên và điều khoản'],
    handover: ['Biên bản bàn giao', 'Tình trạng tài sản, chỉ số và vật dụng bàn giao'],
    'invoice-template': ['Mẫu hóa đơn', 'Mã hóa đơn, kỳ tính tiền và chi tiết khoản thu'],
    'cash-template': ['Mẫu thu chi', 'Nội dung thu chi, số tiền và người thực hiện']
  };
  const [title, hint] = templateMeta[type];
  const records = catalogs[type] || (catalogs[type] = []);
  const items = records.length ? records.map((record, index) => `<article class="modal-option"><div><span>${escapeHtml(record.name)}</span><small>${escapeHtml(record.code)} · ${record.isDefault ? 'Mặc định' : 'Đang lưu'}</small></div><div class="catalog-actions"><button type="button" data-template-preview="${index}">Xem mẫu</button><button type="button" data-template-edit="${index}">Sửa</button><button type="button" data-template-delete="${index}">Xóa</button></div></article>`).join('') : '<p class="empty-state">Chưa có mẫu biểu nào.</p>';
  openModal(title, `<div class="entity-summary">${escapeHtml(hint)} · Tổng số: <strong>${records.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-template-add>＋ Thêm mẫu biểu</button>`, () => {
    const openForm = (index = -1) => {
      const record = records[index] || { name: '', content: '', variables: '', isDefault: records.length === 0 };
      const code = record.code || `MT-${type.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5)}-${String(records.length + 1).padStart(4, '0')}`;
      openModal(`${index >= 0 ? 'Sửa' : 'Thêm'} ${title}`, `<form class="building-form" data-template-form><label>Mã mẫu<input name="code" required maxlength="30" value="${escapeHtml(code)}"></label><label>Tên mẫu<input name="name" required maxlength="100" value="${escapeHtml(record.name)}"></label><label>Biến dữ liệu sử dụng<input name="variables" maxlength="300" value="${escapeHtml(record.variables || '')}" placeholder="Ví dụ: {{tenantName}}, {{amount}}, {{dueDate}}"></label><label>Nội dung mẫu<textarea name="content" required maxlength="12000" rows="12" placeholder="Nhập nội dung hoặc HTML mẫu">${escapeHtml(record.content || '')}</textarea></label><label class="inline-toggle">Dùng làm mẫu mặc định<input name="isDefault" type="checkbox" ${record.isDefault ? 'checked' : ''}><span></span></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu mẫu</button></div></form>`, () => {
        const formElement = document.querySelector('[data-template-form]');
        document.querySelector('[data-modal-cancel]').addEventListener('click', () => openTemplateManager(type));
        formElement.addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(formElement); const next = { ...record, code: form.get('code').trim(), name: form.get('name').trim(), variables: form.get('variables').trim(), content: form.get('content'), isDefault: form.get('isDefault') === 'on', updatedAt: new Date().toISOString() }; if (next.isDefault) records.forEach((item) => { item.isDefault = false; }); if (index >= 0) records[index] = next; else records.push(next); persistCatalogs(); openTemplateManager(type); showToast('Đã lưu mẫu biểu'); });
      });
    };
    document.querySelector('[data-template-add]').addEventListener('click', () => openForm());
    document.querySelectorAll('[data-template-edit]').forEach((button) => button.addEventListener('click', () => openForm(Number(button.dataset.templateEdit))));
    document.querySelectorAll('[data-template-delete]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.templateDelete); if (!confirmPermanentDeletion(`mẫu biểu "${records[index].name}"`, records[index].isDefault ? 'đây là mẫu đang được đặt làm mặc định' : 'mẫu sẽ bị xóa khỏi danh sách sử dụng')) return; records.splice(index, 1); persistCatalogs(); openTemplateManager(type); showToast('Đã xóa mẫu biểu'); }));
    document.querySelectorAll('[data-template-preview]').forEach((button) => button.addEventListener('click', () => { const record = records[Number(button.dataset.templatePreview)]; const preview = window.open('', '_blank', 'width=820,height=900'); preview.document.write(`<title>${escapeHtml(record.name)}</title><main style="font-family:Arial;padding:40px;color:#122a4c"><header style="border-bottom:2px solid #0649a6;padding-bottom:14px"><h1 style="color:#0649a6">PHÚ GIA LAND</h1><h2>${escapeHtml(record.name)}</h2></header><article style="white-space:pre-wrap;margin-top:24px">${escapeHtml(record.content)}</article></main>`); preview.document.close(); preview.print(); }));
  });
}

function openNotifications() {
  const items = notifications.length ? notifications.map((notification, index) => `<article class="notification-item"><span class="notification-dot"></span><div><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.message)}</p><small>${new Date(notification.createdAt).toLocaleString('vi-VN')}</small></div><button type="button" data-notification-read="${index}">${notification.read ? 'Đã đọc' : 'Đánh dấu đã đọc'}</button></article>`).join('') : '<p class="empty-state">Chưa có thông báo nào.</p>';
  openModal('Thông báo cư dân', `<div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-notification>＋ Tạo thông báo</button>`, () => {
    document.querySelector('[data-modal-add-notification]').addEventListener('click', () => openModal('Tạo thông báo', `<form class="building-form" data-notification-form><label>Người nhận<select name="recipientEmail"><option value="">Tất cả người thuê</option><option value="__managers__">Chỉ người quản lý</option>${users.filter((user) => user.role === 'tenant' && user.active !== false).map((user) => `<option value="${escapeHtml(user.email)}">${escapeHtml(user.name)} · ${escapeHtml(user.email)}</option>`).join('')}</select></label><label>Tiêu đề<input name="title" required maxlength="100"></label><label>Nội dung<textarea name="message" required maxlength="500"></textarea></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Gửi thông báo</button></div></form>`, () => {
      document.querySelector('[data-modal-cancel]').addEventListener('click', openNotifications);
      document.querySelector('[data-notification-form]').addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const recipient = form.get('recipientEmail'); const title = form.get('title').trim(); const message = form.get('message').trim(); notifications.unshift({ title, message, recipientEmail: recipient === '__managers__' ? '' : recipient, audience: recipient === '__managers__' ? 'managers' : recipient ? 'tenant' : 'all-tenants', createdAt: new Date().toISOString(), read: false }); persistCollection(notificationStorageKey, notifications); if (recipient && recipient !== '__managers__') sendPushNotification({ email: recipient, title, body: message }); if (!recipient) sendPushNotification({ audience: 'all-tenants', title, body: message }); openNotifications(); });
    }));
    document.querySelectorAll('[data-notification-read]').forEach((button) => button.addEventListener('click', () => { notifications[Number(button.dataset.notificationRead)].read = true; persistCollection(notificationStorageKey, notifications); openNotifications(); }));
  });
  document.querySelector('.notification-button b')?.remove();
}

function openFeedbackManager() {
  const categoryLabels = { repair: 'Sửa chữa', suggestion: 'Góp ý', complaint: 'Phản ánh dịch vụ', other: 'Khác' };
  const priorityLabels = { normal: 'Bình thường', high: 'Ưu tiên', urgent: 'Khẩn cấp' };
  const statusLabels = { new: 'Mới tiếp nhận', processing: 'Đang xử lý', completed: 'Đã hoàn tất' };
  const items = feedback.length ? feedback.map((item, index) => `<article class="modal-option feedback-manager-item"><div><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.tenantEmail)} · ${categoryLabels[item.category] || 'Khác'} · ${priorityLabels[item.priority] || 'Bình thường'} · ${new Date(item.createdAt).toLocaleString('vi-VN')}</small><p>${escapeHtml(item.message)}</p>${item.imageUrl ? `<a href="${escapeHtml(item.imageUrl)}" target="_blank" rel="noopener">Xem ảnh hiện trạng</a>` : ''}</div><select data-feedback-status="${index}">${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}" ${item.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></article>`).join('') : '<p class="empty-state">Chưa có phản ánh nào từ cư dân.</p>';
  const openCount = feedback.filter((item) => item.status !== 'completed').length;
  openModal('Yêu cầu cư dân', `<div class="entity-summary">Tổng phản ánh: <strong>${feedback.length}</strong> · Đang xử lý: <strong>${openCount}</strong></div><div class="modal-list">${items}</div>`, () => {
    document.querySelectorAll('[data-feedback-status]').forEach((select) => select.addEventListener('change', () => {
      feedback[Number(select.dataset.feedbackStatus)].status = select.value;
      persistCollection(feedbackStorageKey, feedback);
      showToast('Đã cập nhật trạng thái phản ánh');
    }));
  });
}

function openUserManager() {
  const roleLabels = { staff: 'Nhân viên', tenant: 'Người thuê' };
  const items = users.length ? users.map((user, index) => { const customer = customers.find((item) => item.accountId === user.id || (item.email && item.email === user.email)); return `<article class="modal-option"><div><span>${escapeHtml(user.name)}</span><small>${roleLabels[user.role] || 'Người dùng'} · ${escapeHtml(user.email)}${user.role === 'tenant' ? customer ? ` · KH: ${escapeHtml(customer.code || customer.name)}` : ' · Chưa liên kết khách hàng' : ''} · ${user.active === false ? 'Ngừng hoạt động' : 'Đang hoạt động'}</small></div><div class="catalog-actions"><button type="button" data-user-toggle="${index}">${user.active === false ? 'Bật' : 'Ngừng'}</button></div></article>`; }).join('') : '<p class="empty-state">Chưa có tài khoản nhân viên hoặc người thuê.</p>';
  openModal('Quản lý tài khoản', `<div class="entity-summary">Chủ có toàn quyền. Nhân viên không được xem lợi nhuận tổng và các thiết lập bảo mật.</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-user>＋ Tạo tài khoản</button>`, () => {
    document.querySelector('[data-modal-add-user]').addEventListener('click', () => openModal('Tạo tài khoản', `<form class="building-form" data-user-form><label>Loại tài khoản<select name="role"><option value="staff">Nhân viên</option><option value="tenant">Người thuê</option></select></label><label data-customer-field hidden>Khách hàng<select name="customerId"><option value="">Chọn khách hàng</option>${customers.filter((customer) => customer.status === 'renting' && !customer.accountId).map((customer) => `<option value="${escapeHtml(customer.id || '')}" data-name="${escapeHtml(customer.name)}" data-email="${escapeHtml(customer.email || '')}">${escapeHtml(customer.name)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ''}</option>`).join('')}</select></label><label>Họ và tên<input name="name" required maxlength="80"></label><label>Email đăng nhập<input name="email" type="email" required maxlength="120"></label><label>Mật khẩu ban đầu<input name="password" type="password" required minlength="8"></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Tạo tài khoản</button></div></form>`, () => {
      document.querySelector('[data-modal-cancel]').addEventListener('click', openUserManager);
      document.querySelector('[data-user-form] [name="role"]').addEventListener('change', (event) => { const customerField = document.querySelector('[data-customer-field]'); const customerSelect = customerField.querySelector('select'); customerField.hidden = event.target.value !== 'tenant'; customerSelect.required = event.target.value === 'tenant'; });
      document.querySelector('[data-user-form] [name="customerId"]').addEventListener('change', (event) => { const option = event.target.selectedOptions[0]; document.querySelector('[data-user-form] [name="name"]').value = option.dataset.name || ''; document.querySelector('[data-user-form] [name="email"]').value = option.dataset.email || ''; });
      document.querySelector('[data-user-form]').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const role = form.get('role'); const email = form.get('email').trim().toLowerCase(); if (users.some((user) => user.email === email)) { showToast('Email này đã tồn tại'); return; } const submitButton = event.currentTarget.querySelector('[type="submit"]'); submitButton.disabled = true; try { const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, customerId: form.get('customerId'), name: form.get('name').trim(), email, password: form.get('password') }) }); if (!response.ok) throw new Error(response.status === 409 ? 'Email này đã tồn tại' : response.status === 403 ? 'Chỉ Chủ được quản lý tài khoản' : 'Không thể tạo tài khoản'); const payload = await response.json(); users.push(payload.user); const customer = role === 'tenant' ? customers.find((item) => item.id === form.get('customerId')) : null; if (customer) { customer.email = email; customer.accountId = payload.user.id; persistCustomers(); } localStorage.setItem(userStorageKey, JSON.stringify(users)); openUserManager(); showToast(`Đã tạo tài khoản ${roleLabels[role].toLowerCase()}`); } catch (error) { submitButton.disabled = false; showToast(error.message); } });
    }));
    document.querySelectorAll('[data-user-toggle]').forEach((button) => button.addEventListener('click', () => { const user = users[Number(button.dataset.userToggle)]; user.active = user.active === false; persistCollection(userStorageKey, users); openUserManager(); }));
  });
}

async function exportData() {
  const response = await fetch(`${apiBaseUrl}/backup`);
  if (!response.ok) throw new Error('Không thể tạo bản sao trên máy chủ');
  const blob = await response.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `phu-gia-land-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Đã tải bản sao đầy đủ từ máy chủ');
}

async function importData(file) {
  if (!file || !/\.zip$/i.test(file.name)) { showToast('Chỉ hỗ trợ file backup .zip'); return; }
  if (!window.confirm('Khôi phục sẽ thay thế toàn bộ dữ liệu, ảnh, video và tài liệu hiện có trên máy chủ. Tiếp tục?')) return;
  try {
    const response = await fetch(`${apiBaseUrl}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archiveDataUrl: await fileToDataUrl(file) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Không thể khôi phục bản sao');
    localStorage.clear();
    showToast('Đã khôi phục dữ liệu trên máy chủ, trang sẽ tải lại');
    window.setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    showToast(error.message || 'File backup không hợp lệ');
  }
}

function collectLocalState(keys = stateKeys) {
  return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
}

function queueServerSync(key) {
  if (key) pendingSyncKeys.add(key);
  window.clearTimeout(syncTimeout);
  syncTimeout = window.setTimeout(() => syncToServer(false), 500);
}

async function syncToServer(showResult = true) {
  const keys = [...pendingSyncKeys];
  if (!keys.length) return;
  pendingSyncKeys.clear();
  try {
    const response = await fetch(`${apiBaseUrl}/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: collectLocalState(keys) }) });
    if (!response.ok) throw new Error('Sync failed');
    if (showResult) showToast('Đã đồng bộ dữ liệu lên máy chủ');
  } catch (error) {
    keys.forEach((key) => pendingSyncKeys.add(key));
    if (showResult) showToast('Không kết nối được máy chủ API');
  }
}

async function pullFromServer() {
  try {
    const response = await fetch(`${apiBaseUrl}/state`);
    if (!response.ok) throw new Error('Pull failed');
    const payload = await response.json();
    if (!payload.state || !window.confirm('Tải dữ liệu máy chủ và thay dữ liệu hiện tại?')) return;
    Object.entries(payload.state).forEach(([key, value]) => localStorage.setItem(key, value));
    showToast('Đã tải dữ liệu máy chủ, trang sẽ tải lại');
    window.setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    showToast('Không tải được dữ liệu từ máy chủ');
  }
}

async function hydrateFromServer() {
  try {
    const response = await fetch(`${apiBaseUrl}/state`);
    if (!response.ok) return;
    const payload = await response.json();
    const remoteState = payload.state || {};
    if (!Object.keys(remoteState).length) {
      localStorage.clear();
      return;
    }
    const hasChanges = Object.entries(remoteState).some(([key, value]) => stateKeys.includes(key) && localStorage.getItem(key) !== value);
    if (!hasChanges) {
      sessionStorage.removeItem(hydrationReloadKey);
      return;
    }
    Object.entries(remoteState).forEach(([key, value]) => {
      if (!stateKeys.includes(key)) return;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    if (sessionStorage.getItem(hydrationReloadKey)) return;
    sessionStorage.setItem(hydrationReloadKey, 'true');
    window.location.reload();
  } catch (error) {
    console.warn('Không thể tải dữ liệu máy chủ:', error);
  }
}

function openAdminPasswordForm(required = false) {
  passwordChangeRequired = required;
  openModal(required ? 'Đổi mật khẩu bắt buộc' : 'Đổi mật khẩu quản trị viên', `<form class="building-form" data-admin-password-form><p class="entity-summary">${required ? 'Tài khoản đang dùng mật khẩu mặc định. Hãy đặt mật khẩu mới để tiếp tục.' : ''}</p><label>Mật khẩu hiện tại<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>Mật khẩu mới<input name="newPassword" type="password" required minlength="12" autocomplete="new-password"></label><label>Xác nhận mật khẩu mới<input name="confirmPassword" type="password" required minlength="12" autocomplete="new-password"></label><div class="form-actions">${required ? '' : '<button class="modal-secondary" type="button" data-modal-cancel>Hủy</button>'}<button class="primary-button" type="submit">Cập nhật mật khẩu</button></div></form>`, () => {
    document.querySelector('[data-modal-cancel]')?.addEventListener('click', openProfile);
    document.querySelector('[data-admin-password-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const newPassword = String(form.get('newPassword') || '');
      if (newPassword !== String(form.get('confirmPassword') || '')) { showToast('Xác nhận mật khẩu mới không khớp'); return; }
      const button = event.currentTarget.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const response = await fetch('/api/admin-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.get('currentPassword'), newPassword }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Không thể đổi mật khẩu');
        passwordChangeRequired = false;
        closeModal();
        const url = new URL(window.location.href);
        url.searchParams.delete('change-password');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        showToast('Đã đổi mật khẩu quản trị viên');
      } catch (error) {
        button.disabled = false;
        showToast(error.message);
      }
    });
  });
}

function openInvoiceSettings() {
  const settings = resolveInvoiceSettings(buildings[selectedBuildingIndex] || {});
  openModal('Mẫu hóa đơn chung', `<form class="building-form" data-invoice-settings-form>
    <p class="entity-summary">Thông tin này dùng chung cho toàn bộ hóa đơn PDF và ảnh của tất cả tòa nhà.</p>
    <label>Tên đơn vị<input name="companyName" required maxlength="120" value="${escapeHtml(settings.companyName)}" placeholder="Ví dụ: Công ty TNHH Phú Gia Land"></label>
    <label>Logo hóa đơn<input name="invoiceLogo" type="file" accept="image/jpeg,image/png,image/webp"><small class="form-hint">Chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB. Logo hiện tại: ${escapeHtml(settings.invoiceLogoUrl)}</small></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu mẫu chung</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', openProfile);
    document.querySelector('[data-invoice-settings-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const logoFile = form.get('invoiceLogo');
      if (logoFile?.size > 5_000_000) { showToast('Logo tối đa 5 MB'); return; }
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        const uploadedLogo = logoFile?.size ? await uploadPropertyMedia(logoFile, { code: 'SYSTEM' }, 'INVOICE-LOGO', 1) : null;
        invoiceSettings = { companyName: String(form.get('companyName') || '').trim(), invoiceLogoUrl: uploadedLogo?.url || settings.invoiceLogoUrl || 'assets/Logo BPG.jpg' };
        persistCollection(invoiceSettingsStorageKey, invoiceSettings);
        openProfile();
        showToast(uploadedLogo ? 'Đã tải logo và lưu mẫu hóa đơn chung' : 'Đã lưu mẫu hóa đơn chung');
      } catch (error) {
        submitButton.disabled = false;
        showToast(error.message || 'Không thể tải logo hóa đơn');
      }
    });
  });
}

function openProfile() {
  if (currentUserRole === 'staff') {
    const name = currentUserName || 'Nhân viên';
    const initials = name.split(/\s+/).map((part) => part[0]).slice(-3).join('').toUpperCase();
    openModal('Tài khoản', `<div class="profile-summary"><span class="avatar large">${escapeHtml(initials)}</span><div><strong>${escapeHtml(name)}</strong><small>Nhân viên</small></div></div><div class="profile-actions profile-actions-grouped"><button type="button" class="profile-logout" data-logout>Đăng xuất</button></div>`, () => {
      document.querySelector('[data-logout]').addEventListener('click', async () => { await fetch(`${apiBaseUrl}/logout`, { method: 'POST' }); sessionStorage.removeItem('nvp-user-role'); sessionStorage.removeItem('nvp-user-name'); window.location.assign('/login.html'); });
    });
    return;
  }
  const profile = readStorage('nvp-manager-profile', { name: 'Nguyễn Hữu Phú', title: 'Chủ nhà' });
  const initials = profile.name.split(/\s+/).map((part) => part[0]).slice(-3).join('').toUpperCase();
  openModal('Tài khoản & hệ thống', `<div class="profile-summary"><span class="avatar large">${escapeHtml(initials)}</span><div><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.title)}</small></div></div><div class="profile-actions profile-actions-grouped"><section><p>Vận hành</p><button type="button" data-invoice-settings>Mẫu hóa đơn chung</button><button type="button" data-smart-home-settings>Thiết lập API Smart Home</button><button type="button" data-profile-action>Thông tin cá nhân</button><button type="button" data-install-app ${pwaInstalled ? 'disabled' : ''}>${pwaInstalled ? 'Ứng dụng đã được cài đặt' : 'Cài đặt ứng dụng'}</button></section><section><p>Bảo mật</p><button type="button" data-change-admin-password>Đổi mật khẩu</button></section><details class="profile-recovery"><summary>Sao lưu và khôi phục</summary><button type="button" data-export-data>Xuất bản sao dữ liệu</button><label class="profile-file">Nhập bản sao dữ liệu<input type="file" accept="application/json" data-import-data></label><button type="button" data-reset-data>Xóa toàn bộ dữ liệu</button></details><button type="button" class="profile-logout" data-logout>Đăng xuất</button></div>`, () => {
    document.querySelector('[data-invoice-settings]').addEventListener('click', openInvoiceSettings);
    document.querySelector('[data-smart-home-settings]').addEventListener('click', openSmartHomeSettings);
    document.querySelector('[data-profile-action]').addEventListener('click', () => openModal('Thông tin cá nhân', `<form class="building-form" data-manager-profile-form><label>Họ và tên<input name="name" required maxlength="80" value="${escapeHtml(profile.name)}"></label><label>Vai trò<input name="title" required maxlength="50" value="${escapeHtml(profile.title)}"></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu thông tin</button></div></form>`, () => {
      document.querySelector('[data-modal-cancel]').addEventListener('click', openProfile);
      document.querySelector('[data-manager-profile-form]').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        localStorage.setItem('nvp-manager-profile', JSON.stringify({ name: String(form.get('name')).trim(), title: String(form.get('title')).trim() }));
        openProfile();
        showToast('Đã cập nhật thông tin cá nhân');
      });
    }));
    document.querySelector('[data-change-admin-password]').addEventListener('click', () => openAdminPasswordForm());
    document.querySelector('[data-install-app]').addEventListener('click', installApp);
    document.querySelector('[data-export-data]').addEventListener('click', () => exportData().catch((error) => showToast(error.message || 'Không thể tạo bản sao')));
    document.querySelector('[data-import-data]').setAttribute('accept', '.zip,application/zip');
    document.querySelector('[data-import-data]').addEventListener('change', (event) => event.target.files[0] && importData(event.target.files[0]));
    document.querySelector('[data-reset-data]').addEventListener('click', async () => {
      if (!confirmPermanentDeletion('toàn bộ dữ liệu hệ thống', 'tất cả tòa nhà, phòng, khách thuê, booking, hóa đơn, tài liệu và cấu hình sẽ bị xóa')) return;
      const resetButton = document.querySelector('[data-reset-data]');
      resetButton.disabled = true;
      resetButton.textContent = 'Đang xóa dữ liệu...';
      try {
        window.clearTimeout(syncTimeout);
        localStorage.clear();
        const response = await fetch(`${apiBaseUrl}/state`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Reset failed');
        await fetch(`${apiBaseUrl}/logout`, { method: 'POST' });
        window.location.assign('/login.html');
      } catch (error) {
        resetButton.disabled = false;
        resetButton.textContent = 'Xóa toàn bộ dữ liệu';
        showToast('Không thể xóa dữ liệu trên máy chủ');
      }
    });
    document.querySelector('[data-logout]').addEventListener('click', async () => {
      await fetch(`${apiBaseUrl}/logout`, { method: 'POST' });
      sessionStorage.removeItem('nvp-user-role');
      sessionStorage.removeItem('nvp-user-name');
      window.location.assign('/login.html');
    });
  });
}

async function openSmartHomeSettings() {
  try {
    const response = await fetch(`${apiBaseUrl}/smart-home/config`);
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || 'Không thể tải cấu hình Smart Home');
    openModal('Thiết lập Tuya Cloud', `<form class="building-form" data-smart-home-config-form><p class="entity-summary">Kết nối dự án Tuya Singapore để nhận chỉ số điện của công tơ.</p><label>Tuya Access ID<input name="tuyaAccessId" required value="${escapeHtml(config.tuyaAccessId)}" autocomplete="off"></label><label>Tuya Access Secret<input name="tuyaAccessSecret" type="password" autocomplete="new-password" placeholder="${config.tuyaSecretSet ? 'Đã lưu, để trống để giữ nguyên' : 'Nhập Access Secret'}"></label><label>Tuya OpenAPI endpoint<input name="tuyaEndpoint" type="url" required value="${escapeHtml(config.tuyaEndpoint)}"></label><label>Tuya Message Queue endpoint<input name="tuyaMqEndpoint" type="url" required value="${escapeHtml(config.tuyaMqEndpoint)}"></label><label>Tuya Device IDs công tơ<textarea name="tuyaDeviceIds" rows="3" placeholder="Mỗi Device ID một dòng hoặc ngăn cách bằng dấu phẩy">${escapeHtml(config.tuyaDeviceIds)}</textarea><small class="form-hint">Sao chép Device ID từ tab Devices của Tuya. Chỉ các ID này mới hiện trong mục Chọn công tơ.</small></label><label>MQ topic<input name="tuyaTopic" value="${escapeHtml(config.tuyaTopic)}" placeholder="Lấy từ Tuya Message Service"></label><label>MQ token<input name="tuyaMqToken" type="password" autocomplete="new-password" placeholder="${config.tuyaMqTokenSet ? 'Đã lưu, để trống để giữ nguyên' : 'Lấy từ Tuya Message Service'}"></label><label>Tên subscription<input name="tuyaSubscription" required value="${escapeHtml(config.tuyaSubscription)}"></label><label>Endpoint nhận dữ liệu<input value="${escapeHtml(`${window.location.origin}${config.endpoint}`)}" readonly></label><label>Token nhận dữ liệu<input name="pushToken" type="password" minlength="16" autocomplete="new-password" placeholder="${config.tokenSet ? 'Đã lưu, để trống để giữ nguyên' : 'Tối thiểu 16 ký tự'}"></label><div class="form-actions"><button type="button" class="modal-secondary" data-generate-smart-token>Tạo token</button><button type="button" class="modal-secondary" data-modal-cancel>Hủy</button><button type="submit" class="primary-button">Lưu cấu hình</button></div></form>`, () => {
      const configForm = document.querySelector('[data-smart-home-config-form]');
      const endpointField = configForm.elements.tuyaEndpoint;
      const dataCenterSelect = document.createElement('select');
      dataCenterSelect.name = 'tuyaDataCenter';
      dataCenterSelect.required = true;
      dataCenterSelect.innerHTML = config.tuyaDataCenters.map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === config.tuyaDataCenter ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
      endpointField.parentElement.firstChild.textContent = 'Tuya Data Center';
      endpointField.replaceWith(dataCenterSelect);
      configForm.elements.tuyaAccessSecret.required = !config.tuyaSecretSet;
      configForm.querySelectorAll('label').forEach((label) => {
        const field = label.querySelector('input, textarea, select');
        if (!['tuyaAccessId', 'tuyaAccessSecret', 'tuyaDataCenter', 'tuyaDeviceIds'].includes(field?.name)) label.remove();
      });
      configForm.querySelector('[data-generate-smart-token]')?.remove();
      configForm.querySelector('.entity-summary').textContent = 'Chọn đúng Data Center của Cloud Project, nhập khóa truy cập, sau đó kiểm tra để chọn công tơ.';
      const deviceIdsField = configForm.elements.tuyaDeviceIds;
      deviceIdsField.parentElement.querySelector('.form-hint').textContent = 'Có thể dò tự động hoặc nhập Device ID thủ công, mỗi ID một dòng.';
      const actions = configForm.querySelector('.form-actions');
      actions.insertAdjacentHTML('beforebegin', '<div class="modal-list" data-tuya-device-results><p class="empty-state">Chưa kiểm tra kết nối.</p></div>');
      actions.insertAdjacentHTML('afterbegin', '<button type="button" class="modal-secondary" data-test-tuya>Kiểm tra và dò thiết bị</button>');
      configForm.querySelector('[type="submit"]').textContent = 'Lưu cấu hình';
      document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
      configForm.querySelector('[data-test-tuya]').addEventListener('click', async (event) => {
        if (!configForm.reportValidity()) return;
        const button = event.currentTarget;
        const results = configForm.querySelector('[data-tuya-device-results]');
        button.disabled = true;
        button.textContent = 'Đang kết nối...';
        results.innerHTML = '<p class="empty-state">Đang kiểm tra Tuya Cloud và dò thiết bị...</p>';
        try {
          const formData = new FormData(configForm);
          const testResponse = await fetch(`${apiBaseUrl}/smart-home/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(formData)) });
          const payload = await testResponse.json();
          if (!testResponse.ok) throw new Error(payload.error || 'Không thể kết nối Tuya Cloud');
          const selectedIds = new Set(String(deviceIdsField.value || '').split(/[\s,]+/).filter(Boolean));
          results.innerHTML = payload.meters.length
            ? `<div class="entity-summary">Kết nối thành công · Tìm thấy <strong>${payload.meters.length}</strong> thiết bị.</div>${payload.meters.map((meter) => `<label class="modal-option"><input type="checkbox" data-tuya-device value="${escapeHtml(meter.meterId)}" ${selectedIds.has(meter.meterId) ? 'checked' : ''}><span><strong>${escapeHtml(meter.name || 'Thiết bị Tuya')}</strong><small>${escapeHtml(meter.meterId)}</small></span></label>`).join('')}`
            : '<p class="empty-state">Kết nối thành công nhưng chưa tìm thấy thiết bị. Hãy liên kết tài khoản Tuya Smart/Smart Life với Cloud Project.</p>';
          results.querySelectorAll('[data-tuya-device]').forEach((checkbox) => checkbox.addEventListener('change', () => {
            deviceIdsField.value = [...results.querySelectorAll('[data-tuya-device]:checked')].map((item) => item.value).join('\n');
          }));
        } catch (error) {
          results.innerHTML = `<p class="empty-state">${escapeHtml(error.message || 'Không thể kết nối Tuya Cloud')}</p>`;
        } finally {
          button.disabled = false;
          button.textContent = 'Kiểm tra và dò thiết bị';
        }
      });
      document.querySelector('[data-smart-home-config-form]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const formData = new FormData(event.currentTarget);
          const saveResponse = await fetch(`${apiBaseUrl}/smart-home/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(formData)) });
          const payload = await saveResponse.json();
          if (!saveResponse.ok) throw new Error(payload.error || 'Không thể lưu cấu hình');
          closeModal();
          showToast('Đã lưu cấu hình Tuya Cloud');
        } catch (error) {
          button.disabled = false;
          showToast(error.message || 'Không thể lưu cấu hình Smart Home');
        }
      });
    });
  } catch (error) {
    showToast(error.message || 'Không thể tải cấu hình Smart Home');
  }
}

document.querySelectorAll('[data-accordion]').forEach((trigger) => trigger.addEventListener('click', () => {
  const key = trigger.dataset.accordion;
  const submenu = document.querySelector(`[data-submenu="${key}"]`);
  const isOpen = trigger.classList.toggle('open');
  trigger.setAttribute('aria-expanded', String(isOpen));
  submenu?.classList.toggle('open', isOpen);
}));

document.querySelectorAll('[data-nav-link]').forEach((link) => link.addEventListener('click', () => {
  document.querySelectorAll('[data-nav-link]').forEach((item) => item.classList.remove('active'));
  link.classList.add('active');
  closeMobileSidebar();
}));

document.querySelectorAll('.sidebar a[href^="#"], .panel a[href^="#"], .footer a[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
  const target = link.getAttribute('href').slice(1);
  if (document.getElementById(target)) return;
  event.preventDefault();
  closeMobileSidebar();
  const ownerOnlyTargets = new Set(['finance', 'cashflow', 'cashflow-report', 'commission', 'profit', 'debts', 'deposit-ledger', 'general', 'users']);
  if (currentUserRole !== 'owner' && ownerOnlyTargets.has(target)) { showToast('Chỉ Chủ được truy cập mục này'); return; }
  if (target === 'buildings') {
    openBuildingManager();
    return;
  }
  if (target === 'layout') {
    openApartmentBuildingPicker();
    return;
  }
  if (target === 'customers' || target === 'residents') {
    openCustomerManager();
    return;
  }
  if (target === 'booking') {
    openBookingManager();
    return;
  }
  if (target === 'deposits' || target === 'reservations') {
    openWorkflowManager('reservations');
    return;
  }
  if (target === 'finance') {
    openCashflowManager();
    return;
  }
  if (target === 'locations') {
    openLocationManager();
    return;
  }
  if (target === 'meters') {
    openMeterManager();
    return;
  }
  if (target === 'utilities') {
    openUtilityManager();
    return;
  }
  if (target === 'commission') {
    openCommissionManager();
    return;
  }
  if (target === 'deposit-ledger') {
    openDepositSummary();
    return;
  }
  if (target === 'payments') {
    openPaymentSchedule();
    return;
  }
  if (target === 'profit' || target === 'debts') {
    openFinancialReport(target);
    return;
  }
  if (target === 'tasks') {
    openTaskManager();
    return;
  }
  if (target === 'invoices') {
    openInvoiceManager();
    return;
  }
  if (target === 'cashflow' || target === 'cashflow-report') {
    openCashflowManager();
    return;
  }
  if (target === 'occupancy' || target === 'empty' || target === 'depositing') {
    openPropertyReport(target);
    return;
  }
  if (target === 'notifications') {
    openNotifications();
    return;
  }
  if (target === 'feedback') {
    openFeedbackManager();
    return;
  }
  if (target === 'general') {
    openProfile();
    return;
  }
  if (Object.prototype.hasOwnProperty.call(catalogConfigs, target)) {
    ['signatures', 'deposit-contract', 'handover', 'invoice-template', 'cash-template'].includes(target) ? openTemplateManager(target) : ['assets', 'providers', 'warehouses', 'asset-types', 'moving-logs', 'asset-fix'].includes(target) ? openAssetOperations(target) : openCatalogManager(target);
    return;
  }
  if (target === 'users') {
    openUserManager();
    return;
  }
  showToast(`${link.textContent.trim()} sẽ được mở trong phân hệ riêng`);
}));

document.querySelector('[data-sidebar-collapse]')?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
document.querySelector('[data-sidebar-open]')?.addEventListener('click', () => {
  sidebar.classList.add('mobile-open');
  overlay.classList.add('show');
});

function closeMobileSidebar() {
  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('show');
}

overlay.addEventListener('click', closeMobileSidebar);
document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
  const dark = root.classList.toggle('dark');
  localStorage.setItem('nvp-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1730' : '#0649a6');
});

if (localStorage.getItem('nvp-theme') === 'dark' || (!localStorage.getItem('nvp-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) root.classList.add('dark');
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', root.classList.contains('dark') ? '#0b1730' : '#0649a6');
synchronizeRentedApartments();
reconcileBookingInvoices();
if (buildings.length) {
  selectedBuildingIndex = Math.min(selectedBuildingIndex, buildings.length - 1);
  buildingSelect.firstChild.textContent = buildings[selectedBuildingIndex].name;
  persistBuildings(false);
}
updateDashboard();
fetch(`${apiBaseUrl}/session`).then(async (response) => {
  if (!response.ok) { window.location.assign('/login.html'); return; }
  const session = await response.json();
  const hadSensitiveData = session.role === 'staff' && staffSensitiveStorageKeys.some((key) => localStorage.getItem(key) !== null);
  currentUserRole = session.role;
  const ownerProfile = readStorage('nvp-manager-profile', { name: 'Nguyễn Hữu Phú' });
  currentUserName = session.role === 'owner' ? ownerProfile.name : session.name || 'Nhân viên';
  sessionStorage.setItem('nvp-user-role', currentUserRole);
  sessionStorage.setItem('nvp-user-name', currentUserName);
  document.body.classList.remove('role-pending', 'role-owner', 'role-staff');
  document.body.classList.add(`role-${currentUserRole}`);
  document.querySelector('[data-profile] strong').textContent = currentUserName;
  document.querySelector('[data-profile] small').textContent = currentUserRole === 'owner' ? 'Chủ nhà' : 'Nhân viên';
  if (hadSensitiveData) { staffSensitiveStorageKeys.forEach((key) => localStorage.removeItem(key)); window.location.reload(); return; }
  await hydrateFromServer();
  if (session.passwordChangeRequired) openAdminPasswordForm(true);
  else if (new URLSearchParams(window.location.search).get('change-password') === 'required') window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
}).catch(() => window.location.assign('/login.html'));

buildingSelect?.addEventListener('click', renderBuildingPicker);
document.querySelector('.asset-stats a[href="#buildings"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  openBuildingManager();
});
document.querySelector('.asset-stats a[href="#apartments"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  openApartmentBuildingPicker();
});
document.querySelector('.asset-stats a[href="#beds"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  openBedManager();
});
document.querySelector('[data-add-building]')?.addEventListener('click', openBuildingForm);
document.querySelector('[data-notifications]')?.addEventListener('click', openNotifications);
document.querySelector('[data-profile]')?.addEventListener('click', openProfile);
document.querySelectorAll('[data-toast]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));
document.querySelector('[data-modal-close]')?.addEventListener('click', closeModal);
modalBackdrop?.addEventListener('click', (event) => {
  if (event.target === modalBackdrop) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (modalBackdrop.hidden) return;
  if (event.key === 'Escape') {
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...modalBackdrop.querySelectorAll('button, input, select, [href], [tabindex]:not([tabindex="-1"])')].filter((element) => !element.disabled);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js?v=63').then((registration) => registration.update()).catch((error) => console.warn('Service worker registration failed:', error)));
}
