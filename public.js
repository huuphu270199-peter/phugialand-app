const apartmentList = document.querySelector('[data-apartment-list]');
const availabilityCount = document.querySelector('[data-availability-count]');
const propertyTypeLabels = { apartment: 'Căn hộ', office: 'Văn phòng', shophouse: 'Shophouse', 'whole-building': 'Tòa nhà nguyên căn' };
let availableApartments = [];
let selectedPropertyType = 'all';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderApartments(apartments) {
  apartmentList.setAttribute('aria-busy', 'false');
  availabilityCount.textContent = apartments.length ? `${apartments.length} bất động sản đang trống` : 'Hiện chưa có bất động sản trống';
  if (!apartments.length) {
    apartmentList.innerHTML = '<p class="state-message">Hiện chưa có bất động sản phù hợp. Vui lòng quay lại sau.</p>';
    return;
  }
  apartmentList.innerHTML = apartments.map((apartment) => {
    const detail = apartment.propertyType === 'whole-building' ? '<strong>Cho thuê nguyên căn</strong>' : apartment.propertyType === 'office' ? '<strong>Không gian văn phòng</strong>' : apartment.propertyType === 'shophouse' ? '<strong>Mặt bằng thương mại</strong>' : `<strong>${apartment.beds || 0}</strong> giường`;
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
    <p class="card-detail">${detail}</p>
  </article>`;
  }).join('');
}

function renderSelectedPropertyType() {
  renderApartments(selectedPropertyType === 'all' ? availableApartments : availableApartments.filter((apartment) => apartment.propertyType === selectedPropertyType));
}

async function loadAvailability() {
  try {
    const response = await fetch('/api/availability');
    if (!response.ok) throw new Error('Unable to load availability');
    const payload = await response.json();
    availableApartments = Array.isArray(payload.apartments) ? payload.apartments : [];
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
  renderSelectedPropertyType();
}));

loadAvailability();
