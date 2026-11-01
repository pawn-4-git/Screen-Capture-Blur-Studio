// content/crop-overlay.js - Area Selection Overlay for Screen Capture
(() => {
  const EXISTING_ID = '__scbs_crop_overlay_root__';
  const existing = document.getElementById(EXISTING_ID);
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = EXISTING_ID;
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    cursor: 'crosshair',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    userSelect: 'none',
    WebkitUserSelect: 'none'
  });

  const banner = document.createElement('div');
  banner.textContent = 'ドラッグしてキャプチャ範囲を選択（Escキーでキャンセル）';
  Object.assign(banner.style, {
    position: 'fixed',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    borderRadius: '9999px',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    color: '#F8FAFC',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    fontWeight: '600',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
    pointerEvents: 'none',
    border: '1px solid rgba(255, 255, 255, 0.15)'
  });

  const selectionBox = document.createElement('div');
  Object.assign(selectionBox.style, {
    position: 'fixed',
    display: 'none',
    border: '2px solid #38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
    borderRadius: '4px',
    pointerEvents: 'none'
  });

  const sizeBadge = document.createElement('div');
  Object.assign(sizeBadge.style, {
    position: 'absolute',
    bottom: '-28px',
    right: '0',
    padding: '2px 8px',
    borderRadius: '4px',
    backgroundColor: '#0284C7',
    color: '#FFFFFF',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    fontWeight: '600',
    whiteSpace: 'nowrap'
  });

  selectionBox.appendChild(sizeBadge);
  overlay.appendChild(banner);
  overlay.appendChild(selectionBox);
  document.documentElement.appendChild(overlay);

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let rafId = null;

  function renderBox() {
    rafId = null;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    selectionBox.style.display = 'block';
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
    sizeBadge.textContent = `${Math.round(width)} × ${Math.round(height)} px`;
  }

  function cleanup() {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
    }
  }

  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    currentX = e.clientX;
    currentY = e.clientY;
    overlay.style.backgroundColor = 'transparent';
    renderBox();
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    currentX = e.clientX;
    currentY = e.clientY;
    if (!rafId) {
      rafId = requestAnimationFrame(renderBox);
    }
  });

  overlay.addEventListener('mouseup', async (e) => {
    if (!isDragging) return;
    isDragging = false;
    currentX = e.clientX;
    currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    cleanup();

    if (width < 12 || height < 12) {
      return;
    }

    // Wait 2 animation frames so the selection overlay is completely gone before capture
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    await chrome.runtime.sendMessage({
      type: 'AREA_SELECTED',
      rect: {
        x: left,
        y: top,
        width,
        height,
        devicePixelRatio: window.devicePixelRatio || 1
      }
    });
  });

  window.addEventListener('keydown', onKeyDown, true);
})();

