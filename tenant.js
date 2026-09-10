const loginSection = document.querySelector('[data-tenant-login]');
const dashboardSection = document.querySelector('[data-tenant-dashboard]');
const loginForm = document.querySelector('[data-tenant-login-form]');
const loginError = document.querySelector('[data-login-error]');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderPortal(payload) {
  loginSection.hidden = true;
  dashboardSection.hidden = false;
  document.querySelector('[data-tenant-name]').textContent = payload.user.name;
  const invoices = payload.invoices || [];
  const notifications = payload.notifications || [];
  document.querySelector('[data-tenant-invoices]').innerHTML = invoices.length ? invoices.map((invoice) => `<article class="tenant-item"><strong>${escapeHtml(invoice.title)}</strong><p>${Number(invoice.amount || 0).toLocaleString('vi-VN')} đ${invoice.dueDate ? ` · Hạn ${new Date(invoice.dueDate).toLocaleDateString('vi-VN')}` : ''}</p><span class="status ${invoice.status === 'paid' ? '' : 'unpaid'}">${invoice.status === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán'}</span></article>`).join('') : '<p class="empty">Bạn chưa có hóa đơn.</p>';
  document.querySelector('[data-tenant-notifications]').innerHTML = notifications.length ? notifications.map((notification) => `<article class="tenant-item"><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.message)}</p><small>${new Date(notification.createdAt).toLocaleString('vi-VN')}</small></article>`).join('') : '<p class="empty">Bạn chưa có thông báo.</p>';
  const feedback = payload.feedback || [];
  document.querySelector('[data-tenant-feedback]').innerHTML = feedback.length ? feedback.map((item) => `<article class="tenant-item"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${item.category === 'repair' ? 'Yêu cầu sửa chữa' : item.category === 'suggestion' ? 'Đóng góp ý kiến' : item.category === 'complaint' ? 'Phản ánh dịch vụ' : 'Khác'} · ${new Date(item.createdAt).toLocaleString('vi-VN')}</small><span class="status">${item.status === 'new' ? 'Mới tiếp nhận' : item.status === 'processing' ? 'Đang xử lý' : 'Đã hoàn tất'}</span>${item.imageUrl ? `<a href="${escapeHtml(item.imageUrl)}" target="_blank" rel="noopener">Xem ảnh đính kèm</a>` : ''}</article>`).join('') : '<p class="empty">Bạn chưa gửi yêu cầu nào.</p>';
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
  if (!config.enabled || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Máy chủ chưa cấu hình Web Push hoặc trình duyệt không hỗ trợ');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bạn chưa cho phép nhận thông báo');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0)) });
  const response = await fetch('/api/push-subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription }) });
  if (!response.ok) throw new Error('Không thể đăng ký thông báo');
  document.querySelector('[data-enable-push]').textContent = 'Đã bật thông báo';
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const button = loginForm.querySelector('button');
  button.disabled = true;
  loginError.hidden = true;
  try {
    const response = await fetch('/api/tenant-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') }) });
    if (!response.ok) throw new Error('Invalid credentials');
    await loadPortal();
  } catch (error) {
    loginError.textContent = 'Email hoặc mật khẩu không đúng.';
    loginError.hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-tenant-refresh]').addEventListener('click', loadPortal);
document.querySelector('[data-tenant-logout]').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); loginSection.hidden = false; dashboardSection.hidden = true; loginForm.reset(); });
document.querySelector('[data-enable-push]').addEventListener('click', async () => { try { await enablePushNotifications(); } catch (error) { const message = document.querySelector('[data-feedback-error]'); if (message) { message.textContent = error.message; message.hidden = false; } } });
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.addEventListener('load', () => resolve(reader.result)); reader.addEventListener('error', reject); reader.readAsDataURL(file); }); }
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
    if (!response.ok) throw new Error('Không thể gửi yêu cầu');
    feedbackForm.reset();
    await loadPortal();
  } catch (requestError) { error.textContent = requestError.message; error.hidden = false; } finally { button.disabled = false; }
});
loadPortal();
