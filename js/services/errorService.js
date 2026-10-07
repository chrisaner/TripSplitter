export function reportError(error, options = {}) {
  const {
    scope = 'unknown',
    level = 'error',
    userMessage = ''
  } = options;

  const message = error instanceof Error ? error.message : String(error);

  if (level === 'warn') {
    console.warn(`[${scope}] ${message}`, error);
  } else {
    console.error(`[${scope}] ${message}`, error);
  }

  if (userMessage) {
    showToast(userMessage, level);
  }
}

export function showToast(message, level = 'info') {
  const box = document.getElementById('global-toast');
  if (!box) {
    if (level === 'error') alert(message);
    return;
  }

  box.innerText = message;
  box.dataset.level = level;
  box.classList.remove('hidden');

  clearTimeout(box._timer);
  box._timer = setTimeout(() => {
    box.classList.add('hidden');
  }, 2500);
}