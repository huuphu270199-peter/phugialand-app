const apartmentList = document.querySelector('[data-apartment-list]');
const availabilityCount = document.querySelector('[data-availability-count]');
const availabilityTitle = document.querySelector('#availability-title');
const propertyTypeLabels = { apartment: 'Căn hộ', homestay: 'Homestay', 'shared-room': 'Phòng ở ghép', office: 'Văn phòng', shophouse: 'Mặt bằng kinh doanh', 'whole-building': 'Tòa nhà nguyên căn' };
let availableApartments = [];
let selectedPropertyType = 'all';
const availabilityFromInput = document.querySelector('[data-availability-from]');
const availabilityToInput = document.querySelector('[data-availability-to]');
const homestayDateFilter = document.querySelector('[data-homestay-date-filter]');

function dateKey(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function renderHomestayCalendar(apartment) {
  if (apartment.propertyType !== 'homestay') return '';
  const start = new Date(`${availabilityFromInput.value}T00:00:00`);
  const end = new Date(`${availabilityToInput.value}T00:00:00`);
  const bookedDates = new Set(apartment.bookedDates || []);
  const dayCount = Math.max(Math.round((end - start) / 86_400_000) + 1, 1);
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    return `<span class="stay-date ${bookedDates.has(key) ? 'booked' : 'available'}"><b>${formatDate(key)}</b>${bookedDates.has(key) ? 'Đã thuê' : 'Trống'}</span>`;
  }).join('');
  return `<div class="stay-calendar"><strong>Khoảng thuê ${formatDate(availabilityFromInput.value)} - ${formatDate(availabilityToInput.value)}</strong><div class="stay-date-grid">${days}</div></div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderApartments(apartments) {
  const selectedTypeLabel = selectedPropertyType === 'all' ? 'Bất động sản' : propertyTypeLabels[selectedPropertyType] || 'Bất động sản';
  apartmentList.setAttribute('aria-busy', 'false');
  availabilityTitle.textContent = `${selectedTypeLabel} đang trống`;
  availabilityCount.textContent = apartments.length ? `${apartments.length} ${selectedTypeLabel.toLocaleLowerCase('vi-VN')} đang trống` : `Hiện chưa có ${selectedTypeLabel.toLocaleLowerCase('vi-VN')} trống`;
  if (!apartments.length) {
    apartmentList.innerHTML = `<p class="state-message">Hiện chưa có ${selectedTypeLabel.toLocaleLowerCase('vi-VN')} phù hợp. Vui lòng quay lại sau.</p>`;
    return;
  }
  apartmentList.innerHTML = apartments.map((apartment) => {
    const detail = apartment.propertyType === 'whole-building' ? '<strong>Cho thuê nguyên căn</strong>' : apartment.propertyType === 'office' ? '<strong>Không gian văn phòng</strong>' : apartment.propertyType === 'shophouse' ? '<strong>Không gian kinh doanh</strong>' : apartment.propertyType === 'homestay' ? `<strong>Thuê nguyên phòng · Sức chứa ${apartment.beds || 0} giường</strong>` : apartment.propertyType === 'shared-room' ? `<strong>${apartment.beds || 0}</strong> giường cho thuê riêng` : '<strong>Cho thuê căn hộ</strong>';
    const media = Array.isArray(apartment.media) ? apartment.media : [];
    const video = media.find((item) => item.kind === 'video');
    const image = apartment.image || media.find((item) => item.kind === 'image')?.url;
    return `<article class="apartment-card">
    ${image ? `<img class="apartment-image" src="${escapeHtml(image)}" alt="${escapeHtml(apartment.title)}">` : ''}
    ${video ? `<video class="apartment-image" controls preload="metadata" src="${escapeHtml(video.url)}" aria-label="Video ${escapeHtml(apartment.title)}"></video>` : ''}
    <span class="card-tag">${escapeHtml(propertyTypeLabels[apartment.propertyType] || 'Bất động sản')} ĐANG TRỐNG</span>
    <h3>${escapeHtml(apartment.title || apartment.name)}</h3>
    <address>${escapeHtml(apartment.building)}${apartment.address ? `<br>${escapeHtml(apartment.address)}` : ''}</address>
    ${apartment.description ? `<p class="apartment-description">${escapeHtml(apartment.description)}</p>` : ''}
    ${renderHomestayCalendar(apartment)}
    <p class="card-detail">${detail}</p>
  </article>`;
  }).join('');
}

function renderSelectedPropertyType() {
  renderApartments(selectedPropertyType === 'all' ? availableApartments : availableApartments.filter((apartment) => apartment.propertyType === selectedPropertyType));
}

async function loadAvailability() {
  try {
    const query = selectedPropertyType === 'homestay' ? `?from=${encodeURIComponent(availabilityFromInput.value)}&to=${encodeURIComponent(availabilityToInput.value)}` : '';
    const response = await fetch(`/api/availability${query}`);
    if (!response.ok) throw new Error('Unable to load availability');
    const payload = await response.json();
    availableApartments = Array.isArray(payload.apartments) ? payload.apartments.map((apartment) => apartment.propertyType === 'sleepbox' ? { ...apartment, propertyType: 'shared-room' } : apartment) : [];
    renderSelectedPropertyType();
  } catch (error) {
    apartmentList.setAttribute('aria-busy', 'false');
    availabilityCount.textContent = 'Chưa thể tải dữ liệu';
    apartmentList.innerHTML = '<p class="state-message error">Không thể cập nhật danh sách căn hộ lúc này.</p>';
  }
}

document.querySelectorAll('[data-property-filter]').forEach((button) => button.addEventListener('click', () => {
  selectedPropertyType = button.dataset.propertyFilter;
  document.querySelectorAll('[data-property-filter]').forEach((item) => item.classList.toggle('active', item === button));
  homestayDateFilter.hidden = selectedPropertyType !== 'homestay';
  loadAvailability();
}));

const today = new Date();
const defaultEnd = new Date(today);
defaultEnd.setDate(today.getDate() + 1);
availabilityFromInput.value = dateKey(today);
availabilityToInput.value = dateKey(defaultEnd);
availabilityFromInput.min = availabilityFromInput.value;
availabilityToInput.min = availabilityFromInput.value;
availabilityFromInput.addEventListener('change', () => {
  availabilityToInput.min = availabilityFromInput.value;
  if (availabilityToInput.value < availabilityFromInput.value) availabilityToInput.value = availabilityFromInput.value;
  loadAvailability();
});
availabilityToInput.addEventListener('change', loadAvailability);

loadAvailability();
