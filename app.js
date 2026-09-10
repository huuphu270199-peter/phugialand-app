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
const contractStorageKey = 'nvp-contracts';
const taskStorageKey = 'nvp-tasks';
const invoiceStorageKey = 'nvp-invoices';
const cashflowStorageKey = 'nvp-cashflow';
const catalogStorageKey = 'nvp-catalogs';
const customerStorageKey = 'nvp-customers';
const bookingStorageKey = 'nvp-bookings';
const locationStorageKey = 'nvp-locations';
const meterLogStorageKey = 'nvp-meter-logs';
const commissionStorageKey = 'nvp-commissions';
const prepaymentStorageKey = 'nvp-prepayments';
const depositLedgerStorageKey = 'nvp-deposit-ledger';
const notificationStorageKey = 'nvp-notifications';
const userStorageKey = 'nvp-users';
const feedbackStorageKey = 'nvp-feedback';
const hydrationReloadKey = 'nvp-hydration-reload-pending';
const apiBaseUrl = '/api';
const stateKeys = [storageKey, selectionKey, leadStorageKey, reservationStorageKey, contractStorageKey, taskStorageKey, invoiceStorageKey, cashflowStorageKey, catalogStorageKey, customerStorageKey, bookingStorageKey, locationStorageKey, meterLogStorageKey, commissionStorageKey, prepaymentStorageKey, depositLedgerStorageKey, notificationStorageKey, userStorageKey, feedbackStorageKey];
let syncTimeout;
let administrativeUnitsPromise;
let passwordChangeRequired = false;
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

async function getAdministrativeUnits() {
  administrativeUnitsPromise ||= fetch('/api/administrative-units').then((response) => {
    if (!response.ok) throw new Error('Administrative data unavailable');
    return response.json();
  });
  return administrativeUnitsPromise;
}

async function setupAdministrativeFields(form, selectedCity, selectedWard) {
  const citySelect = form.querySelector('[data-location-city]');
  const wardInput = form.querySelector('[data-location-ward]');
  const wardList = form.querySelector('[data-location-ward-list]');
  try {
    const provinces = await getAdministrativeUnits();
    const renderWards = () => {
      const province = provinces.find((item) => item.name === citySelect.value);
      const wards = province?.wards || [];
      wardInput.disabled = !wards.length;
      wardInput.value = selectedWard;
      wardInput.placeholder = wards.length ? 'Gõ để tìm xã/phường' : 'Chọn tỉnh/thành phố trước';
      wardList.innerHTML = wards.map((ward) => `<option value="${escapeHtml(ward.name)}"></option>`).join('');
      wardInput.dataset.availableWards = JSON.stringify(wards.map((ward) => ward.name));
    };
    citySelect.innerHTML = `<option value="">Chọn tỉnh/thành phố</option>${provinces.map((province) => `<option value="${escapeHtml(province.name)}" ${province.name === selectedCity ? 'selected' : ''}>${escapeHtml(province.name)}</option>`).join('')}`;
    renderWards();
    citySelect.addEventListener('change', () => { selectedWard = ''; renderWards(); });
    wardInput.addEventListener('input', () => {
      const wards = JSON.parse(wardInput.dataset.availableWards || '[]');
      wardInput.setCustomValidity(!wardInput.value || wards.includes(wardInput.value) ? '' : 'Vui lòng chọn xã/phường trong danh sách gợi ý');
    });
  } catch (error) {
    citySelect.innerHTML = '<option value="">Không thể tải tỉnh/thành phố</option>';
    wardInput.placeholder = 'Không thể tải xã/phường';
    wardInput.disabled = true;
  }
}

const buildings = readStorage(storageKey, []).map((building) => ({
  ...building,
  apartments: Array.isArray(building.apartments)
    ? building.apartments
    : Array.from({ length: Number(building.apartments) || 0 }, (_, index) => ({ name: `Căn ${index + 1}`, beds: 0, status: 'empty' }))
}));
let selectedBuildingIndex = Math.min(Number(localStorage.getItem(selectionKey) || 0), Math.max(buildings.length - 1, 0));
const leads = readStorage(leadStorageKey, []);
const reservations = readStorage(reservationStorageKey, []);
const contracts = readStorage(contractStorageKey, []);
const tasks = readStorage(taskStorageKey, []);
const invoices = readStorage(invoiceStorageKey, []);
const cashflow = readStorage(cashflowStorageKey, []);
const catalogs = readStorage(catalogStorageKey, {});
const customers = readStorage(customerStorageKey, []);
const bookings = readStorage(bookingStorageKey, []);
const locations = readStorage(locationStorageKey, []);
const meterLogs = readStorage(meterLogStorageKey, []);
const commissions = readStorage(commissionStorageKey, []);
const prepayments = readStorage(prepaymentStorageKey, []);
const depositLedger = readStorage(depositLedgerStorageKey, []);
const notifications = readStorage(notificationStorageKey, []);
const users = readStorage(userStorageKey, []);
const feedback = readStorage(feedbackStorageKey, []);

async function sendPushNotification(payload) {
  try { await fetch('/api/push-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (error) { console.warn('Push notification failed:', error); }
}
const propertyTypes = {
  apartment: 'Căn hộ',
  office: 'Văn phòng',
  shophouse: 'Shophouse',
  'whole-building': 'Tòa nhà nguyên căn'
};
const catalogConfigs = {
  vehicles: ['Phương tiện', 'Biển số hoặc tên phương tiện'],
  meters: ['Ghi chỉ số', 'Tên căn hộ hoặc đồng hồ'],
  commission: ['Hoa hồng', 'Tên giao dịch hoặc nhân viên'],
  daily: ['Tài khoản theo ngày', 'Tên khoản mục'],
  profit: ['Phân bổ lợi nhuận', 'Tên khoản phân bổ'],
  debts: ['Khách nợ tiền', 'Tên khách hàng'],
  payments: ['Lịch thanh toán', 'Tên lịch thanh toán'],
  assets: ['Tài sản', 'Tên tài sản'],
  hotline: ['Quản lý hotline', 'Tên liên hệ'],
  'work-types': ['Loại công việc', 'Tên loại công việc'],
  categories: ['Danh mục chung', 'Tên danh mục'],
  floors: ['Danh sách tầng', 'Tên tầng'],
  signatures: ['Mẫu chữ ký', 'Tên mẫu chữ ký'],
  'deposit-contract': ['Mẫu hợp đồng đặt cọc', 'Tên mẫu'],
  'rental-contract': ['Mẫu hợp đồng thuê', 'Tên mẫu'],
  handover: ['Mẫu biên bản bàn giao', 'Tên mẫu'],
  'invoice-template': ['Mẫu hóa đơn', 'Tên mẫu'],
  'cash-template': ['Mẫu thu chi', 'Tên mẫu'],
  accounts: ['Loại tài khoản', 'Tên loại tài khoản'],
  users: ['Người dùng', 'Họ tên người dùng']
  , providers: ['Nhà cung cấp', 'Tên nhà cung cấp']
  , warehouses: ['Kho tài sản', 'Tên kho tài sản']
  , 'asset-types': ['Loại tài sản', 'Tên loại tài sản']
  , 'moving-logs': ['Lịch sử di chuyển tài sản', 'Tên tài sản hoặc mã tài sản']
  , 'asset-fix': ['Lịch sử sửa chữa', 'Tên tài sản hoặc hạng mục sửa chữa']
  , 'finance-settings': ['Tài chính', 'Tên cấu hình tài chính']
  , accounts: ['Tài khoản', 'Tên tài khoản thu/chi']
  , 'debt-accounts': ['Gạch nợ tự động', 'Tên cấu hình gạch nợ']
  , 'einvoice': ['Hóa đơn điện tử', 'Tên cấu hình hóa đơn điện tử']
  , 'income-types': ['Loại thu chi', 'Tên loại thu/chi']
  , 'service-quota': ['Định mức dịch vụ', 'Tên định mức dịch vụ']
  , 'meter-types': ['Đồng hồ công tơ', 'Tên loại đồng hồ']
};
let deferredInstallPrompt;
let lastFocusedElement;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

function showToast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toastBox.classList.remove('show'), 2600);
}

function openModal(title, content, onReady) {
  lastFocusedElement = document.activeElement;
  modalBackdrop.querySelector('[data-modal]').classList.remove('modal-wide', 'utility-modal', 'building-form-modal');
  modalTitle.textContent = title;
  modalContent.innerHTML = content;
  modalBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  onReady?.();
  modalBackdrop.querySelector('[data-modal-close]')?.focus();
}

function closeModal() {
  if (passwordChangeRequired) {
    showToast('Bạn cần đổi mật khẩu mặc định để tiếp tục');
    return;
  }
  modalBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
  lastFocusedElement?.focus();
}

async function installApp() {
  if (!deferredInstallPrompt) {
    showToast('Trình duyệt chưa hỗ trợ cài đặt PWA lúc này');
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  showToast(choice.outcome === 'accepted' ? 'Đã bắt đầu cài đặt ứng dụng' : 'Đã hủy cài đặt ứng dụng');
}

function persistBuildings(sync = true) {
  localStorage.setItem(storageKey, JSON.stringify(buildings));
  if (buildingCount) buildingCount.textContent = buildings.length;
  updateDashboard();
  if (sync) queueServerSync();
}

function updateDashboard() {
  const apartments = buildings[selectedBuildingIndex]?.apartments || [];
  const beds = apartments.reduce((total, apartment) => total + Number(apartment.beds || 0), 0);
  const apartmentStatus = ['rented', 'reserved', 'empty', 'inactive'];
  const apartmentCounts = apartmentStatus.map((status) => apartments.filter((apartment) => apartment.status === status).length);
  const bedCounts = apartmentStatus.map((status) => apartments.filter((apartment) => apartment.status === status).reduce((total, apartment) => total + Number(apartment.beds || 0), 0));
  if (apartmentCount) apartmentCount.textContent = apartments.length;
  if (bedCount) bedCount.textContent = beds;
  const apartmentCells = document.querySelectorAll('.status-row')[0]?.querySelectorAll('.status-cell') || [];
  const bedCells = document.querySelectorAll('.status-row')[1]?.querySelectorAll('.status-cell') || [];
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
  const invoiceTotal = invoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const amountElement = document.querySelector('.amount');
  if (amountElement) amountElement.firstChild.textContent = `${invoiceTotal.toLocaleString('vi-VN')} đ `;
  const income = cashflow.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const expense = cashflow.filter((entry) => entry.type === 'expense').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
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
  if (reservationMetrics[1]) reservationMetrics[1].textContent = contracts.length;
  const contractPanel = document.querySelector('.grid-three > .panel:nth-child(3)');
  if (contractPanel) {
    const values = contractPanel.querySelectorAll('.contract-body > p b');
    if (values[0]) values[0].textContent = contracts.length;
    if (values[1]) values[1].textContent = 0;
    const active = contractPanel.querySelector('.mini-stats span:first-child b');
    if (active) active.textContent = contracts.length;
  }
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
}

function selectBuilding(index) {
  selectedBuildingIndex = index;
  localStorage.setItem(selectionKey, String(index));
  const building = buildings[index];
  if (!building) return;
  buildingSelect.firstChild.textContent = building.name;
  persistBuildings();
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

function openBuildingForm(buildingToEdit = null) {
  const editIndex = buildingToEdit ? buildings.indexOf(buildingToEdit) : -1;
  const building = buildingToEdit || { services: [], settings: {}, apartments: [] };
  const services = building.services || [];
  const settings = building.settings || {};
  const serviceItems = services.length
    ? services.map((service, index) => `<div class="service-item"><div><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.feeType)} · ${escapeHtml(service.unitType)}</small></div><button type="button" data-service-delete="${index}" aria-label="Xóa dịch vụ">×</button></div>`).join('')
    : '<p class="empty-state">Chưa có dịch vụ nào</p>';
    openModal('Tòa nhà', `<form class="building-form building-form-wide" data-building-form>
    <section class="form-section"><div class="form-section-title"><strong>Thông tin cơ bản</strong><label class="inline-toggle">Hoạt động<input name="active" type="checkbox" ${building.active !== false ? 'checked' : ''}><span></span></label></div><div class="form-grid"><label>Tên tòa nhà <b>*</b><input name="name" required maxlength="80" value="${escapeHtml(building.name || '')}" placeholder="Ví dụ: Vạn Phúc Garden"></label><label>Tên viết tắt/Mã tòa <input name="code" maxlength="30" value="${escapeHtml(building.code || '')}" placeholder="Nhập mã viết tắt"></label><label>Loại hình khai thác<select name="listingType"><option value="mixed" ${!building.listingType || building.listingType === 'mixed' ? 'selected' : ''}>Nhiều loại hình trong tòa</option><option value="whole-building" ${building.listingType === 'whole-building' ? 'selected' : ''}>Tòa nhà nguyên căn</option></select></label></div></section>
    <section class="form-section"><div class="form-section-title"><strong>Thông tin địa chỉ</strong></div><div class="form-grid"><label>Tỉnh/Thành phố <b>*</b><select name="city" data-location-city required><option value="">Đang tải tỉnh/thành phố...</option></select></label><label>Xã/Phường <b>*</b><input name="ward" data-location-ward list="ward-options" autocomplete="off" required disabled placeholder="Chọn tỉnh/thành phố trước"><datalist id="ward-options" data-location-ward-list></datalist><small class="form-hint">Gõ tên xã hoặc phường để tìm nhanh.</small></label><label>Khu vực <input name="area" value="${escapeHtml(settings.area || '')}" placeholder="Ví dụ: KĐT Vạn Phúc"></label><label>Địa chỉ chi tiết <b>*</b><input name="address" required value="${escapeHtml(building.address || '')}" placeholder="Số nhà, đường, khu vực"></label></div></section>
    <section class="form-section"><div class="form-section-title"><strong>Ảnh/video tòa nhà</strong></div><label>Media nguyên căn<input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple><small class="form-hint">Dùng cho trường hợp cho thuê nguyên căn. Tối đa 5 ảnh và 1 video.</small></label></section>
    <section class="form-section"><div class="form-section-title"><strong>Dịch vụ tòa nhà</strong></div><div class="service-list">${serviceItems}</div><button class="service-add-button" type="button" data-service-add>＋ Thêm dịch vụ</button></section>
    <section class="form-section"><div class="form-section-title"><strong>Cấu hình thanh toán &amp; dịch vụ</strong></div><div class="form-grid"><label>Tài khoản gạch nợ tự động<select name="debtAccount"><option value="">Chọn</option><option ${settings.debtAccount === 'bank' ? 'selected' : ''} value="bank">Tài khoản ngân hàng</option><option ${settings.debtAccount === 'cash' ? 'selected' : ''} value="cash">Tài khoản tiền mặt</option></select></label><label>Ngày thanh toán hằng tháng<input name="paymentDay" type="number" min="1" max="31" value="${Number(settings.paymentDay || 5)}"></label><label>Ngân hàng nhận tiền<input name="bankName" maxlength="80" value="${escapeHtml(settings.bankName || '')}" placeholder="Ví dụ: MB Bank"></label><label>Mã BIN ngân hàng<input name="bankBin" inputmode="numeric" maxlength="12" value="${escapeHtml(settings.bankBin || '')}" placeholder="Ví dụ: 970422"></label><label>Số tài khoản<input name="bankNumber" inputmode="numeric" maxlength="30" value="${escapeHtml(settings.bankNumber || '')}" placeholder="Nhập số tài khoản"></label><label>Tên chủ tài khoản<input name="bankHolder" maxlength="100" value="${escapeHtml(settings.bankHolder || '')}" placeholder="Tên chủ tài khoản"></label><label>Đơn giá điện (đ/kWh)<input name="electricityRate" type="number" min="0" value="${Number(settings.electricityRate || 0)}"></label><label>Đơn giá nước (đ/khối)<input name="waterRate" type="number" min="0" value="${Number(settings.waterRate || 0)}"></label><label>Phí quản lý (đ/tháng)<input name="managementFee" type="number" min="0" value="${Number(settings.managementFee || 0)}"></label><label>Cấu hình hóa đơn điện tử<select name="eInvoice"><option value="default" ${settings.eInvoice !== 'disabled' ? 'selected' : ''}>Dùng cấu hình mặc định</option><option value="disabled" ${settings.eInvoice === 'disabled' ? 'selected' : ''}>Không sử dụng</option></select></label><label>Mẫu in hóa đơn<select name="invoiceTemplate"><option value="">Chọn</option><option value="default" ${settings.invoiceTemplate === 'default' ? 'selected' : ''}>Mẫu mặc định</option></select></label><label>Mẫu hợp đồng<select name="contractTemplate"><option value="">Chọn</option><option value="default" ${settings.contractTemplate === 'default' ? 'selected' : ''}>Mẫu mặc định</option></select></label></div></section>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy bỏ</button><button class="primary-button" type="submit">Lưu</button></div>
  </form>`, () => {
    document.querySelector('[data-modal]').classList.add('building-form-modal');
    const buildingForm = document.querySelector('[data-building-form]');
    const waterRateField = buildingForm.querySelector('[name="waterRate"]');
    const paymentDayField = buildingForm.querySelector('[name="paymentDay"]');
    buildingForm.querySelector('[name="listingType"]')?.closest('label').insertAdjacentHTML('afterend', `<label>Số tầng hoặc danh sách tầng<input name="floors" maxlength="300" value="${escapeHtml(getBuildingFloors(building).join(', '))}" placeholder="Ví dụ: 4 hoặc B1, 1, 2, 3, 4"><small class="form-hint">Nhập 4 để tạo tầng 1 đến tầng 4; nhập danh sách khi có tầng hầm hoặc tầng đặc biệt.</small></label>`);
    paymentDayField?.closest('label').insertAdjacentHTML('afterend', `<label>Tên công ty quản lý<input name="companyName" maxlength="120" value="${escapeHtml(settings.companyName || 'Phú Gia Land')}" placeholder="Ví dụ: Công ty TNHH Phú Gia Land"></label><label>Số điện thoại công ty<input name="companyPhone" maxlength="30" value="${escapeHtml(settings.companyPhone || '')}" placeholder="Ví dụ: 0981 444 413"></label>`);
    if (waterRateField) {
      waterRateField.closest('label').insertAdjacentHTML('afterend', `<label>Chế độ tiền nước<select name="waterBillingMode"><option value="metered" ${settings.waterBillingMode !== 'fixed' ? 'selected' : ''}>Theo m³</option><option value="fixed" ${settings.waterBillingMode === 'fixed' ? 'selected' : ''}>Mức cố định</option></select></label><label>Mức cố định mặc định (đ/tháng)<input name="waterFixedAmount" type="number" min="0" value="${Number(settings.waterFixedAmount || 0)}"></label><label>Mức nước theo tầng<input name="waterFloorRates" maxlength="300" value="${escapeHtml(Object.entries(settings.waterFloorRates || {}).map(([floor, amount]) => `${floor}:${amount}`).join(', '))}" placeholder="Ví dụ: 1:150000, 2:180000"></label><label>Giá điện theo tầng (đ/kWh)<input name="electricityFloorRates" maxlength="300" value="${escapeHtml(Object.entries(settings.electricityFloorRates || {}).map(([floor, amount]) => `${floor}:${amount}`).join(', '))}" placeholder="Ví dụ: 1:3500, 2:4000"></label><label>Smart Home API URL<input name="smartHomeUrl" type="url" value="${escapeHtml(settings.smartHomeUrl || '')}" placeholder="https://smarthome.example/api/meters"></label><label>Smart Home API Key<input name="smartHomeApiKey" type="password" value="${escapeHtml(settings.smartHomeApiKey || '')}" autocomplete="off"></label><label>Smart Home Bearer Token<input name="smartHomeToken" type="password" value="${escapeHtml(settings.smartHomeToken || '')}" autocomplete="off"></label><small class="form-hint">API trả về mảng readings/meters/data; mỗi dòng cần mã công tơ (meterId/deviceId/id/code) và chỉ số (current/reading/value/kwh).</small>`);
    }
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
      const waterFloorRates = Object.fromEntries(String(form.get('waterFloorRates') || '').split(',').map((item) => item.trim().split(':').map(Number)).filter(([floor, amount]) => Number.isFinite(floor) && floor >= 0 && Number.isFinite(amount) && amount >= 0));
      const electricityFloorRates = Object.fromEntries(String(form.get('electricityFloorRates') || '').split(',').map((item) => item.trim().split(':').map(Number)).filter(([floor, amount]) => Number.isFinite(floor) && floor >= 0 && Number.isFinite(amount) && amount >= 0));
      const waterBillingMode = form.get('waterBillingMode') === 'fixed' ? 'fixed' : 'metered';
      const waterFixedAmount = Number(form.get('waterFixedAmount') || 0);
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
        const nextBuilding = { ...building, name: form.get('name').trim(), code: form.get('code').trim(), listingType: form.get('listingType'), floors: parseFloors(form.get('floors')), address: form.get('address').trim(), active: form.get('active') === 'on', media, image: media.find((item) => item.kind === 'image')?.url || building.image || '', services, settings: { ...settings, city: form.get('city'), ward: form.get('ward').trim(), area: form.get('area').trim(), debtAccount: form.get('debtAccount'), paymentDay: Number(form.get('paymentDay') || 5), bankName: form.get('bankName').trim(), bankBin: form.get('bankBin').trim(), bankNumber: form.get('bankNumber').trim(), bankHolder: form.get('bankHolder').trim(), electricityRate: Number(form.get('electricityRate') || 0), waterRate: Number(form.get('waterRate') || 0), managementFee: Number(form.get('managementFee') || 0), eInvoice: form.get('eInvoice'), invoiceTemplate: form.get('invoiceTemplate'), contractTemplate: form.get('contractTemplate') }, apartments: building.apartments || Array.from({ length: apartmentTotal }, (_, index) => ({ name: `Căn ${index + 1}`, beds: 0, status: 'empty' })) };
      nextBuilding.settings.waterBillingMode = waterBillingMode;
      nextBuilding.settings.waterFixedAmount = waterFixedAmount;
      nextBuilding.settings.waterFloorRates = waterFloorRates;
      nextBuilding.settings.electricityFloorRates = electricityFloorRates;
      nextBuilding.settings.smartHomeUrl = String(form.get('smartHomeUrl') || '').trim();
      nextBuilding.settings.smartHomeApiKey = String(form.get('smartHomeApiKey') || '').trim();
      nextBuilding.settings.smartHomeToken = String(form.get('smartHomeToken') || '').trim();
      nextBuilding.settings.companyName = String(form.get('companyName') || '').trim();
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
      return `<tr><td><input type="checkbox" aria-label="Chọn ${escapeHtml(building.name)}"></td><td><strong class="building-code">${escapeHtml(code)}</strong></td><td><div class="table-actions"><button type="button" data-building-edit="${index}" aria-label="Sửa">✎</button><button type="button" class="danger-action" data-building-delete="${index}" aria-label="Xóa">▣</button></div></td><td><strong>${escapeHtml(building.name)}</strong></td><td><span class="type-badge">${building.listingType === 'whole-building' ? 'Nguyên căn' : 'Đa loại hình'}</span></td><td title="${escapeHtml(address)}">${escapeHtml(address)}</td><td><strong>${inventory}</strong><a href="#apartments" data-building-apartments="${index}">(Quản lý)</a></td><td>Ngày 0</td><td><label class="table-toggle"><input type="checkbox" data-building-toggle="${index}" ${building.active !== false ? 'checked' : ''}><span></span></label></td></tr>`;
    }).join('') : '<tr><td colspan="9" class="table-empty">Không có tòa nhà phù hợp.</td></tr>';
  };
  openModal('Danh mục dữ liệu  ›  Tòa nhà', `<div class="building-manager" data-building-manager>
    <div class="manager-stat-grid"><div class="manager-stat blue"><span>▦</span><strong>${buildings.length}</strong><small>Tất cả tòa nhà</small></div><div class="manager-stat green"><span>▦</span><strong>${buildings.filter((building) => building.active !== false).length}</strong><small>Đang hoạt động</small></div><div class="manager-stat red"><span>▦</span><strong>${buildings.filter((building) => building.active === false).length}</strong><small>Ngừng hoạt động</small></div></div>
    <div class="manager-toolbar"><input type="search" placeholder="⌕  Tìm kiếm" data-building-search><select data-building-status><option value="all">Trạng thái hoạt động</option><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option></select><select><option>Khu vực</option></select><button class="primary-button" type="button" data-manager-add>＋</button></div>
      <div class="table-scroll"><table class="building-table"><thead><tr><th><input type="checkbox"></th><th>Mã</th><th>Thao tác</th><th>Tên tòa nhà ↕</th><th>Loại khai thác</th><th>Địa chỉ ↕</th><th>Bất động sản cho thuê ↕</th><th>Ngày TT ↕</th><th>Hoạt động</th></tr></thead><tbody data-building-rows>${renderRows()}</tbody></table></div>
    <div class="manager-footer"><span>Số bản ghi</span><select><option>10</option><option>25</option><option>50</option></select><span data-building-result>${buildings.length ? `1 - ${buildings.length} trên tổng số ${buildings.length} bản ghi` : '0 trên tổng số 0 bản ghi'}</span></div>
  </div>`, () => {
    document.querySelector('[data-modal]').classList.add('modal-wide');
    const manager = document.querySelector('[data-building-manager]');
    const updateRows = () => { manager.querySelector('[data-building-rows]').innerHTML = renderRows(manager.querySelector('[data-building-search]').value, manager.querySelector('[data-building-status]').value); bindManagerActions(); };
      const bindManagerActions = () => {
      manager.querySelectorAll('[data-building-edit]').forEach((button) => button.addEventListener('click', () => openBuildingForm(buildings[Number(button.dataset.buildingEdit)])));
      manager.querySelectorAll('[data-building-delete]').forEach((button) => button.addEventListener('click', () => {
        const index = Number(button.dataset.buildingDelete);
        if (!window.confirm(`Xóa tòa nhà "${buildings[index].name}"?`)) return;
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
    <label>Giá điện riêng phòng/văn phòng (đ/kWh)<input name="electricityRate" type="number" min="0" value="${Number(apartment?.electricityRate || 0)}" placeholder="Để 0 để dùng giá theo tầng/tòa"></label>
    <label>Tiền nước riêng phòng (đ/tháng)<input name="waterFixedAmount" type="number" min="0" value="${Number(apartment?.waterFixedAmount || 0)}" placeholder="Để 0 để dùng mặc định tầng/tòa"></label>
    <label>Hình ảnh và video<input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple><small class="form-hint">Tối đa 5 ảnh và 1 video. Tên file được tạo theo mã tòa và mã căn.</small></label>
    <label>Loại hình cho thuê<select name="propertyType">${Object.entries(propertyTypes).map(([value, label]) => `<option value="${value}" ${(apartment?.propertyType || 'apartment') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label>Số giường<input name="beds" type="number" min="0" value="${Number(apartment?.beds ?? 1)}"></label>
    <label>Trạng thái<select name="status"><option value="empty" ${apartment?.status === 'empty' ? 'selected' : ''}>Đang trống</option><option value="reserved" ${apartment?.status === 'reserved' ? 'selected' : ''}>Đang cọc</option><option value="rented" ${apartment?.status === 'rented' ? 'selected' : ''}>Đang thuê</option><option value="inactive" ${apartment?.status === 'inactive' ? 'selected' : ''}>Ngừng hoạt động</option></select></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">${apartment ? 'Cập nhật căn hộ' : 'Lưu căn hộ'}</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const formElement = document.querySelector('[data-apartment-form]');
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
        const nextApartment = { ...apartment, name: form.get('name').trim(), title: form.get('title').trim(), description: form.get('description').trim(), floor: Number(form.get('floor') || 0), meterId: form.get('meterId').trim(), electricityRate: Number(form.get('electricityRate') || 0), waterFixedAmount: Number(form.get('waterFixedAmount') || 0), image, media, propertyType: form.get('propertyType'), beds: Number(form.get('beds') || 0), status: form.get('status') };
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

function openApartmentManager() {
  const building = buildings[selectedBuildingIndex];
  if (!building) {
    openBuildingForm();
    return;
  }
  const statusLabels = { empty: 'Đang trống', reserved: 'Đang cọc', rented: 'Đang thuê', inactive: 'Ngừng hoạt động' };
  const options = building.apartments.length
    ? building.apartments.map((apartment, index) => `<article class="modal-option apartment-record">${apartment.image ? `<img src="${escapeHtml(apartment.image)}" alt="${escapeHtml(apartment.title || apartment.name)}">` : ''}<div class="apartment-record-content"><span>${escapeHtml(apartment.title || apartment.name)}</span><small>${propertyTypes[apartment.propertyType || 'apartment']} · ${escapeHtml(apartment.name)} · ${statusLabels[apartment.status] || 'Đang trống'} · ${apartment.beds} giường${apartment.description ? ` · ${escapeHtml(apartment.description)}` : ''}</small></div><div class="catalog-actions"><button type="button" data-apartment-edit="${index}">Sửa</button><button type="button" data-apartment-delete="${index}">Xóa</button></div></article>`).join('')
    : '<p class="empty-state">Tòa nhà này chưa có căn hộ hoặc văn phòng.</p>';
  openModal(`Không gian cho thuê - ${building.name}`, `<div class="modal-list">${options}</div><button class="modal-secondary" type="button" data-modal-add-apartment>＋ Thêm căn hộ/văn phòng</button>`, () => {
    document.querySelector('[data-modal-add-apartment]').addEventListener('click', openApartmentForm);
    document.querySelectorAll('[data-apartment-edit]').forEach((button) => button.addEventListener('click', () => openApartmentForm(Number(button.dataset.apartmentEdit))));
    document.querySelectorAll('[data-apartment-delete]').forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.apartmentDelete);
      if (!window.confirm(`Xóa căn hộ ${building.apartments[index].name}?`)) return;
      building.apartments.splice(index, 1);
      persistBuildings();
      openApartmentManager();
    }));
  });
}

function openBedManager() {
  const building = buildings[selectedBuildingIndex];
  if (!building) {
    openBuildingForm();
    return;
  }
  const totalBeds = building.apartments.reduce((total, apartment) => total + Number(apartment.beds || 0), 0);
  const options = building.apartments.length
    ? building.apartments.map((apartment) => `<div class="modal-option"><span>${escapeHtml(apartment.name)}</span><small>${apartment.beds} giường · ${apartment.status === 'rented' ? 'Đang thuê' : apartment.status === 'reserved' ? 'Đang cọc' : 'Đang trống'}</small></div>`).join('')
    : '<p class="empty-state">Chưa có căn hộ để phân bổ giường.</p>';
  openModal(`Giường - ${building.name}`, `<p class="entity-summary">Tổng số giường: <strong>${totalBeds}</strong></p><div class="modal-list">${options}</div><button class="modal-secondary" type="button" data-modal-add-apartment>＋ Thêm căn hộ có giường</button>`, () => {
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
  const title = type === 'occupancy' ? `Tỷ lệ lấp đầy - ${building.name}` : type === 'empty' ? `Căn hộ trống - ${building.name}` : `Căn hộ sắp trống - ${building.name}`;
  const filtered = status ? apartments.filter((apartment) => apartment.status === status) : apartments;
  const occupied = apartments.filter((apartment) => apartment.status === 'rented').length;
  const occupancy = apartments.length ? ((occupied / apartments.length) * 100).toFixed(2) : '0.00';
  const items = filtered.length
    ? filtered.map((apartment) => `<div class="modal-option"><span>${escapeHtml(apartment.name)}</span><small>${apartment.beds} giường · ${apartment.status === 'rented' ? 'Đang thuê' : apartment.status === 'reserved' ? 'Đang cọc' : 'Đang trống'}</small></div>`).join('')
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

function setApartmentStatus(apartmentName, status, buildingName = '') {
  if (!apartmentName) return false;
  const apartment = buildings.find((building) => !buildingName || building.name === buildingName)?.apartments?.find((item) => item.name === apartmentName)
    || buildings.flatMap((building) => building.apartments || []).find((item) => item.name === apartmentName);
  if (!apartment) return false;
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
  openModal(customer ? 'Cập nhật khách hàng' : 'Thêm khách hàng', `<form class="building-form" data-customer-form><div class="form-grid"><label>Họ và tên <b>*</b><input name="name" required maxlength="80" value="${escapeHtml(customer?.name || '')}" placeholder="Nhập họ tên"></label><label>Email tài khoản<input name="email" type="email" maxlength="120" value="${escapeHtml(customer?.email || '')}" placeholder="Email đăng nhập người thuê"></label><label>Mã khách hàng<input name="code" maxlength="30" value="${escapeHtml(customer?.code || '')}" placeholder="Tự động nếu bỏ trống"></label><label>Số điện thoại <b>*</b><input name="phone" required pattern="[0-9 +()-]{8,}" value="${escapeHtml(customer?.phone || '')}" placeholder="09xx xxx xxx"></label><label>CMND/CCCD/Hộ chiếu<input name="identity" maxlength="30" value="${escapeHtml(customer?.identity || '')}" placeholder="Số giấy tờ"></label><label>Ngày sinh<input name="birthDate" type="date" value="${escapeHtml(customer?.birthDate || '')}"></label><label>Loại khách<select name="type"><option value="personal" ${customer?.type === 'personal' ? 'selected' : ''}>Cá nhân</option><option value="business" ${customer?.type === 'business' ? 'selected' : ''}>Doanh nghiệp</option><option value="foreign" ${customer?.type === 'foreign' ? 'selected' : ''}>Khách nước ngoài</option></select></label><label>Căn hộ đang ở<select name="apartment"><option value="">Chưa xác định</option>${apartmentOptions}</select></label><label>Trạng thái<select name="status"><option value="renting" ${customer?.status === 'renting' ? 'selected' : ''}>Đang thuê</option><option value="moved" ${customer?.status === 'moved' ? 'selected' : ''}>Đã chuyển đi</option><option value="visitor" ${customer?.status === 'visitor' ? 'selected' : ''}>Khách vãng lai</option></select></label><label class="full-field">Địa chỉ<textarea name="address" placeholder="Địa chỉ liên hệ">${escapeHtml(customer?.address || '')}</textarea></label></div><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy bỏ</button><button class="primary-button" type="submit">${customer ? 'Cập nhật khách hàng' : 'Lưu khách hàng'}</button></div></form>`, () => {
    const apartmentSelect = document.querySelector('[data-customer-form] [name="apartment"]');
    apartmentSelect.value = customer?.apartment ? `${customer.building || buildings.find((building) => (building.apartments || []).some((apartment) => apartment.name === customer.apartment))?.name || ''} | ${customer.apartment}` : '';
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-customer-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const selectedApartment = apartmentReference(form.get('apartment'));
      const previousApartment = customer ? { building: customer.building || '', apartment: customer.apartment || '', status: customer.status } : null;
      const nextCustomer = { id: customer?.id || crypto.randomUUID(), ...customer, name: form.get('name').trim(), email: form.get('email').trim().toLowerCase(), code: form.get('code').trim() || customer?.code || `KH${String(customers.length + 1).padStart(6, '0')}`, phone: form.get('phone').trim(), identity: form.get('identity').trim(), birthDate: form.get('birthDate'), type: form.get('type'), building: selectedApartment.building, apartment: selectedApartment.apartment, status: form.get('status'), address: form.get('address').trim(), createdAt: customer?.createdAt || new Date().toISOString() };
      if (customerIndex >= 0) customers[customerIndex] = nextCustomer;
      else customers.push(nextCustomer);
      const changedApartment = previousApartment && (previousApartment.building !== nextCustomer.building || previousApartment.apartment !== nextCustomer.apartment);
      if (previousApartment?.apartment && previousApartment.status === 'renting' && (changedApartment || nextCustomer.status !== 'renting') && !customers.some((item) => item !== nextCustomer && item.status === 'renting' && item.apartment === previousApartment.apartment && (!previousApartment.building || item.building === previousApartment.building))) setApartmentStatus(previousApartment.apartment, 'empty', previousApartment.building);
      if (nextCustomer.status === 'renting' && nextCustomer.apartment) setApartmentStatus(nextCustomer.apartment, 'rented', nextCustomer.building);
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
  const relatedContracts = contracts.filter((contract) => contract.status !== 'completed' && (contract.phone === customer.phone || contract.name === customer.name) && (!customer.apartment || contract.apartment === customer.apartment));
  const relatedInvoices = invoices.filter((invoice) => invoice.status !== 'paid' && (invoice.tenantEmail === customer.email || (invoice.apartment === customer.apartment && invoice.building === building?.name)));
  const outstanding = relatedInvoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const contractsHtml = relatedContracts.length ? relatedContracts.map((contract) => `<li>${escapeHtml(contract.apartment || 'Chưa gán không gian')} · ${Number(contract.amount || 0).toLocaleString('vi-VN')} đ/tháng</li>`).join('') : '<li>Chưa có hợp đồng đang hiệu lực.</li>';
  const invoicesHtml = relatedInvoices.length ? relatedInvoices.map((invoice) => `<li>${escapeHtml(invoice.title)} · ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ${invoice.dueDate ? ` · hạn ${escapeHtml(invoice.dueDate)}` : ''}</li>`).join('') : '<li>Không có hóa đơn chưa thanh toán.</li>';
  openModal(`Hồ sơ khách hàng · ${customer.name}`, `<div class="entity-summary customer-detail-summary"><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.code || 'Chưa có mã')} · ${escapeHtml(statusLabels[customer.status] || 'Chưa xác định')}</span></div><div class="customer-detail-grid"><div><small>Số điện thoại</small><strong>${escapeHtml(customer.phone || 'Chưa cập nhật')}</strong></div><div><small>Email</small><strong>${escapeHtml(customer.email || 'Chưa cập nhật')}</strong></div><div><small>Loại khách</small><strong>${escapeHtml(typeLabels[customer.type] || 'Cá nhân')}</strong></div><div><small>CMND/CCCD/Hộ chiếu</small><strong>${escapeHtml(customer.identity || 'Chưa cập nhật')}</strong></div><div><small>Tòa nhà</small><strong>${escapeHtml(building?.name || customer.building || 'Chưa xác định')}</strong></div><div><small>Căn hộ/Văn phòng</small><strong>${escapeHtml(customer.apartment || 'Chưa xác định')}</strong></div><div class="full"><small>Địa chỉ liên hệ</small><strong>${escapeHtml(customer.address || 'Chưa cập nhật')}</strong></div></div><div class="entity-summary customer-detail-balance"><span>Hóa đơn chưa thanh toán</span><strong>${outstanding.toLocaleString('vi-VN')} đ</strong></div><section class="customer-detail-section"><h3>Hợp đồng đang hiệu lực</h3><ul>${contractsHtml}</ul></section><section class="customer-detail-section"><h3>Hóa đơn chưa thanh toán</h3><ul>${invoicesHtml}</ul></section><div class="form-actions"><button class="modal-secondary" type="button" data-customer-detail-close>Đóng</button><button class="primary-button" type="button" data-customer-detail-edit>Sửa hồ sơ</button></div>`, () => {
    document.querySelector('[data-customer-detail-close]').addEventListener('click', closeModal);
    document.querySelector('[data-customer-detail-edit]').addEventListener('click', () => openCustomerForm(customerIndex));
  });
}

function openCustomerManager() {
  const renderRows = (query = '', status = 'renting') => {
    const filtered = customers.filter((customer) => customer.status === status && `${customer.name} ${customer.code} ${customer.identity} ${customer.apartment}`.toLowerCase().includes(query.toLowerCase()));
    return filtered.length ? filtered.map((customer) => `<tr><td><input type="checkbox"></td><td><strong class="building-code">${escapeHtml(customer.code)}</strong></td><td><div class="table-actions"><button type="button" data-customer-view="${customers.indexOf(customer)}" aria-label="Xem chi tiết">◉</button><button type="button" data-customer-edit="${customers.indexOf(customer)}" aria-label="Sửa">✎</button><button type="button" class="danger-action" data-customer-delete="${customers.indexOf(customer)}" aria-label="Xóa">▣</button></div></td><td><button type="button" class="customer-name-link" data-customer-view="${customers.indexOf(customer)}">${escapeHtml(customer.name)}</button><small class="table-muted">${escapeHtml(customer.type === 'business' ? 'Doanh nghiệp' : customer.type === 'foreign' ? 'Khách nước ngoài' : 'Cá nhân')}</small></td><td>${escapeHtml(customer.apartment || 'Chưa xác định')}</td><td>${escapeHtml(customer.identity || 'Chưa cập nhật')}</td><td>${escapeHtml(customer.birthDate || 'Chưa cập nhật')}</td><td>${escapeHtml(customer.address || 'Chưa cập nhật')}</td></tr>`).join('') : '<tr><td colspan="8" class="table-empty">Không có dữ liệu nào để hiển thị</td></tr>';
  };
  const count = (status) => customers.filter((customer) => customer.status === status).length;
  openModal('Khách hàng', `<div class="customer-manager" data-customer-manager><div class="customer-tabs"><button class="active" data-customer-tab="renting">♙　Đang thuê</button><button data-customer-tab="moved">♙　Đã chuyển đi</button><button data-customer-tab="visitor">♙　Khách vãng lai</button></div><div class="manager-stat-grid customer-stat-grid"><div class="manager-stat blue"><span>♧</span><strong>${customers.length}</strong><small>Tất cả</small></div><div class="manager-stat green"><span>♙</span><strong>${customers.filter((customer) => customer.type === 'personal').length}</strong><small>Cá nhân</small></div><div class="manager-stat orange"><span>▣</span><strong>${customers.filter((customer) => customer.type === 'business').length}</strong><small>Doanh nghiệp</small></div><div class="manager-stat red"><span>◎</span><strong>${customers.filter((customer) => customer.type === 'foreign').length}</strong><small>Khách nước ngoài</small></div></div><div class="customer-toolbar"><select><option>Chọn khu vực</option></select><select><option>Chọn tòa nhà</option>${buildings.map((building) => `<option>${escapeHtml(building.name)}</option>`).join('')}</select><select disabled><option>Chọn phòng</option></select><select disabled><option>Chọn giường</option></select></div><div class="manager-toolbar"><input type="search" placeholder="⌕  Tìm kiếm" data-customer-search><button class="primary-button" type="button" data-customer-add>＋</button></div><div class="table-scroll"><table class="building-table customer-table"><thead><tr><th><input type="checkbox"></th><th>Mã KH</th><th>Thao tác</th><th>Khách hàng ↕</th><th>Căn hộ đang ở</th><th>CMND/CCCD/Hộ chiếu ↕</th><th>Ngày sinh ↕</th><th>Địa chỉ ↕</th></tr></thead><tbody data-customer-rows>${renderRows()}</tbody></table></div><div class="manager-footer"><span>Số bản ghi</span><select><option>10</option><option>25</option></select><span data-customer-result>${count('renting') ? `1 - ${count('renting')} trên tổng số ${count('renting')} bản ghi` : '1 - 0 trên tổng số 0 bản ghi'}</span></div><div class="faq"><h3>Câu hỏi thường gặp</h3><details><summary>Khách hàng có ứng dụng cư dân không?</summary><p>Khách thuê có thể sử dụng ứng dụng cư dân để xem hóa đơn và thông báo.</p></details><details><summary>Khách hàng sử dụng app cư dân có mất phí không?</summary><p>Chính sách phí phụ thuộc cấu hình của chủ nhà và tòa nhà.</p></details></div></div>`, () => {
    document.querySelector('[data-modal]').classList.add('modal-wide');
    const manager = document.querySelector('[data-customer-manager]');
    let currentStatus = 'renting';
    const updateRows = () => { manager.querySelector('[data-customer-rows]').innerHTML = renderRows(manager.querySelector('[data-customer-search]').value, currentStatus); manager.querySelector('[data-customer-result]').textContent = `${customers.filter((customer) => customer.status === currentStatus).length} bản ghi`; bindActions(); };
    const bindActions = () => { manager.querySelectorAll('[data-customer-view]').forEach((button) => button.addEventListener('click', () => openCustomerDetails(Number(button.dataset.customerView)))); manager.querySelectorAll('[data-customer-edit]').forEach((button) => button.addEventListener('click', () => openCustomerForm(Number(button.dataset.customerEdit)))); manager.querySelectorAll('[data-customer-delete]').forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.customerDelete); if (!window.confirm(`Xóa khách hàng "${customers[index].name}"?`)) return; customers.splice(index, 1); persistCustomers(); openCustomerManager(); showToast('Đã xóa khách hàng'); })); };
    manager.querySelectorAll('[data-customer-tab]').forEach((tab) => tab.addEventListener('click', () => { currentStatus = tab.dataset.customerTab; manager.querySelectorAll('[data-customer-tab]').forEach((item) => item.classList.toggle('active', item === tab)); updateRows(); }));
    manager.querySelector('[data-customer-search]').addEventListener('input', updateRows);
    manager.querySelector('[data-customer-add]').addEventListener('click', openCustomerForm);
    bindActions();
  });
}

function openWorkflowForm(type) {
  const isContract = type === 'contracts';
  const records = isContract ? contracts : reservations;
  const storage = isContract ? contractStorageKey : reservationStorageKey;
  const title = isContract ? 'Thêm hợp đồng' : 'Thêm đặt cọc';
  const action = isContract ? 'Lưu hợp đồng' : 'Lưu đặt cọc';
  const apartmentOptions = (buildings[selectedBuildingIndex]?.apartments || []).map((apartment) => `<option value="${escapeHtml(apartment.name)}">${escapeHtml(apartment.name)}</option>`).join('');
  openModal(title, `<form class="building-form" data-workflow-form>
    <label>Khách hàng<input name="name" required maxlength="80" placeholder="Họ và tên"></label>
    <label>Số điện thoại<input name="phone" required pattern="[0-9 +()-]{8,}" placeholder="09xx xxx xxx"></label>
    <label>Căn hộ<select name="apartment"><option value="">Chưa xác định</option>${apartmentOptions}</select></label>
    <label>${isContract ? 'Giá thuê/tháng' : 'Tiền đặt cọc'}<input name="amount" type="number" min="0" value="0"></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">${action}</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-workflow-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const apartment = form.get('apartment');
      records.push({ name: form.get('name').trim(), phone: form.get('phone').trim(), apartment, amount: Number(form.get('amount') || 0), status: 'active', createdAt: new Date().toISOString() });
      persistCollection(storage, records);
      if (apartment) setApartmentStatus(apartment, isContract ? 'rented' : 'reserved');
      updateDashboard();
      closeModal();
      showToast(isContract ? 'Đã thêm hợp đồng mới' : 'Đã thêm đặt cọc mới');
    });
  });
}

function openWorkflowManager(type) {
  const isContract = type === 'contracts';
  const records = isContract ? contracts : reservations;
  const title = isContract ? 'Hợp đồng' : 'Đặt cọc';
  const items = records.length
    ? records.map((record, index) => `<article class="modal-option"><div><span>${escapeHtml(record.name)}</span><small>${escapeHtml(record.phone)} · ${escapeHtml(record.apartment || 'Chưa xác định')} · ${Number(record.amount).toLocaleString('vi-VN')} đ · ${record.status === 'completed' ? 'Đã kết thúc' : 'Đang hiệu lực'}</small></div>${isContract && record.status !== 'completed' ? `<div class="catalog-actions"><button type="button" data-contract-complete="${index}">Kết thúc</button></div>` : ''}</article>`).join('')
    : `<p class="empty-state">Chưa có ${isContract ? 'hợp đồng' : 'đặt cọc'} nào.</p>`;
  openModal(title, `<div class="entity-summary">Tổng số: <strong>${records.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-workflow>＋ Thêm ${isContract ? 'hợp đồng' : 'đặt cọc'}</button>`, () => {
    document.querySelector('[data-modal-add-workflow]').addEventListener('click', () => openWorkflowForm(type));
    document.querySelectorAll('[data-contract-complete]').forEach((button) => button.addEventListener('click', () => {
      const contract = contracts[Number(button.dataset.contractComplete)];
      if (!window.confirm(`Kết thúc hợp đồng của ${contract.name} và trả căn về trạng thái trống?`)) return;
      contract.status = 'completed';
      contract.completedAt = new Date().toISOString();
      persistCollection(contractStorageKey, contracts);
      setApartmentStatus(contract.apartment, 'empty');
      updateDashboard();
      openWorkflowManager('contracts');
      showToast('Đã kết thúc hợp đồng và trả căn về trống');
    }));
  });
}

function persistCollection(key, records) {
  localStorage.setItem(key, JSON.stringify(records));
  queueServerSync();
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

function openBookingForm() {
  const apartmentOptions = buildings.flatMap((building) => (building.apartments || []).filter((apartment) => apartment.status === 'empty' || apartment.status === 'reserved').map((apartment) => `<option value="${escapeHtml(building.name)} | ${escapeHtml(apartment.name)}">${escapeHtml(building.name)} - ${escapeHtml(apartment.name)}</option>`)).join('');
  const now = new Date();
  const checkIn = new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16);
  const checkOut = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString().slice(0, 16);
  openModal('Tạo booking', `<form class="building-form" data-booking-form>
    <label>Khách lưu trú<input name="name" required maxlength="80" placeholder="Họ và tên khách"></label>
    <label>Số điện thoại<input name="phone" required pattern="[0-9 +()-]{8,}" placeholder="09xx xxx xxx"></label>
    <label>Căn hộ/giường<select name="apartment" required><option value="">Chọn căn hộ</option>${apartmentOptions}</select></label>
    <label>Nhận phòng<input name="checkIn" type="datetime-local" required value="${checkIn}"></label>
    <label>Trả phòng<input name="checkOut" type="datetime-local" required value="${checkOut}"></label>
    <label>Tiền phòng<input name="amount" type="number" min="0" required value="0"></label>
    <label>Đã đặt cọc<input name="deposit" type="number" min="0" required value="0"></label>
    <label>CCCD/Hộ chiếu<input name="identityFile" type="file" accept="image/*,.pdf"></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Tạo booking</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-booking-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const documentFile = form.get('identityFile');
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = 'Đang lưu...';
      let document;
      try {
        document = await uploadBookingDocument(documentFile);
      } catch (error) {
        submitButton.disabled = false;
        submitButton.textContent = 'Tạo booking';
        showToast(error.message);
        return;
      }
      bookings.push({ id: crypto.randomUUID(), name: form.get('name').trim(), phone: form.get('phone').trim(), apartment: form.get('apartment'), checkIn: form.get('checkIn'), checkOut: form.get('checkOut'), amount: Number(form.get('amount') || 0), deposit: Number(form.get('deposit') || 0), ...document, status: 'booked', createdAt: new Date().toISOString() });
      persistCollection(bookingStorageKey, bookings);
      closeModal();
      showToast('Đã tạo booking mới');
    });
  });
}

function openBookingManager() {
  const labels = { booked: 'Đã đặt', checkedIn: 'Đang ở', checkedOut: 'Đã trả phòng' };
  const items = bookings.length ? bookings.map((booking, index) => `<article class="modal-option"><div><span>${escapeHtml(booking.name)} <small>(${labels[booking.status]})</small></span><small>${escapeHtml(booking.apartment)} · ${formatDateTime(booking.checkIn)} - ${formatDateTime(booking.checkOut)}${booking.documentName ? ` · <a href="${escapeHtml(booking.documentUrl)}" target="_blank" rel="noopener">${escapeHtml(booking.documentName)}</a>` : ''}</small></div><div class="catalog-actions"><button type="button" data-booking-print="${index}">In</button><button type="button" data-booking-status="${index}">${booking.status === 'booked' ? 'Check-in' : booking.status === 'checkedIn' ? 'Trả phòng' : 'Hoàn tất'}</button></div></article>`).join('') : '<p class="empty-state">Chưa có booking nào.</p>';
  openModal('Booking', `<div class="entity-summary">Lịch đặt phòng và lưu trú ngắn hạn</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-booking>＋ Tạo booking</button>`, () => {
    document.querySelector('[data-modal-add-booking]').addEventListener('click', openBookingForm);
    document.querySelectorAll('[data-booking-status]').forEach((button) => button.addEventListener('click', () => {
      const booking = bookings[Number(button.dataset.bookingStatus)];
      if (booking.status === 'booked') booking.status = 'checkedIn';
      else if (booking.status === 'checkedIn') booking.status = 'checkedOut';
      else return;
      persistCollection(bookingStorageKey, bookings);
      openBookingManager();
      showToast(`Đã cập nhật trạng thái ${booking.name}`);
    }));
    document.querySelectorAll('[data-booking-print]').forEach((button) => button.addEventListener('click', () => {
      const booking = bookings[Number(button.dataset.bookingPrint)];
      const balance = Math.max(booking.amount - booking.deposit, 0);
      const receipt = window.open('', '_blank', 'width=720,height=760');
      receipt.document.write(`<title>Phiếu xác nhận booking</title><main style="font-family:Arial;padding:40px;color:#122a4c"><header style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #0649a6;padding-bottom:16px"><img src="${window.location.origin}/assets/Logo%20BPG.jpg" alt="Phú Gia Land" style="width:84px;height:54px;object-fit:contain"><div><h1 style="margin:0;color:#0649a6">PHÚ GIA LAND</h1><small>Phiếu xác nhận đặt phòng</small></div></header><h2>Thông tin booking</h2><p><b>Khách:</b> ${escapeHtml(booking.name)} (${escapeHtml(booking.phone)})</p><p><b>Căn hộ:</b> ${escapeHtml(booking.apartment)}</p><p><b>Nhận/trả:</b> ${formatDateTime(booking.checkIn)} - ${formatDateTime(booking.checkOut)}</p><p><b>Tiền phòng:</b> ${booking.amount.toLocaleString('vi-VN')} đ</p><p><b>Còn thanh toán:</b> ${balance.toLocaleString('vi-VN')} đ</p><p>Quét VietQR theo thông tin tài khoản được cấu hình trong tòa nhà.</p></main>`);
      receipt.document.close();
      receipt.print();
    }));
  });
}

function openMeterForm() {
  const buildingSettings = buildings[selectedBuildingIndex]?.settings || {};
  const electricityRate = Number(buildingSettings.electricityRate || 0);
  const waterRate = Number(buildingSettings.waterRate || 0);
  const apartmentOptions = buildings.flatMap((building) => (building.apartments || []).map((apartment) => {
    const floorRate = Number((building.settings?.waterFloorRates || {})[apartment.floor] || 0);
    const electricityFloorRate = Number((building.settings?.electricityFloorRates || {})[apartment.floor] || 0);
    const electricityRateForApartment = Number(apartment.electricityRate || electricityFloorRate || building.settings?.electricityRate || electricityRate);
    const fixedAmount = Number(apartment.waterFixedAmount || floorRate || building.settings?.waterFixedAmount || 0);
    return `<option value="${escapeHtml(building.name)} | ${escapeHtml(apartment.name)}" data-building-index="${buildings.indexOf(building)}" data-meter-id="${escapeHtml(apartment.meterId || '')}" data-electricity-rate="${electricityRateForApartment}" data-water-mode="${escapeHtml(apartment.waterFixedAmount || floorRate || building.settings?.waterFixedAmount ? 'fixed' : (building.settings?.waterBillingMode || 'metered'))}" data-water-fixed="${fixedAmount}" data-water-floor="${Number(apartment.floor || 0)}">${escapeHtml(building.name)} - ${escapeHtml(apartment.name)}${apartment.floor ? ` · Tầng ${apartment.floor}` : ''}</option>`;
  })).join('');
  openModal('Ghi chỉ số', `<form class="building-form" data-meter-form>
    <label>Căn hộ<select name="apartment" required><option value="">Chọn căn hộ</option>${apartmentOptions}</select></label>
    <label>Loại dịch vụ<select name="service" data-meter-service><option value="electricity">Điện</option><option value="water">Nước</option></select></label>
    <label>Chỉ số cũ<input name="previous" type="number" min="0" required value="0"></label>
    <label>Chỉ số mới<input name="current" type="number" min="0" required value="0"></label>
    <label>Cách tính nước<select name="waterMode" data-water-mode-select><option value="metered">Theo m³</option><option value="fixed">Mức cố định</option></select></label>
    <label>Đơn giá / mức thu<input name="rate" data-meter-rate type="number" min="0" required value="${electricityRate}"><small class="form-hint" data-water-rate-hint></small></label>
    <label>Tháng áp dụng<input name="month" type="month" required value="${new Date().toISOString().slice(0, 7)}"></label>
    <p class="form-hint" data-smart-home-status></p><div class="form-actions"><button class="modal-secondary" type="button" data-smart-home-sync>↻ Lấy chỉ số Smart Home</button><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu và tạo hóa đơn</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    const updateWaterDefaults = () => {
      const form = document.querySelector('[data-meter-form]');
      const selectedApartment = form.querySelector('[name="apartment"] option:checked');
      const isWater = form.querySelector('[data-meter-service]').value === 'water';
      const selectedBuilding = buildings[Number(selectedApartment?.dataset.buildingIndex)] || buildings[selectedBuildingIndex];
      const selectedSettings = selectedBuilding?.settings || buildingSettings;
      const mode = isWater ? (selectedApartment?.dataset.waterMode || selectedSettings.waterBillingMode || 'metered') : 'metered';
      const rate = isWater && mode === 'fixed' ? Number(selectedApartment?.dataset.waterFixed || selectedSettings.waterFixedAmount || 0) : isWater ? Number(selectedSettings.waterRate || waterRate) : Number(selectedApartment?.dataset.electricityRate || selectedSettings.electricityRate || electricityRate);
      form.querySelector('[data-water-mode-select]').value = mode;
      form.querySelector('[data-meter-rate]').value = rate;
      form.querySelector('[data-water-mode-select]').disabled = !isWater;
      form.querySelector('[data-water-rate-hint]').textContent = isWater && mode === 'fixed' ? 'Mức cố định theo phòng, tầng hoặc tòa nhà.' : isWater ? 'Số tiền = m³ tiêu thụ × đơn giá.' : 'Số tiền = chỉ số tiêu thụ × đơn giá.';
    };
    document.querySelector('[data-meter-service]').addEventListener('change', updateWaterDefaults);
    document.querySelector('[data-meter-form] [name="apartment"]').addEventListener('change', updateWaterDefaults);
    document.querySelector('[data-water-mode-select]').addEventListener('change', updateWaterDefaults);
    updateWaterDefaults();
    document.querySelector('[data-smart-home-sync]').addEventListener('click', async () => {
      const form = document.querySelector('[data-meter-form]');
      const option = form.querySelector('[name="apartment"] option:checked');
      const building = buildings[Number(option?.dataset.buildingIndex)];
      const meterId = option?.dataset.meterId;
      const status = form.querySelector('[data-smart-home-status]');
      if (!building?.settings?.smartHomeUrl) { status.textContent = 'Chưa cấu hình Smart Home API cho tòa nhà.'; return; }
      if (!meterId) { status.textContent = 'Phòng chưa có mã công tơ Smart Home.'; return; }
      status.textContent = 'Đang lấy chỉ số...';
      try {
        const response = await fetch('/api/smart-home/readings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: building.settings.smartHomeUrl, apiKey: building.settings.smartHomeApiKey, token: building.settings.smartHomeToken }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Không thể lấy chỉ số');
        const reading = (payload.readings || []).find((item) => item.meterId === meterId);
        if (!reading) throw new Error(`Không tìm thấy công tơ ${meterId}`);
        const previousLog = meterLogs.filter((item) => item.apartment === form.querySelector('[name="apartment"]').value && item.service === 'electricity').at(-1);
        form.querySelector('[name="previous"]').value = previousLog?.current ?? 0;
        form.querySelector('[name="current"]').value = reading.current;
        status.textContent = `Đã lấy chỉ số ${reading.current} từ Smart Home.`;
      } catch (error) {
        status.textContent = error.message || 'Không thể lấy chỉ số Smart Home.';
      }
    });
    document.querySelector('[data-meter-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const previous = Number(form.get('previous') || 0);
      const current = Number(form.get('current') || 0);
      if (current < previous) { showToast('Chỉ số mới phải lớn hơn hoặc bằng chỉ số cũ'); return; }
      const usage = current - previous;
      const service = form.get('service');
      const waterMode = form.get('waterMode') || 'metered';
      const rate = Number(form.get('rate') || 0);
      const amount = service === 'water' && waterMode === 'fixed' ? rate : usage * rate;
      meterLogs.push({ apartment: form.get('apartment'), service, waterMode: service === 'water' ? waterMode : 'metered', previous, current, usage, rate, amount, month: form.get('month'), createdAt: new Date().toISOString() });
      const selectedApartment = formElement.querySelector('[name="apartment"] option:checked');
      const apartmentName = selectedApartment?.value.split(' | ').slice(-1)[0] || '';
      const tenant = customers.find((customer) => customer.apartment === apartmentName && customer.status === 'renting');
      invoices.push({ title: `${service === 'electricity' ? 'Tiền điện' : 'Tiền nước'} ${form.get('month')} - ${form.get('apartment')}`, building: selectedApartment?.textContent.split(' - ')[0] || '', apartment: apartmentName, tenantEmail: tenant?.email || '', type: service, amount, usage, rate, status: 'unpaid', createdAt: new Date().toISOString() });
      persistCollection(meterLogStorageKey, meterLogs);
      persistCollection(invoiceStorageKey, invoices);
      updateDashboard();
      closeModal();
      showToast('Đã ghi chỉ số và tạo hóa đơn');
    });
  });
}

function openMeterManager() {
  const items = meterLogs.length ? meterLogs.map((log) => `<div class="modal-option"><span>${escapeHtml(log.apartment)}</span><small>${log.service === 'electricity' ? 'Điện' : 'Nước'} · ${log.previous} → ${log.current} (${log.usage} đơn vị) · ${Number(log.amount).toLocaleString('vi-VN')} đ</small></div>`).join('') : '<p class="empty-state">Chưa có chỉ số nào được ghi.</p>';
  openModal('Ghi chỉ số', `<div class="entity-summary">Lưu chỉ số và tự tạo hóa đơn điện, nước</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-meter>＋ Ghi chỉ số</button>`, () => document.querySelector('[data-modal-add-meter]').addEventListener('click', openMeterForm));
}

function openUtilityManager() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const render = (month = currentMonth, buildingName = '') => {
    const apartments = buildings.filter((building) => !buildingName || building.name === buildingName).flatMap((building) => (building.apartments || []).map((apartment) => ({ building: building.name, apartment: apartment.name, key: `${building.name} | ${apartment.name}` })));
    const rows = apartments.map((item) => {
      const records = meterLogs.filter((log) => log.month === month && log.apartment === item.key);
      const electricity = records.filter((log) => log.service === 'electricity').reduce((total, log) => total + Number(log.usage || 0), 0);
      const water = records.filter((log) => log.service === 'water').reduce((total, log) => total + Number(log.usage || 0), 0);
      const electricityAmount = records.filter((log) => log.service === 'electricity').reduce((total, log) => total + Number(log.amount || 0), 0);
      const waterAmount = records.filter((log) => log.service === 'water').reduce((total, log) => total + Number(log.amount || 0), 0);
      return { ...item, electricity, water, electricityAmount, waterAmount, total: electricityAmount + waterAmount };
    });
    const total = rows.reduce((summary, item) => ({ electricity: summary.electricity + item.electricity, water: summary.water + item.water, electricityAmount: summary.electricityAmount + item.electricityAmount, waterAmount: summary.waterAmount + item.waterAmount, amount: summary.amount + item.total }), { electricity: 0, water: 0, electricityAmount: 0, waterAmount: 0, amount: 0 });
    return `<div class="utility-toolbar"><label>Tháng<input type="month" data-utility-month value="${month}"></label><label>Tòa nhà<select data-utility-building><option value="">Toàn hệ thống</option>${buildings.map((building) => `<option value="${escapeHtml(building.name)}" ${building.name === buildingName ? 'selected' : ''}>${escapeHtml(building.name)}</option>`).join('')}</select></label><button class="modal-secondary" type="button" data-utility-close>Chốt & tạo hóa đơn</button><button class="primary-button" type="button" data-utility-add>＋ Ghi chỉ số</button></div><section class="utility-summary"><article><span>Tổng điện hệ thống</span><strong>${total.electricity.toLocaleString('vi-VN')} kWh</strong><small>${total.electricityAmount.toLocaleString('vi-VN')} đ</small></article><article><span>Tổng nước hệ thống</span><strong>${total.water.toLocaleString('vi-VN')} m³</strong><small>${total.waterAmount.toLocaleString('vi-VN')} đ</small></article><article><span>Tổng tiền điện nước</span><strong>${total.amount.toLocaleString('vi-VN')} đ</strong><small>${rows.length} căn hộ trong phạm vi</small></article></section><div class="utility-table-wrap"><table class="utility-table"><thead><tr><th>Tòa nhà</th><th>Căn hộ</th><th>Điện</th><th>Tiền điện</th><th>Nước</th><th>Tiền nước</th><th>Tổng căn</th></tr></thead><tbody>${rows.length ? rows.map((item) => `<tr><td>${escapeHtml(item.building)}</td><td><strong>${escapeHtml(item.apartment)}</strong></td><td>${item.electricity.toLocaleString('vi-VN')} kWh</td><td>${item.electricityAmount.toLocaleString('vi-VN')} đ</td><td>${item.water.toLocaleString('vi-VN')} m³</td><td>${item.waterAmount.toLocaleString('vi-VN')} đ</td><td><strong>${item.total.toLocaleString('vi-VN')} đ</strong></td></tr>`).join('') : '<tr><td colspan="7" class="utility-empty">Chưa có căn hộ trong phạm vi lựa chọn.</td></tr>'}</tbody></table></div>`;
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
  openModal('Quản lý điện nước', `<div class="entity-summary">Theo dõi chỉ số và chi phí điện nước của toàn hệ thống, từng tòa nhà và từng căn hộ.</div><div data-utility-manager>${render()}</div>`, () => {
    document.querySelector('[data-modal]').classList.add('utility-modal');
    bind();
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
      commissions.push({ partner: form.get('partner').trim(), reference: form.get('reference').trim(), amount: Number(form.get('amount') || 0), status: 'pending', createdAt: new Date().toISOString() });
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
      commission.status = 'paid';
      commission.paidAt = new Date().toISOString();
      persistCollection(commissionStorageKey, commissions);
      openCommissionManager();
      showToast('Đã ghi nhận thanh toán hoa hồng');
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
    document.querySelectorAll('[data-location-delete]').forEach((button) => button.addEventListener('click', () => { locations.splice(Number(button.dataset.locationDelete), 1); persistCollection(locationStorageKey, locations); openLocationManager(); }));
  });
}

function openFinancialSummary(type) {
  const isDeposit = type === 'deposit-ledger';
  const records = isDeposit ? depositLedger : prepayments;
  const title = isDeposit ? 'Danh sách tiền cọc' : 'Tiền thừa';
  const derived = isDeposit ? reservations.map((reservation) => ({ name: reservation.name, amount: reservation.amount, note: reservation.apartment || 'Chưa xác định' })) : invoices.filter((invoice) => invoice.status === 'paid' && Number(invoice.overpayment || 0) > 0).map((invoice) => ({ name: invoice.title, amount: invoice.overpayment, note: 'Từ hóa đơn đã thu' }));
  const rows = [...records, ...derived];
  const items = rows.length ? rows.map((record) => `<div class="modal-option"><span>${escapeHtml(record.name || 'Khoản tiền')}</span><small>${escapeHtml(record.note || record.apartment || '')} · ${Number(record.amount || 0).toLocaleString('vi-VN')} đ</small></div>`).join('') : '<p class="empty-state">Chưa có dữ liệu phát sinh.</p>';
  openModal(title, `<div class="entity-summary">Tổng cộng: <strong>${rows.reduce((total, record) => total + Number(record.amount || 0), 0).toLocaleString('vi-VN')} đ</strong></div><div class="modal-list">${items}</div>`);
}

function openFinancialReport(type) {
  const reportConfigs = {
    daily: { title: 'Tài khoản theo ngày', rows: cashflow.map((entry) => ({ name: entry.title, detail: `${entry.type === 'income' ? 'Thu' : 'Chi'} · ${new Date(entry.createdAt).toLocaleDateString('vi-VN')}`, amount: entry.type === 'income' ? Number(entry.amount) : -Number(entry.amount) })) },
    profit: { title: 'Phân bổ lợi nhuận', rows: [{ name: 'Tổng khoản thu', detail: 'Từ dữ liệu thu chi', amount: cashflow.filter((entry) => entry.type === 'income').reduce((total, entry) => total + Number(entry.amount || 0), 0) }, { name: 'Tổng khoản chi', detail: 'Từ dữ liệu thu chi', amount: -cashflow.filter((entry) => entry.type === 'expense').reduce((total, entry) => total + Number(entry.amount || 0), 0) }] },
    debts: { title: 'Khách nợ tiền', rows: invoices.filter((invoice) => invoice.status !== 'paid').map((invoice) => ({ name: invoice.title, detail: 'Chưa thu', amount: Number(invoice.amount || 0) })) },
    payments: { title: 'Lịch thanh toán', rows: invoices.filter((invoice) => invoice.status !== 'paid').map((invoice) => ({ name: invoice.title, detail: invoice.dueDate ? `Hạn thanh toán: ${new Date(invoice.dueDate).toLocaleDateString('vi-VN')}` : 'Chưa đặt hạn thanh toán', amount: Number(invoice.amount || 0) })) }
  };
  const report = reportConfigs[type];
  const total = report.rows.reduce((sum, row) => sum + row.amount, 0);
  const items = report.rows.length ? report.rows.map((row) => `<div class="modal-option"><span>${escapeHtml(row.name)}</span><small>${escapeHtml(row.detail)} · <strong>${row.amount.toLocaleString('vi-VN')} đ</strong></small></div>`).join('') : '<p class="empty-state">Chưa có dữ liệu phát sinh.</p>';
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
  openModal('Công việc', `<div class="entity-summary">Tổng số: <strong>${tasks.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-task>＋ Thêm công việc</button>`, () => {
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
      const invoice = { id: crypto.randomUUID(), paymentCode: `NVP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, building: buildings[selectedBuildingIndex]?.name || '', tenantEmail, title: form.get('title').trim(), type: form.get('type'), amount: Number(form.get('amount') || 0), dueDate: form.get('dueDate'), status: form.get('status'), createdAt: new Date().toISOString() };
      invoices.push(invoice);
      if (tenantEmail) notifications.unshift({ title: 'Hóa đơn mới', message: `${invoice.title}: ${invoice.amount.toLocaleString('vi-VN')} đ. Hạn thanh toán ${invoice.dueDate}.`, recipientEmail: tenantEmail, createdAt: new Date().toISOString(), read: false });
      persistCollection(invoiceStorageKey, invoices);
      if (tenantEmail) persistCollection(notificationStorageKey, notifications);
      if (tenantEmail) sendPushNotification({ email: tenantEmail, title: 'Hóa đơn mới', body: `${invoice.title}: ${invoice.amount.toLocaleString('vi-VN')} đ` });
      updateDashboard();
      closeModal();
      showToast('Đã thêm hóa đơn mới');
    });
  });
}

function openInvoicePayment(invoice) {
  const building = buildings.find((item) => item.name === invoice.building) || buildings[selectedBuildingIndex];
  const settings = building?.settings || {};
  if (!settings.bankBin || !settings.bankNumber || !settings.bankHolder) {
    showToast('Cần cấu hình BIN, số tài khoản và chủ tài khoản cho tòa nhà');
    return;
  }
  const paymentCode = invoice.paymentCode || `NVP-${String(invoice.createdAt || '').slice(0, 10).replaceAll('-', '')}`;
  const query = new URLSearchParams({ amount: String(invoice.amount), addInfo: paymentCode, accountName: settings.bankHolder });
  const imageUrl = `https://img.vietqr.io/image/${encodeURIComponent(settings.bankBin)}-${encodeURIComponent(settings.bankNumber)}-compact2.png?${query}`;
  openModal(`Thanh toán hóa đơn`, `<div class="payment-qr"><img src="${imageUrl}" alt="VietQR thanh toán ${escapeHtml(paymentCode)}"><div><p><strong>${escapeHtml(invoice.title)}</strong></p><p>Số tiền: <strong>${Number(invoice.amount).toLocaleString('vi-VN')} đ</strong></p><p>Nội dung bắt buộc: <strong>${escapeHtml(paymentCode)}</strong></p><p>${escapeHtml(settings.bankName)} · ${escapeHtml(settings.bankNumber)} · ${escapeHtml(settings.bankHolder)}</p></div></div>`);
}

function getInvoiceDetails(invoice) {
  const building = buildings.find((item) => item.name === invoice.building) || buildings[selectedBuildingIndex] || {};
  const settings = building.settings || {};
  return { company: settings.companyName || 'Phú Gia Land', phone: settings.companyPhone || '', address: [building.address, settings.area, settings.ward, settings.city].filter(Boolean).join(', '), bank: [settings.bankName, settings.bankNumber, settings.bankHolder].filter(Boolean).join(' · '), customer: invoice.tenantName || customers.find((item) => item.email === invoice.tenantEmail)?.name || invoice.tenantEmail || 'Chưa gán khách hàng' };
}

function printInvoice(invoice) {
  const detail = getInvoiceDetails(invoice);
  const lines = invoice.utilityLines ? `<tr><td>Tiền điện</td><td>${Number(invoice.utilityLines.electricity || 0).toLocaleString('vi-VN')} đ</td></tr><tr><td>Tiền nước</td><td>${Number(invoice.utilityLines.water || 0).toLocaleString('vi-VN')} đ</td></tr>` : `<tr><td>${escapeHtml(invoice.title)}</td><td>${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ</td></tr>`;
  const page = window.open('', '_blank', 'width=760,height=900');
  page.document.write(`<title>Hóa đơn ${escapeHtml(invoice.paymentCode || '')}</title><style>body{font-family:Arial,sans-serif;color:#17231d;padding:38px;max-width:680px;margin:auto}header{border-bottom:3px solid #138b54;padding-bottom:16px}h1{margin:0;color:#0b6e40;font-size:26px}p{margin:6px 0;color:#516058}table{width:100%;border-collapse:collapse;margin-top:28px}td,th{border-bottom:1px solid #dce4de;padding:12px;text-align:left}td:last-child,th:last-child{text-align:right}.total{font-size:22px;font-weight:bold;color:#0b6e40;text-align:right;margin-top:20px}.code{background:#f2f7f3;padding:12px;margin-top:20px}</style><header><h1>${escapeHtml(detail.company)}</h1><p>${escapeHtml(detail.address)}</p><p>${escapeHtml(detail.phone)}</p></header><h2>HÓA ĐƠN ĐIỆN NƯỚC</h2><p>Khách hàng: <b>${escapeHtml(detail.customer)}</b></p><p>Căn hộ: <b>${escapeHtml(invoice.apartment || '')}</b> · Tháng: <b>${escapeHtml(invoice.month || '')}</b></p><table><thead><tr><th>Nội dung</th><th>Thành tiền</th></tr></thead><tbody>${lines}</tbody></table><div class="total">Tổng thanh toán: ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ</div><div class="code">Mã thanh toán: <b>${escapeHtml(invoice.paymentCode || '')}</b><br>Ngân hàng: ${escapeHtml(detail.bank || 'Chưa cấu hình')}</div>`);
  page.document.close();
  page.print();
}

async function copyInvoiceImage(invoice) {
  const detail = getInvoiceDetails(invoice);
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 760;
  const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1200, 760); context.fillStyle = '#0b6e40'; context.font = 'bold 42px Arial'; context.fillText(detail.company, 60, 80); context.fillStyle = '#34433a'; context.font = '25px Arial'; [detail.address, detail.phone, 'HÓA ĐƠN ĐIỆN NƯỚC', `Khách hàng: ${detail.customer}`, `Căn hộ: ${invoice.apartment || ''}  |  Tháng: ${invoice.month || ''}`, `Tiền điện: ${Number(invoice.utilityLines?.electricity || 0).toLocaleString('vi-VN')} đ`, `Tiền nước: ${Number(invoice.utilityLines?.water || 0).toLocaleString('vi-VN')} đ`, `TỔNG THANH TOÁN: ${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ`, `Mã thanh toán: ${invoice.paymentCode || ''}`, `Ngân hàng: ${detail.bank || 'Chưa cấu hình'}`].forEach((line, index) => context.fillText(line, 60, 140 + index * 58));
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (navigator.clipboard?.write && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); showToast('Đã sao chép hóa đơn dạng ảnh.'); return; }
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `hoa-don-${invoice.paymentCode || 'dien-nuoc'}.png`; link.click(); URL.revokeObjectURL(link.href); showToast('Đã tải ảnh hóa đơn.');
}

function openInvoiceManager() {
  const items = invoices.length
    ? invoices.map((invoice, index) => `<article class="modal-option"><div><span>${escapeHtml(invoice.title)}</span><small>${escapeHtml(invoice.paymentCode || 'Chưa có mã thanh toán')} · ${Number(invoice.amount).toLocaleString('vi-VN')} đ · ${invoice.status === 'paid' ? 'Đã thu' : 'Chưa thu'}</small></div><div class="catalog-actions">${invoice.status === 'paid' ? '' : `<button type="button" data-invoice-qr="${index}">VietQR</button>`}<button type="button" data-invoice-print="${index}">PDF</button><button type="button" data-invoice-image="${index}">Ảnh</button><button type="button" data-invoice-index="${index}">${invoice.status === 'paid' ? 'Hoàn tác' : 'Đã thu'}</button></div></article>`).join('')
    : '<p class="empty-state">Chưa có hóa đơn nào.</p>';
  openModal('Hóa đơn tháng này', `<div class="entity-summary">Tổng tiền: <strong>${invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0).toLocaleString('vi-VN')} đ</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-invoice>＋ Thêm hóa đơn</button>`, () => {
    document.querySelector('[data-modal-add-invoice]').addEventListener('click', openInvoiceForm);
    document.querySelectorAll('[data-invoice-qr]').forEach((button) => button.addEventListener('click', () => openInvoicePayment(invoices[Number(button.dataset.invoiceQr)])));
    document.querySelectorAll('[data-invoice-print]').forEach((button) => button.addEventListener('click', () => printInvoice(invoices[Number(button.dataset.invoicePrint)])));
    document.querySelectorAll('[data-invoice-image]').forEach((button) => button.addEventListener('click', () => copyInvoiceImage(invoices[Number(button.dataset.invoiceImage)]).catch(() => showToast('Không thể tạo ảnh hóa đơn.'))));
    document.querySelectorAll('[data-invoice-index]').forEach((button) => button.addEventListener('click', () => {
      const invoice = invoices[Number(button.dataset.invoiceIndex)];
      invoice.status = invoice.status === 'paid' ? 'unpaid' : 'paid';
      persistCollection(invoiceStorageKey, invoices);
      updateDashboard();
      closeModal();
      showToast(`Đã cập nhật: ${invoice.status === 'paid' ? 'Đã thu' : 'Chưa thu'}`);
    }));
  });
}

function openCashflowForm() {
  openModal('Thêm giao dịch', `<form class="building-form" data-cashflow-form>
    <label>Nội dung<input name="title" required maxlength="80" placeholder="Ví dụ: Mua vật tư sửa chữa"></label>
    <label>Loại giao dịch<select name="type"><option value="income">Khoản thu</option><option value="expense">Khoản chi</option></select></label>
    <label>Số tiền<input name="amount" type="number" min="0" required value="0"></label>
    <div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu giao dịch</button></div>
  </form>`, () => {
    document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
    document.querySelector('[data-cashflow-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      cashflow.push({ title: form.get('title').trim(), type: form.get('type'), amount: Number(form.get('amount') || 0), createdAt: new Date().toISOString() });
      persistCollection(cashflowStorageKey, cashflow);
      updateDashboard();
      closeModal();
      showToast('Đã thêm giao dịch');
    });
  });
}

function openCashflowManager() {
  const items = cashflow.length
    ? cashflow.map((entry) => `<div class="modal-option"><span>${escapeHtml(entry.title)}</span><small class="${entry.type === 'income' ? 'green-text' : 'negative'}">${entry.type === 'income' ? '+' : '-'}${Number(entry.amount).toLocaleString('vi-VN')} đ</small></div>`).join('')
    : '<p class="empty-state">Chưa có giao dịch nào.</p>';
  const income = cashflow.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const expense = cashflow.filter((entry) => entry.type === 'expense').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  openModal('Biểu đồ thu chi', `<div class="entity-summary">Thu: <strong>${income.toLocaleString('vi-VN')} đ</strong> · Chi: <strong>${expense.toLocaleString('vi-VN')} đ</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-cashflow>＋ Thêm giao dịch</button>`, () => {
    document.querySelector('[data-modal-add-cashflow]').addEventListener('click', openCashflowForm);
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
      const nextRecord = { name: form.get('name').trim(), note: form.get('note').trim(), amount: Number(form.get('amount') || 0), createdAt: record.createdAt || new Date().toISOString() };
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
      if (!window.confirm(`Xóa "${records[index].name}"?`)) return;
      records.splice(index, 1);
      persistCatalogs();
      closeModal();
      showToast('Đã xóa dữ liệu');
    }));
  });
}

function openAssetOperations(type) {
  const records = catalogs[type] || (catalogs[type] = []);
  const configs = {
    assets: { title: 'Tài sản', fields: '<label>Mã tài sản<input name="code" required maxlength="40" placeholder="TS-0001"></label><label>Tên tài sản<input name="name" required maxlength="100"></label><label>Loại tài sản<input name="assetType" maxlength="80"></label><label>Nhà cung cấp<input name="provider" maxlength="100"></label><label>Kho tài sản<input name="warehouse" maxlength="100"></label><label>Số lượng<input name="quantity" type="number" min="1" value="1"></label><label>Trạng thái<select name="status"><option value="active">Đang sử dụng</option><option value="stored">Trong kho</option><option value="broken">Hỏng</option><option value="disposed">Đã thanh lý</option></select></label>' },
    providers: { title: 'Nhà cung cấp', fields: '<label>Tên nhà cung cấp<input name="name" required maxlength="100"></label><label>Mã số thuế<input name="taxCode" maxlength="30"></label><label>Người liên hệ<input name="contact" maxlength="80"></label><label>Số điện thoại<input name="phone" maxlength="30"></label><label>Email<input name="email" type="email" maxlength="120"></label><label>Ghi chú<textarea name="note" maxlength="300"></textarea></label>' },
    warehouses: { title: 'Kho tài sản', fields: '<label>Tên kho<input name="name" required maxlength="100"></label><label>Mã kho<input name="code" required maxlength="40"></label><label>Địa chỉ<input name="address" maxlength="180"></label><label>Người phụ trách<input name="manager" maxlength="80"></label><label>Ghi chú<textarea name="note" maxlength="300"></textarea></label>' },
    'asset-types': { title: 'Loại tài sản', fields: '<label>Tên loại tài sản<input name="name" required maxlength="100"></label><label>Mã loại<input name="code" maxlength="40"></label><label>Thời gian khấu hao (tháng)<input name="lifeMonths" type="number" min="0" value="0"></label><label>Mô tả<textarea name="note" maxlength="300"></textarea></label>' },
    'moving-logs': { title: 'Lịch sử di chuyển tài sản', fields: '<label>Tài sản hoặc mã tài sản<input name="asset" required maxlength="100"></label><label>Nơi đi<input name="from" required maxlength="100"></label><label>Nơi đến<input name="to" required maxlength="100"></label><label>Người thực hiện<input name="actor" maxlength="80"></label><label>Ngày di chuyển<input name="date" type="date" required></label><label>Ghi chú<textarea name="note" maxlength="300"></textarea></label>' },
    'asset-fix': { title: 'Lịch sử sửa chữa', fields: '<label>Tài sản hoặc mã tài sản<input name="asset" required maxlength="100"></label><label>Nội dung lỗi<input name="issue" required maxlength="160"></label><label>Nhà cung cấp sửa chữa<input name="provider" maxlength="100"></label><label>Chi phí<input name="cost" type="number" min="0" value="0"></label><label>Ngày báo lỗi<input name="reportedAt" type="date" required></label><label>Ngày hoàn tất<input name="completedAt" type="date"></label><label>Trạng thái<select name="status"><option value="new">Mới báo</option><option value="processing">Đang sửa</option><option value="completed">Đã hoàn tất</option></select></label>' }
  };
  const config = configs[type];
  const items = records.length ? records.map((record, index) => `<article class="modal-option"><div><span>${escapeHtml(record.name || record.asset || record.code)}</span><small>${type === 'assets' ? `${escapeHtml(record.code)} · ${escapeHtml(record.assetType || 'Chưa phân loại')} · SL ${record.quantity || 1} · ${record.status}` : type === 'moving-logs' ? `${escapeHtml(record.from)} → ${escapeHtml(record.to)} · ${record.date}` : `${escapeHtml(record.issue)} · ${Number(record.cost || 0).toLocaleString('vi-VN')} đ · ${record.status}`}</small></div><div class="catalog-actions"><button type="button" data-operation-edit="${index}">Sửa</button><button type="button" data-operation-delete="${index}">Xóa</button></div></article>`).join('') : '<p class="empty-state">Chưa có dữ liệu.</p>';
  openModal(config.title, `<div class="entity-summary">Tổng số: <strong>${records.length}</strong></div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-operation-add>＋ Thêm dữ liệu</button>`, () => {
    const openForm = (recordIndex = -1) => {
      const record = records[recordIndex] || {};
      openModal(`${recordIndex >= 0 ? 'Sửa' : 'Thêm'} - ${config.title}`, `<form class="building-form" data-operation-form>${config.fields}<div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Lưu</button></div></form>`, () => {
        const formElement = document.querySelector('[data-operation-form]');
        Object.entries(record).forEach(([key, value]) => { const field = formElement.elements[key]; if (field) field.value = value; });
        document.querySelector('[data-modal-cancel]').addEventListener('click', () => openAssetOperations(type));
        formElement.addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(formElement); const next = { ...record, ...Object.fromEntries(form.entries()), quantity: Number(form.get('quantity') || 0), cost: Number(form.get('cost') || 0), updatedAt: new Date().toISOString() }; if (recordIndex >= 0) records[recordIndex] = next; else records.push(next); if (type === 'moving-logs') { const asset = (catalogs.assets || []).find((item) => item.code === next.asset || item.name === next.asset); if (asset) { asset.warehouse = next.to; asset.status = 'active'; } } if (type === 'asset-fix') { const asset = (catalogs.assets || []).find((item) => item.code === next.asset || item.name === next.asset); if (asset) asset.status = next.status === 'completed' ? 'active' : 'broken'; } persistCatalogs(); openAssetOperations(type); showToast('Đã lưu dữ liệu vận hành'); });
      });
    };
    document.querySelector('[data-operation-add]').addEventListener('click', () => openForm());
    document.querySelectorAll('[data-operation-edit]').forEach((button) => button.addEventListener('click', () => openForm(Number(button.dataset.operationEdit))));
    document.querySelectorAll('[data-operation-delete]').forEach((button) => button.addEventListener('click', () => { if (!window.confirm('Xóa bản ghi này?')) return; records.splice(Number(button.dataset.operationDelete), 1); persistCatalogs(); openAssetOperations(type); }));
  });
}

function openTemplateManager(type) {
  const templateMeta = {
    signatures: ['Mẫu chữ ký', 'Họ tên, chức danh và chữ ký người ký'],
    'deposit-contract': ['Hợp đồng đặt cọc', 'Thông tin đặt cọc, các bên và điều khoản'],
    'rental-contract': ['Hợp đồng thuê', 'Thông tin bên thuê, bên cho thuê và tiền thuê'],
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
    document.querySelectorAll('[data-template-delete]').forEach((button) => button.addEventListener('click', () => { if (!window.confirm('Xóa mẫu biểu này?')) return; records.splice(Number(button.dataset.templateDelete), 1); persistCatalogs(); openTemplateManager(type); }));
    document.querySelectorAll('[data-template-preview]').forEach((button) => button.addEventListener('click', () => { const record = records[Number(button.dataset.templatePreview)]; const preview = window.open('', '_blank', 'width=820,height=900'); preview.document.write(`<title>${escapeHtml(record.name)}</title><main style="font-family:Arial;padding:40px;color:#122a4c"><header style="border-bottom:2px solid #0649a6;padding-bottom:14px"><h1 style="color:#0649a6">PHÚ GIA LAND</h1><h2>${escapeHtml(record.name)}</h2></header><article style="white-space:pre-wrap;margin-top:24px">${escapeHtml(record.content)}</article></main>`); preview.document.close(); preview.print(); }));
  });
}

function openNotifications() {
  const items = notifications.length ? notifications.map((notification, index) => `<article class="notification-item"><span class="notification-dot"></span><div><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.message)}</p><small>${new Date(notification.createdAt).toLocaleString('vi-VN')}</small></div><button type="button" data-notification-read="${index}">${notification.read ? 'Đã đọc' : 'Đánh dấu đã đọc'}</button></article>`).join('') : '<p class="empty-state">Chưa có thông báo nào.</p>';
  openModal('Thông báo', `<div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-notification>＋ Tạo thông báo</button>`, () => {
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
  openModal('Hỗ trợ cư dân', `<div class="entity-summary">Tổng phản ánh: <strong>${feedback.length}</strong> · Đang xử lý: <strong>${openCount}</strong></div><div class="modal-list">${items}</div>`, () => {
    document.querySelectorAll('[data-feedback-status]').forEach((select) => select.addEventListener('change', () => {
      feedback[Number(select.dataset.feedbackStatus)].status = select.value;
      persistCollection(feedbackStorageKey, feedback);
      showToast('Đã cập nhật trạng thái phản ánh');
    }));
  });
}

function openUserManager() {
  const items = users.length ? users.map((user, index) => { const customer = customers.find((item) => item.accountId === user.id || (item.email && item.email === user.email)); return `<article class="modal-option"><div><span>${escapeHtml(user.name)}</span><small>${user.role === 'tenant' ? 'Người thuê' : 'Người quản lý'} · ${escapeHtml(user.email)}${customer ? ` · KH: ${escapeHtml(customer.code || customer.name)}` : ' · Chưa liên kết khách hàng'} · ${user.active === false ? 'Ngừng hoạt động' : 'Đang hoạt động'}</small></div><div class="catalog-actions"><button type="button" data-user-toggle="${index}">${user.active === false ? 'Bật' : 'Ngừng'}</button></div></article>`; }).join('') : '<p class="empty-state">Chưa có tài khoản người thuê.</p>';
  openModal('Tài khoản', `<div class="entity-summary">Tài khoản và hồ sơ khách hàng dùng chung email liên kết.</div><div class="modal-list">${items}</div><button class="modal-secondary" type="button" data-modal-add-user>＋ Tạo tài khoản từ khách hàng</button>`, () => {
    document.querySelector('[data-modal-add-user]').addEventListener('click', () => openModal('Tạo tài khoản người thuê', `<form class="building-form" data-user-form><label>Khách hàng<select name="customerId" required><option value="">Chọn khách hàng</option>${customers.filter((customer) => customer.status === 'renting' && !customer.accountId).map((customer) => `<option value="${escapeHtml(customer.id || '')}" data-name="${escapeHtml(customer.name)}" data-email="${escapeHtml(customer.email || '')}">${escapeHtml(customer.name)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ''}</option>`).join('')}</select></label><label>Họ và tên<input name="name" required maxlength="80"></label><label>Email đăng nhập<input name="email" type="email" required maxlength="120"></label><label>Mật khẩu ban đầu<input name="password" type="password" required minlength="8"></label><div class="form-actions"><button class="modal-secondary" type="button" data-modal-cancel>Hủy</button><button class="primary-button" type="submit">Tạo tài khoản</button></div></form>`, () => {
      document.querySelector('[data-modal-cancel]').addEventListener('click', openUserManager);
      document.querySelector('[data-user-form] [name="customerId"]').addEventListener('change', (event) => { const option = event.target.selectedOptions[0]; document.querySelector('[data-user-form] [name="name"]').value = option.dataset.name || ''; document.querySelector('[data-user-form] [name="email"]').value = option.dataset.email || ''; });
      document.querySelector('[data-user-form]').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const email = form.get('email').trim().toLowerCase(); if (users.some((user) => user.email === email)) { showToast('Email này đã tồn tại'); return; } const submitButton = event.currentTarget.querySelector('[type="submit"]'); submitButton.disabled = true; try { const response = await fetch('/api/tenant-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: form.get('customerId'), name: form.get('name').trim(), email, password: form.get('password') }) }); if (!response.ok) throw new Error(response.status === 409 ? 'Email này đã tồn tại' : 'Không thể tạo tài khoản'); const payload = await response.json(); users.push(payload.user); const customer = customers.find((item) => item.id === form.get('customerId')); if (customer) { customer.email = email; customer.accountId = payload.user.id; persistCustomers(); } localStorage.setItem(userStorageKey, JSON.stringify(users)); openUserManager(); showToast('Đã tạo và liên kết tài khoản khách hàng'); } catch (error) { submitButton.disabled = false; showToast(error.message); } });
    }));
    document.querySelectorAll('[data-user-toggle]').forEach((button) => button.addEventListener('click', () => { const user = users[Number(button.dataset.userToggle)]; user.active = user.active === false; persistCollection(userStorageKey, users); openUserManager(); }));
  });
}

function exportData() {
  const data = Object.fromEntries(stateKeys.map((key) => [key, localStorage.getItem(key)]));
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `phu-gia-land-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Đã xuất bản sao dữ liệu');
}

function importData(file) {
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      const backup = JSON.parse(reader.result);
      if (!backup?.data || typeof backup.data !== 'object') throw new Error('Invalid backup');
      Object.entries(backup.data).forEach(([key, value]) => {
        if (stateKeys.includes(key) && value !== null) localStorage.setItem(key, value);
      });
      showToast('Đã nhập dữ liệu, trang sẽ tải lại');
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      showToast('File backup không hợp lệ');
    }
  });
  reader.readAsText(file);
}

function collectLocalState() {
  return Object.fromEntries(stateKeys.map((key) => [key, localStorage.getItem(key)]));
}

function queueServerSync() {
  window.clearTimeout(syncTimeout);
  syncTimeout = window.setTimeout(() => syncToServer(false), 500);
}

async function syncToServer(showResult = true) {
  try {
    const response = await fetch(`${apiBaseUrl}/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: collectLocalState() }) });
    if (!response.ok) throw new Error('Sync failed');
    if (showResult) showToast('Đã đồng bộ dữ liệu lên máy chủ');
  } catch (error) {
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
        showToast('Đã đổi mật khẩu quản trị viên');
      } catch (error) {
        button.disabled = false;
        showToast(error.message);
      }
    });
  });
}

function openProfile() {
  openModal('Tài khoản', '<div class="profile-summary"><span class="avatar large">NHP</span><div><strong>Nguyễn Hữu Phú</strong><small>Chủ nhà</small></div></div><div class="profile-actions"><button type="button" data-smart-home-settings>Thiết lập API Smart Home</button><button type="button" data-profile-action>Thông tin cá nhân</button><button type="button" data-change-admin-password>Đổi mật khẩu</button><button type="button" data-install-app>Cài đặt ứng dụng</button><button type="button" data-sync-server>Đồng bộ lên máy chủ</button><button type="button" data-pull-server>Tải dữ liệu máy chủ</button><button type="button" data-export-data>Xuất bản sao dữ liệu</button><label class="profile-file">Nhập bản sao dữ liệu<input type="file" accept="application/json" data-import-data></label><button type="button" data-reset-data>Xóa toàn bộ dữ liệu</button><button type="button" data-logout>Đăng xuất</button></div>', () => {
    document.querySelector('[data-smart-home-settings]').addEventListener('click', openSmartHomeSettings);
    document.querySelectorAll('[data-profile-action]').forEach((button) => button.addEventListener('click', () => {
      closeModal();
      showToast(`${button.textContent} đang được mở`);
    }));
    document.querySelector('[data-change-admin-password]').addEventListener('click', () => openAdminPasswordForm());
    document.querySelector('[data-install-app]').addEventListener('click', installApp);
    document.querySelector('[data-sync-server]').addEventListener('click', syncToServer);
    document.querySelector('[data-pull-server]').addEventListener('click', pullFromServer);
    document.querySelector('[data-export-data]').addEventListener('click', exportData);
    document.querySelector('[data-import-data]').addEventListener('change', (event) => event.target.files[0] && importData(event.target.files[0]));
    document.querySelector('[data-reset-data]').addEventListener('click', async () => {
      if (!window.confirm('Xóa vĩnh viễn toàn bộ dữ liệu, tài liệu, cấu hình và đăng xuất?')) return;
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
      document.querySelector('[data-modal-cancel]').addEventListener('click', closeModal);
      document.querySelector('[data-generate-smart-token]').addEventListener('click', () => { document.querySelector('[data-smart-home-config-form] [name="pushToken"]').value = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-', '')}`; });
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
          showToast('Đã lưu cấu hình API Smart Home');
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
  if (target === 'buildings') {
    openBuildingManager();
    return;
  }
  if (target === 'layout') {
    openApartmentManager();
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
  if (target === 'prepayments' || target === 'deposit-ledger') {
    openFinancialSummary(target);
    return;
  }
  if (target === 'daily' || target === 'profit' || target === 'debts' || target === 'payments') {
    openFinancialReport(target);
    return;
  }
  if (target === 'contracts') {
    openWorkflowManager('contracts');
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
  if (target === 'rentals') {
    openWorkflowManager('contracts');
    return;
  }
  if (target === 'general') {
    openProfile();
    return;
  }
  if (Object.prototype.hasOwnProperty.call(catalogConfigs, target)) {
    ['signatures', 'deposit-contract', 'rental-contract', 'handover', 'invoice-template', 'cash-template'].includes(target) ? openTemplateManager(target) : ['assets', 'providers', 'warehouses', 'asset-types', 'moving-logs', 'asset-fix'].includes(target) ? openAssetOperations(target) : openCatalogManager(target);
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
if (buildings.length) {
  selectedBuildingIndex = Math.min(selectedBuildingIndex, buildings.length - 1);
  buildingSelect.firstChild.textContent = buildings[selectedBuildingIndex].name;
  persistBuildings(false);
}
updateDashboard();
hydrateFromServer();
if (new URLSearchParams(window.location.search).get('change-password') === 'required') openAdminPasswordForm(true);

buildingSelect?.addEventListener('click', renderBuildingPicker);
document.querySelector('.asset-stats a[href="#buildings"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  openBuildingManager();
});
document.querySelector('.asset-stats a[href="#apartments"]')?.addEventListener('click', (event) => {
  event.preventDefault();
  openApartmentManager();
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
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js?v=59').then((registration) => registration.update()).catch((error) => console.warn('Service worker registration failed:', error)));
}
