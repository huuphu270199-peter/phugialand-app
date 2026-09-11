const form = document.querySelector('[data-login-form]');
const errorMessage = document.querySelector('[data-login-error]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  errorMessage.hidden = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Đang đăng nhập...';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(response.status === 429 ? 'Too many attempts' : payload.error || 'Không thể đăng nhập');
    sessionStorage.setItem('nvp-user-role', payload.role);
    sessionStorage.setItem('nvp-user-name', payload.name || '');
    window.location.assign(payload.passwordChangeRequired ? '/?change-password=required' : '/');
  } catch (error) {
    errorMessage.textContent = error.message === 'Invalid credentials' ? 'Email hoặc mật khẩu không đúng.' : error.message === 'Too many attempts' ? 'Bạn đã thử quá nhiều lần. Vui lòng đợi 5 phút.' : 'Không thể đăng nhập. Kiểm tra kết nối máy chủ.';
    errorMessage.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = 'Vào hệ thống';
  }
});
