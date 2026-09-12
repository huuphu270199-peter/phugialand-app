const frontendCacheName = 'phu-gia-land-v76';
if ('caches' in window) caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('phu-gia-land-') && key !== frontendCacheName).map((key) => caches.delete(key)))).catch(() => {});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js?v=76').then((registration) => registration.update()).catch((error) => console.warn('Tenant service worker registration failed:', error)));

const loginSection = document.querySelector('[data-tenant-login]');
const dashboardSection = document.querySelector('[data-tenant-dashboard]');
const loginForm = document.querySelector('[data-tenant-login-form]');
const loginError = document.querySelector('[data-login-error]');
const installButton = document.querySelector('[data-install-app]');
const installDialog = document.querySelector('[data-install-dialog]');
const installMessage = document.querySelector('[data-install-message]');
const installConfirm = document.querySelector('[data-install-confirm]');
const toast = document.querySelector('[data-tenant-toast]');
let deferredInstallPrompt = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')} đ`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallButton() {
  const label = installButton.querySelector('[data-install-label]');
  if (isStandalone()) {
    label.textContent = 'Đã cài ứng dụng';
    installButton.classList.add('is-installed');
    return;
  }
  label.textContent = deferredInstallPrompt ? 'Cài ứng dụng' : 'Cài trên thiết bị';
  installButton.classList.remove('is-installed');
}

function openInstallDialog() {
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  installMessage.textContent = isiOS
    ? 'Trong Safari, chạm nút Chia sẻ, sau đó chọn “Thêm vào Màn hình chính”.'
    : 'Mở menu trình duyệt và chọn “Cài đặt ứng dụng” hoặc “Thêm vào màn hình chính”.';
  installConfirm.hidden = true;
  if (typeof installDialog.showModal === 'function') installDialog.showModal();
  else installDialog.setAttribute('open', '');
}

async function requestInstall() {
  if (isStandalone()) {
    showToast('Ứng dụng đã được cài trên thiết bị này.');
    return;
  }
  if (!deferredInstallPrompt) {
    openInstallDialog();
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (choice.outcome === 'accepted') showToast('Đang cài Cổng cư dân...');
  updateInstallButton();
}

function renderPortal(payload) {
  loginSection.hidden = true;
  dashboardSection.hidden = false;
  document.querySelector('[data-tenant-name]').textContent = payload.user.name;
  document.querySelector('[data-last-updated]').textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  const invoices = payload.invoices || [];
  const unpaidInvoices = invoices.filter((invoice) => invoice.status !== 'paid');
  const notifications = payload.notifications || [];
  const feedback = payload.feedback || [];
  const openFeedback = feedback.filter((item) => !['resolved', 'completed', 'done'].includes(item.status));

  document.querySelector('[data-summary-unpaid]').textContent = unpaidInvoices.length;
  document.querySelector('[data-summary-amount]').textContent = formatMoney(unpaidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0));
  document.querySelector('[data-summary-notifications]').textContent = notifications.length;
  document.querySelector('[data-summary-feedback]').textContent = openFeedback.length;
  document.querySelector('[data-invoice-count]').textContent = `${invoices.length} hóa đơn`;
  document.querySelector('[data-notification-count]').textContent = `${notifications.length} tin`;

  document.querySelector('[data-tenant-invoices]').innerHTML = invoices.length ? invoices.map((invoice) => {
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const isOverdue = invoice.status !== 'paid' && dueDate && dueDate < new Date();
    const occupants = Number(invoice.allocationRules?.occupants || 0);
    const ruleLabel = (utility) => invoice.allocationRules?.[utility] === 'per-person-fixed' ? 'cố định/người' : invoice.allocationRules?.[utility] === 'equal-occupants' ? `chia đều ${occupants} người` : invoice.allocationRules?.[utility] === 'contract-fixed' ? 'cố định hợp đồng' : '';
    const lines = invoice.billingLines ? [['Tiền thuê', invoice.billingLines.rent], [`Tiền điện${ruleLabel('electricity') ? ` · ${ruleLabel('electricity')}` : ''}`, invoice.billingLines.electricity], [`Tiền nước${ruleLabel('water') ? ` · ${ruleLabel('water')}` : ''}`, invoice.billingLines.water], ...(invoice.serviceItems || []).map((service) => [service.label || 'Phí dịch vụ', service.amount]), ...(Number(invoice.depositApplied || 0) > 0 ? [['Cọc đã khấu trừ', -Number(invoice.depositApplied)]] : [])].filter(([, amount]) => Number(amount || 0) !== 0) : [];
    const breakdown = lines.length ? `<p>${lines.map(([label, amount]) => `${escapeHtml(label)}: ${formatMoney(amount)}`).join(' · ')}</p>` : '';
    return `<article class="tenant-item invoice-item${isOverdue ? ' is-overdue' : ''}"><div><strong>${escapeHtml(invoice.title)}</strong>${breakdown}<p>${dueDate ? `${isOverdue ? 'Đã quá hạn' : 'Hạn thanh toán'} ${dueDate.toLocaleDateString('vi-VN')}` : 'Không có hạn thanh toán'}</p></div><div class="item-value"><b>${formatMoney(invoice.amount)}</b><span class="status ${invoice.status === 'paid' ? 'paid' : isOverdue ? 'overdue' : 'unpaid'}">${invoice.status === 'paid' ? 'Đã thanh toán' : isOverdue ? 'Quá hạn' : 'Chưa thanh toán'}</span></div></article>`;
  }).join('') : '<div class="empty"><strong>Chưa có hóa đơn</strong><span>Hóa đơn mới sẽ xuất hiện tại đây.</span></div>';

  document.querySelector('[data-tenant-notifications]').innerHTML = notifications.length ? notifications.map((notification) => `<article class="tenant-item notification-item"><span class="notification-mark" aria-hidden="true"></span><div><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.message)}</p><small>${new Date(notification.createdAt).toLocaleString('vi-VN')}</small></div></article>`).join('') : '<div class="empty"><strong>Chưa có thông báo</strong><span>Các cập nhật từ ban quản lý sẽ hiển thị tại đây.</span></div>';

  document.querySelector('[data-tenant-feedback]').innerHTML = feedback.length ? feedback.map((item) => `<article class="tenant-item feedback-item"><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${item.category === 'repair' ? 'Yêu cầu sửa chữa' : item.category === 'suggestion' ? 'Đóng góp ý kiến' : item.category === 'complaint' ? 'Phản ánh dịch vụ' : 'Khác'} · ${new Date(item.createdAt).toLocaleString('vi-VN')}</small>${item.imageUrl ? `<a href="${escapeHtml(item.imageUrl)}" target="_blank" rel="noopener">Xem ảnh đính kèm</a>` : ''}</div><span class="status">${item.status === 'new' ? 'Mới tiếp nhận' : item.status === 'processing' ? 'Đang xử lý' : 'Đã hoàn tất'}</span></article>`).join('') : '<div class="empty"><strong>Chưa có yêu cầu</strong><span>Yêu cầu đã gửi sẽ được theo dõi tại đây.</span></div>';
}

async function loadPortal() {
  const response = await fetch('/api/tenant-portal');
  if (!response.ok) {
    loginSection.hidden = false;
    dashboardSection.hidden = true;
    return false;
  }
  renderPortal(await response.json());
  return true;
}

async function enablePushNotifications() {
  const config = await (await fetch('/api/push-config')).json();
  if (!config.enabled || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Máy chủ chưa cấu hình Web Push hoặc trình duyệt không hỗ trợ.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bạn chưa cho phép nhận thông báo.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0)) });
  const response = await fetch('/api/push-subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription }) });
  if (!response.ok) throw new Error('Không thể đăng ký thông báo.');
  document.querySelector('[data-enable-push]').textContent = 'Đã bật thông báo';
  showToast('Đã bật thông báo trên thiết bị này.');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const button = loginForm.querySelector('button');
  button.disabled = true;
  loginError.hidden = true;
  try {
    const response = await fetch('/api/tenant-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') }) });
    if (!response.ok) throw new Error(response.status === 429 ? 'Too many attempts' : 'Invalid credentials');
    await loadPortal();
  } catch (error) {
    loginError.textContent = error.message === 'Too many attempts' ? 'Bạn đã thử quá nhiều lần. Vui lòng đợi 5 phút.' : 'Email hoặc mật khẩu không đúng.';
    loginError.hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-tenant-refresh]').addEventListener('click', async () => { await loadPortal(); showToast('Dữ liệu đã được cập nhật.'); });
document.querySelector('[data-tenant-logout]').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); loginSection.hidden = false; dashboardSection.hidden = true; loginForm.reset(); });
document.querySelector('[data-enable-push]').addEventListener('click', async () => { try { await enablePushNotifications(); } catch (error) { showToast(error.message); } });
installButton.addEventListener('click', requestInstall);
installConfirm.addEventListener('click', requestInstall);
document.querySelector('[data-install-close]').addEventListener('click', () => installDialog.close());

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installConfirm.hidden = false;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; updateInstallButton(); showToast('Cổng cư dân đã được cài đặt.'); });

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.addEventListener('load', () => resolve(reader.result)); reader.addEventListener('error', reject); reader.readAsDataURL(file); });
}

document.querySelector('[data-feedback-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedbackForm = event.currentTarget;
  const form = new FormData(feedbackForm);
  const button = feedbackForm.querySelector('button[type="submit"]');
  const error = document.querySelector('[data-feedback-error]');
  const file = form.get('image');
  error.hidden = true;
  if (file?.size > 700_000) { error.textContent = 'Ảnh cần nhỏ hơn 700 KB.'; error.hidden = false; return; }
  button.disabled = true;
  try {
    const response = await fetch('/api/tenant-feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.get('title'), message: form.get('message'), category: form.get('category'), priority: form.get('priority'), imageDataUrl: file?.size ? await fileToDataUrl(file) : '' }) });
    if (!response.ok) throw new Error('Không thể gửi yêu cầu.');
    feedbackForm.reset();
    await loadPortal();
    showToast('Yêu cầu đã được gửi đến ban quản lý.');
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

updateInstallButton();
loadPortal();