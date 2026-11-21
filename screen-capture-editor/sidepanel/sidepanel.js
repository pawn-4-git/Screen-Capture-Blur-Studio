// sidepanel/sidepanel.js - Side Panel Image Capture & Blur/Filter Editor

const MAX_CHAR_ICONS = 5;
const DEFAULT_CHAR_ICON_SIZE = 80;
const iconImageCache = new Map(); // iconId or dataUrl -> HTMLImageElement
let iconSizePreviewTimer = null;

const state = {
  sourceImage: null, // HTMLImageElement of the active (already cropped if area-selected) image
  activeCaptureId: null,
  drawMode: 'brush', // 'brush' (丸ペン) | 'circle' (丸の範囲) | 'rect' (四角の範囲)
  brushSize: 36, // Diameter in image pixels (scaled comfortably)
  spotTool: 'blur', // 'blur' | 'pixelate' | 'mask' | 'box' | 'icon'
  spotStrength: 16,
  spotColor: '#0f172a',
  characterIcons: [], // Up to 5 saved icons: [{ id, name, dataUrl, size }]
  selectedIconId: null,
  replaceTargetIconId: null,
  previewingIconId: null, // Temporarily show icon size preview on canvas when adjusting slider
  selectedStampId: null, // ID of the currently selected placed icon region on the canvas
  iconDragAction: null, // 'create-new' | 'move-existing' | 'resize-existing' | null
  activeManipulatedRegion: null,
  dragOffset: { x: 0, y: 0 },
  regions: [], // Array of region objects in sourceImage coordinates
  isDragging: false,
  dragStart: null,
  dragCurrent: null,
  currentBrushPoints: [],
  hoverPos: null, // Current mouse position in sourceImage coordinates for brush preview
  filters: {
    blur: 0,
    pixelate: 0,
    brightness: 100,
    contrast: 100,
    saturate: 100,
    grayscale: 0,
    sepia: 0,
    padding: 0,
    radius: 0,
    frameColor: '#e2e8f0'
  }
};

// DOM Elements
const els = {
  statusBadge: document.getElementById('status-badge'),
  btnCaptureVisible: document.getElementById('btn-capture-visible'),
  btnCaptureArea: document.getElementById('btn-capture-area'),
  fileUpload: document.getElementById('file-upload'),
  imageDimensions: document.getElementById('image-dimensions'),
  btnUndoRegion: document.getElementById('btn-undo-region'),
  btnClearRegions: document.getElementById('btn-clear-regions'),
  btnClearPreview: document.getElementById('btn-clear-preview'),
  drawModeBar: document.getElementById('draw-mode-bar'),
  modeChips: document.querySelectorAll('.mode-chip'),
  toolChips: document.querySelectorAll('.tool-chip'),
  charIconPanel: document.getElementById('char-icon-panel'),
  charIconCount: document.getElementById('char-icon-count'),
  charIconUpload: document.getElementById('char-icon-upload'),
  charIconReplace: document.getElementById('char-icon-replace'),
  charIconList: document.getElementById('char-icon-list'),
  placedIconSection: document.getElementById('placed-icon-section'),
  placedIconCount: document.getElementById('placed-icon-count'),
  placedIconList: document.getElementById('placed-icon-list'),
  spotControlsStack: document.getElementById('spot-controls-stack'),
  brushSizeRow: document.getElementById('brush-size-row'),
  brushSize: document.getElementById('brush-size'),
  brushSizeVal: document.getElementById('brush-size-val'),
  brushPreviewDot: document.getElementById('brush-preview-dot'),
  spotStrength: document.getElementById('spot-strength'),
  spotStrengthVal: document.getElementById('spot-strength-val'),
  spotColor: document.getElementById('spot-color'),
  emptyState: document.getElementById('empty-state'),
  canvas: document.getElementById('editor-canvas'),
  canvasHint: document.getElementById('canvas-hint'),
  btnResetFilters: document.getElementById('btn-reset-filters'),
  presetBtns: document.querySelectorAll('.preset-btn'),
  filterBlur: document.getElementById('filter-blur'),
  valBlur: document.getElementById('val-blur'),
  filterPixelate: document.getElementById('filter-pixelate'),
  valPixelate: document.getElementById('val-pixelate'),
  filterBrightness: document.getElementById('filter-brightness'),
  valBrightness: document.getElementById('val-brightness'),
  filterContrast: document.getElementById('filter-contrast'),
  valContrast: document.getElementById('val-contrast'),
  filterSaturate: document.getElementById('filter-saturate'),
  valSaturate: document.getElementById('val-saturate'),
  filterGrayscale: document.getElementById('filter-grayscale'),
  valGrayscale: document.getElementById('val-grayscale'),
  filterSepia: document.getElementById('filter-sepia'),
  valSepia: document.getElementById('val-sepia'),
  framePadding: document.getElementById('frame-padding'),
  valPadding: document.getElementById('val-padding'),
  frameRadius: document.getElementById('frame-radius'),
  valRadius: document.getElementById('val-radius'),
  frameColor: document.getElementById('frame-color'),
  btnCopyClipboard: document.getElementById('btn-copy-clipboard'),
  btnDownloadPng: document.getElementById('btn-download-png'),
  historyList: document.getElementById('history-list'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  aiModelBadge: document.getElementById('ai-model-badge'),
  btnAiProtect: document.getElementById('btn-ai-protect'),
  btnAiRestore: document.getElementById('btn-ai-restore'),
  aiProgressWrap: document.getElementById('ai-progress-wrap'),
  aiProgressBar: document.getElementById('ai-progress-bar'),
  aiProgressLabel: document.getElementById('ai-progress-label'),
  aiProgressPct: document.getElementById('ai-progress-pct'),
  aiResultBox: document.getElementById('ai-result-box'),
  aiResultSummary: document.getElementById('ai-result-summary'),
  aiResultDetail: document.getElementById('ai-result-detail')
};

const ctx = els.canvas.getContext('2d');

function setStatus(text, isError = false) {
  els.statusBadge.textContent = text;
  els.statusBadge.style.backgroundColor = isError ? '#fee2e2' : '#eef2ff';
  els.statusBadge.style.color = isError ? '#dc2626' : '#4f46e5';
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    img.src = src;
  });
}

// Compute effective brush diameter in sourceImage pixels so brush feels consistent across resolutions
function getScaledBrushDiameter() {
  if (!state.sourceImage) return state.brushSize;
  const scaleFactor = Math.max(1, state.sourceImage.naturalWidth / 600);
  return Math.round(state.brushSize * scaleFactor);
}

// Compute effective character icon size in sourceImage pixels based on a base UI size (16..420 px)
function getScaledIconSize(baseSize = DEFAULT_CHAR_ICON_SIZE) {
  const numericSize = Math.max(16, Math.min(420, Number(baseSize) || DEFAULT_CHAR_ICON_SIZE));
  if (!state.sourceImage) return numericSize;
  const scaleFactor = Math.max(1, state.sourceImage.naturalWidth / 600);
  return Math.round(numericSize * scaleFactor);
}

function getBaseIconSizeFromScaled(scaledSize) {
  const scaleFactor = state.sourceImage
    ? Math.max(1, state.sourceImage.naturalWidth / 600)
    : 1;
  return Math.max(16, Math.min(420, Math.round(scaledSize / scaleFactor)));
}

function getActiveCharacterIcon() {
  if (!state.characterIcons.length) return null;
  return (
    state.characterIcons.find((item) => item.id === state.selectedIconId) ||
    state.characterIcons[0]
  );
}

async function cacheCharacterIconImage(icon) {
  if (!icon || !icon.dataUrl) return null;
  try {
    const img = await loadImageElement(icon.dataUrl);
    iconImageCache.set(icon.id, img);
    iconImageCache.set(icon.dataUrl, img);
    return img;
  } catch (err) {
    console.warn('Failed to cache character icon image:', err);
    return null;
  }
}

// Update the small circular dot preview next to the brush size slider
function updateBrushPreviewDot() {
  const visualPx = Math.max(6, Math.min(26, Math.round(state.brushSize / 5)));
  els.brushPreviewDot.style.width = `${visualPx}px`;
  els.brushPreviewDot.style.height = `${visualPx}px`;
}

// Crop an image if cropRect is specified (from area selection)
async function prepareCaptureImage(capture) {
  const rawImg = await loadImageElement(capture.dataUrl);
  if (!capture.cropRect) {
    return rawImg;
  }

  const { x, y, width, height, devicePixelRatio = 1 } = capture.cropRect;
  const sx = Math.max(0, Math.round(x * devicePixelRatio));
  const sy = Math.max(0, Math.round(y * devicePixelRatio));
  const sw = Math.min(rawImg.naturalWidth - sx, Math.round(width * devicePixelRatio));
  const sh = Math.min(rawImg.naturalHeight - sy, Math.round(height * devicePixelRatio));

  if (sw <= 4 || sh <= 4) {
    return rawImg;
  }

  const offCanvas = document.createElement('canvas');
  offCanvas.width = sw;
  offCanvas.height = sh;
  const offCtx = offCanvas.getContext('2d');
  offCtx.drawImage(rawImg, sx, sy, sw, sh, 0, 0, sw, sh);

  return await loadImageElement(offCanvas.toDataURL('image/png'));
}

// Build CSS filter string for global image adjustments
function buildFilterString(f) {
  const parts = [];
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.grayscale > 0) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia > 0) parts.push(`sepia(${f.sepia}%)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

// Helper: draw rounded rectangle path
function traceRoundedRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

// Helper: trace ellipse inside bounding box (rx, ry, rw, rh)
function traceEllipseRect(context, rx, ry, rw, rh) {
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  context.beginPath();
  context.ellipse(cx, cy, Math.max(1, rw / 2), Math.max(1, rh / 2), 0, 0, Math.PI * 2);
  context.closePath();
}

// Helper: paint a round brush stroke onto a 2D context
function paintBrushStroke(targetCtx, points, diameter, color = '#000000') {
  if (!points || points.length === 0) return;
  targetCtx.save();
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  targetCtx.lineWidth = diameter;
  targetCtx.strokeStyle = color;
  targetCtx.fillStyle = color;

  if (points.length === 1) {
    targetCtx.beginPath();
    targetCtx.arc(points[0].x, points[0].y, diameter / 2, 0, Math.PI * 2);
    targetCtx.fill();
  } else {
    targetCtx.beginPath();
    targetCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      targetCtx.lineTo(points[i].x, points[i].y);
    }
    targetCtx.stroke();
  }
  targetCtx.restore();
}

// Apply a brush stroke region (mode === 'brush') onto workCanvas
function applyBrushRegion(workCtx, workCanvas, region) {
  const pts = region.points;
  if (!pts || pts.length === 0) return;
  const diameter = Math.max(4, region.brushSize || 36);
  const radius = diameter / 2;

  if (region.type === 'mask') {
    paintBrushStroke(workCtx, pts, diameter, region.color || '#0f172a');
    return;
  }

  if (region.type === 'box') {
    // Semi-transparent round highlighter marker
    workCtx.save();
    workCtx.globalAlpha = 0.38;
    paintBrushStroke(workCtx, pts, diameter, region.color || '#ef4444');
    workCtx.restore();
    return;
  }

  // Compute bounding box of the brush stroke to optimize offscreen canvas work
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const pad = radius + Math.max(8, (region.strength || 16) * 2);
  const bx = Math.max(0, Math.floor(minX - pad));
  const by = Math.max(0, Math.floor(minY - pad));
  const bw = Math.min(workCanvas.width - bx, Math.ceil(maxX - minX + pad * 2));
  const bh = Math.min(workCanvas.height - by, Math.ceil(maxY - minY + pad * 2));

  if (bw < 2 || bh < 2) return;

  // Create effect canvas for the bounding box
  const effectCanvas = document.createElement('canvas');
  effectCanvas.width = bw;
  effectCanvas.height = bh;
  const effectCtx = effectCanvas.getContext('2d');

  if (region.type === 'blur') {
    const scaleFactor = Math.max(1, workCanvas.width / 600);
    const blurPx = Math.max(2, Math.round((region.strength || 16) * scaleFactor * 0.75));
    effectCtx.filter = `blur(${blurPx}px)`;
    effectCtx.drawImage(workCanvas, bx, by, bw, bh, 0, 0, bw, bh);
  } else if (region.type === 'pixelate') {
    const scaleFactor = Math.max(1, workCanvas.width / 600);
    const blockSize = Math.max(4, Math.round((region.strength || 16) * scaleFactor));
    const smallW = Math.max(1, Math.ceil(bw / blockSize));
    const smallH = Math.max(1, Math.ceil(bh / blockSize));

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = smallW;
    smallCanvas.height = smallH;
    const smallCtx = smallCanvas.getContext('2d');
    smallCtx.imageSmoothingEnabled = false;
    smallCtx.drawImage(workCanvas, bx, by, bw, bh, 0, 0, smallW, smallH);

    effectCtx.imageSmoothingEnabled = false;
    effectCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, bw, bh);
  }

  // Create stroke mask canvas and composite with 'source-in'
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = bw;
  maskCanvas.height = bh;
  const maskCtx = maskCanvas.getContext('2d');

  const localPts = pts.map((p) => ({ x: p.x - bx, y: p.y - by }));
  paintBrushStroke(maskCtx, localPts, diameter, '#ffffff');

  maskCtx.globalCompositeOperation = 'source-in';
  maskCtx.drawImage(effectCanvas, 0, 0);

  workCtx.drawImage(maskCanvas, bx, by);
}

// Compute bounding box of a placed or preview character icon region using its own independent size (always full image preserving aspect ratio)
function getIconRegionBounds(workCanvas, region) {
  const iconObj = state.characterIcons.find((item) => item.id === region.iconId);
  const img =
    iconImageCache.get(region.iconId) ||
    iconImageCache.get(region.iconDataUrl) ||
    (iconObj ? iconImageCache.get(iconObj.dataUrl) : null);
  if (!img) return null;

  const natW = Math.max(1, img.naturalWidth || img.width || 100);
  const natH = Math.max(1, img.naturalHeight || img.height || 100);
  const ownScaledSize =
    region.size ||
    (region.baseSize ? getScaledIconSize(region.baseSize) : getScaledIconSize(DEFAULT_CHAR_ICON_SIZE));

  const cx = region.cx ?? region.x ?? workCanvas.width / 2;
  const cy = region.cy ?? region.y ?? workCanvas.height / 2;
  const targetSize = Math.max(12, ownScaledSize);

  let dw = 0;
  let dh = 0;
  if (natW >= natH) {
    dw = targetSize;
    dh = Math.max(8, Math.round(targetSize * (natH / natW)));
  } else {
    dh = targetSize;
    dw = Math.max(8, Math.round(targetSize * (natW / natH)));
  }
  const dx = Math.round(cx - dw / 2);
  const dy = Math.round(cy - dh / 2);

  return {
    img,
    dx,
    dy,
    dw,
    dh,
    cx: dx + dw / 2,
    cy: dy + dh / 2
  };
}

// Draw a character icon region onto workCtx using its own independent size (always full character image)
function applyIconRegion(
  workCtx,
  workCanvas,
  region,
  alpha = 1,
  drawGuide = false,
  isSelectedStamp = false
) {
  const bounds = getIconRegionBounds(workCanvas, region);
  if (!bounds) return;

  const { img, dx, dy, dw, dh } = bounds;

  workCtx.save();
  workCtx.globalAlpha = alpha;
  workCtx.drawImage(img, dx, dy, dw, dh);
  workCtx.restore();

  if (drawGuide || isSelectedStamp) {
    workCtx.save();
    workCtx.strokeStyle = isSelectedStamp
      ? 'rgba(2, 132, 199, 0.95)'
      : 'rgba(79, 70, 229, 0.9)';
    workCtx.lineWidth = Math.max(2, Math.round(workCanvas.width / 350));
    workCtx.setLineDash(isSelectedStamp ? [6, 3] : [5, 4]);
    workCtx.strokeRect(dx, dy, dw, dh);

    if (isSelectedStamp) {
      // Draw bottom-right resize handle on the selected placed character icon
      const handleRadius = Math.max(5, Math.round(workCanvas.width / 110));
      const hx = dx + dw;
      const hy = dy + dh;
      workCtx.setLineDash([]);
      workCtx.fillStyle = '#0284c7';
      workCtx.strokeStyle = '#ffffff';
      workCtx.lineWidth = Math.max(1.5, Math.round(workCanvas.width / 400));
      workCtx.beginPath();
      workCtx.arc(hx, hy, handleRadius, 0, Math.PI * 2);
      workCtx.fill();
      workCtx.stroke();
    }
    workCtx.restore();
  }
}

// Apply a spot effect (brush / circle / rect / icon) onto workCanvas in image coordinates
function applySpotRegion(workCtx, workCanvas, region, includeUI = false) {
  if (region.type === 'icon') {
    const isSelected = Boolean(
      includeUI && region.id && region.id === state.selectedStampId
    );
    applyIconRegion(workCtx, workCanvas, region, 1, false, isSelected);
    return;
  }

  if (region.mode === 'brush') {
    applyBrushRegion(workCtx, workCanvas, region);
    return;
  }

  const isCircle = region.mode === 'circle';
  const rx = Math.max(0, Math.round(Math.min(region.x, region.x + region.w)));
  const ry = Math.max(0, Math.round(Math.min(region.y, region.y + region.h)));
  const rw = Math.min(workCanvas.width - rx, Math.round(Math.abs(region.w)));
  const rh = Math.min(workCanvas.height - ry, Math.round(Math.abs(region.h)));

  if (rw < 2 || rh < 2) return;

  if (region.type === 'blur') {
    const scaleFactor = Math.max(1, workCanvas.width / 600);
    const blurPx = Math.max(2, Math.round(region.strength * scaleFactor * 0.75));
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = workCanvas.width;
    tempCanvas.height = workCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.filter = `blur(${blurPx}px)`;
    tempCtx.drawImage(workCanvas, 0, 0);

    workCtx.save();
    if (isCircle) {
      traceEllipseRect(workCtx, rx, ry, rw, rh);
    } else {
      workCtx.beginPath();
      workCtx.rect(rx, ry, rw, rh);
    }
    workCtx.clip();
    workCtx.drawImage(tempCanvas, 0, 0);
    workCtx.restore();
  } else if (region.type === 'pixelate') {
    const scaleFactor = Math.max(1, workCanvas.width / 600);
    const blockSize = Math.max(4, Math.round(region.strength * scaleFactor));
    const smallW = Math.max(1, Math.ceil(rw / blockSize));
    const smallH = Math.max(1, Math.ceil(rh / blockSize));

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = smallW;
    smallCanvas.height = smallH;
    const smallCtx = smallCanvas.getContext('2d');
    smallCtx.imageSmoothingEnabled = false;
    smallCtx.drawImage(workCanvas, rx, ry, rw, rh, 0, 0, smallW, smallH);

    workCtx.save();
    if (isCircle) {
      traceEllipseRect(workCtx, rx, ry, rw, rh);
      workCtx.clip();
    }
    workCtx.imageSmoothingEnabled = false;
    workCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, rx, ry, rw, rh);
    workCtx.restore();
  } else if (region.type === 'mask') {
    workCtx.save();
    workCtx.fillStyle = region.color || '#0f172a';
    if (isCircle) {
      traceEllipseRect(workCtx, rx, ry, rw, rh);
    } else {
      traceRoundedRect(workCtx, rx, ry, rw, rh, 4);
    }
    workCtx.fill();
    workCtx.restore();
  } else if (region.type === 'box') {
    workCtx.save();
    workCtx.strokeStyle = region.color || '#ef4444';
    const scaleFactor = Math.max(1, workCanvas.width / 600);
    workCtx.lineWidth = Math.max(2, Math.round((region.strength / 3) * scaleFactor));
    if (isCircle) {
      traceEllipseRect(workCtx, rx, ry, rw, rh);
    } else {
      traceRoundedRect(workCtx, rx, ry, rw, rh, 4);
    }
    workCtx.stroke();
    workCtx.restore();
  }
}

// Render full pipeline onto #editor-canvas
// Set includeUI = false when exporting to clipboard or PNG file
function renderCanvas(includeUI = true) {
  if (!state.sourceImage) return;

  const imgW = state.sourceImage.naturalWidth;
  const imgH = state.sourceImage.naturalHeight;
  const f = state.filters;

  // Step 1: Render base image + global filters + spot regions on an intermediate canvas
  const workCanvas = document.createElement('canvas');
  workCanvas.width = imgW;
  workCanvas.height = imgH;
  const workCtx = workCanvas.getContext('2d');

  // Global pixelate if enabled
  if (f.pixelate > 0) {
    const block = Math.max(2, f.pixelate);
    const sw = Math.max(1, Math.ceil(imgW / block));
    const sh = Math.max(1, Math.ceil(imgH / block));
    const tiny = document.createElement('canvas');
    tiny.width = sw;
    tiny.height = sh;
    const tinyCtx = tiny.getContext('2d');
    tinyCtx.filter = buildFilterString(f);
    tinyCtx.drawImage(state.sourceImage, 0, 0, sw, sh);

    workCtx.save();
    workCtx.imageSmoothingEnabled = false;
    workCtx.drawImage(tiny, 0, 0, sw, sh, 0, 0, imgW, imgH);
    workCtx.restore();
  } else {
    workCtx.save();
    workCtx.filter = buildFilterString(f);
    workCtx.drawImage(state.sourceImage, 0, 0, imgW, imgH);
    workCtx.restore();
  }

  // Apply all committed spot regions
  for (const reg of state.regions) {
    applySpotRegion(workCtx, workCanvas, reg, includeUI);
  }

  // Preview active drag region or active brush stroke if dragging
  if (state.isDragging) {
    if (state.spotTool === 'icon') {
      if (state.iconDragAction === 'create-new') {
        const activeIcon = getActiveCharacterIcon();
        if (activeIcon) {
          const pt = state.dragCurrent || state.dragStart || state.hoverPos;
          const w =
            state.dragStart && state.dragCurrent
              ? state.dragCurrent.x - state.dragStart.x
              : 0;
          const h =
            state.dragStart && state.dragCurrent
              ? state.dragCurrent.y - state.dragStart.y
              : 0;
          const dragSpan = Math.max(Math.abs(w), Math.abs(h));
          const isDraggedSize = dragSpan >= 12;

          let draftIconRegion;
          if (isDraggedSize) {
            const draggedScaled = Math.max(16, Math.round(dragSpan));
            draftIconRegion = {
              mode: 'stamp',
              type: 'icon',
              iconId: activeIcon.id,
              iconDataUrl: activeIcon.dataUrl,
              cx: state.dragStart.x + w / 2,
              cy: state.dragStart.y + h / 2,
              size: draggedScaled,
              baseSize: getBaseIconSizeFromScaled(draggedScaled)
            };
          } else {
            const presetScaled = getScaledIconSize(activeIcon.size);
            draftIconRegion = {
              mode: 'stamp',
              type: 'icon',
              iconId: activeIcon.id,
              iconDataUrl: activeIcon.dataUrl,
              cx: pt?.x ?? imgW / 2,
              cy: pt?.y ?? imgH / 2,
              size: presetScaled,
              baseSize: activeIcon.size || DEFAULT_CHAR_ICON_SIZE
            };
          }
          applyIconRegion(workCtx, workCanvas, draftIconRegion, 0.92, includeUI, false);
        }
      }
    } else if (state.drawMode === 'brush' && state.currentBrushPoints.length > 0) {
      const draftBrush = {
        mode: 'brush',
        type: state.spotTool,
        points: state.currentBrushPoints,
        brushSize: getScaledBrushDiameter(),
        strength: state.spotStrength,
        color: state.spotColor
      };
      applySpotRegion(workCtx, workCanvas, draftBrush);
    } else if (state.dragStart && state.dragCurrent) {
      const draftRegion = {
        mode: state.drawMode,
        type: state.spotTool,
        x: state.dragStart.x,
        y: state.dragStart.y,
        w: state.dragCurrent.x - state.dragStart.x,
        h: state.dragCurrent.y - state.dragStart.y,
        strength: state.spotStrength,
        color: state.spotColor
      };
      applySpotRegion(workCtx, workCanvas, draftRegion);

      if (includeUI) {
        workCtx.save();
        workCtx.strokeStyle = '#38bdf8';
        workCtx.lineWidth = Math.max(2, Math.round(imgW / 350));
        workCtx.setLineDash([6, 4]);
        if (state.drawMode === 'circle') {
          const rx = Math.min(draftRegion.x, draftRegion.x + draftRegion.w);
          const ry = Math.min(draftRegion.y, draftRegion.y + draftRegion.h);
          traceEllipseRect(
            workCtx,
            rx,
            ry,
            Math.abs(draftRegion.w),
            Math.abs(draftRegion.h)
          );
          workCtx.stroke();
        } else {
          workCtx.strokeRect(
            draftRegion.x,
            draftRegion.y,
            draftRegion.w,
            draftRegion.h
          );
        }
        workCtx.restore();
      }
    }
  }

  // Draw hover preview or slider-adjustment preview for character icon / brush cursor
  if (includeUI && !state.isDragging) {
    if (state.spotTool === 'icon' && state.hoverPos) {
      const activeIcon = getActiveCharacterIcon();
      if (activeIcon) {
        applyIconRegion(
          workCtx,
          workCanvas,
          {
            mode: 'stamp',
            type: 'icon',
            iconId: activeIcon.id,
            iconDataUrl: activeIcon.dataUrl,
            cx: state.hoverPos.x,
            cy: state.hoverPos.y,
            size: getScaledIconSize(activeIcon.size),
            clipCircle: state.drawMode === 'circle'
          },
          0.78,
          true
        );
      }
    } else if (state.previewingIconId) {
      const previewIcon = state.characterIcons.find(
        (item) => item.id === state.previewingIconId
      );
      if (previewIcon) {
        applyIconRegion(
          workCtx,
          workCanvas,
          {
            mode: 'stamp',
            type: 'icon',
            iconId: previewIcon.id,
            iconDataUrl: previewIcon.dataUrl,
            cx: imgW / 2,
            cy: imgH / 2,
            size: getScaledIconSize(previewIcon.size),
            clipCircle: state.drawMode === 'circle'
          },
          0.85,
          true
        );
      }
    } else if (state.drawMode === 'brush' && state.hoverPos) {
      const r = getScaledBrushDiameter() / 2;
      workCtx.save();
      workCtx.beginPath();
      workCtx.arc(state.hoverPos.x, state.hoverPos.y, r, 0, Math.PI * 2);
      workCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      workCtx.lineWidth = Math.max(2, Math.round(imgW / 300));
      workCtx.stroke();

      workCtx.beginPath();
      workCtx.arc(state.hoverPos.x, state.hoverPos.y, r, 0, Math.PI * 2);
      workCtx.strokeStyle = 'rgba(79, 70, 229, 0.95)';
      workCtx.lineWidth = Math.max(1.5, Math.round(imgW / 450));
      workCtx.setLineDash([4, 4]);
      workCtx.stroke();
      workCtx.restore();
    }
  }

  // Step 2: Compose onto final #editor-canvas with optional frame padding & rounded corners
  const pad = Math.round(f.padding * (imgW / 600));
  const radius = Math.round(f.radius * (imgW / 600));
  const finalW = imgW + pad * 2;
  const finalH = imgH + pad * 2;

  els.canvas.width = finalW;
  els.canvas.height = finalH;
  ctx.clearRect(0, 0, finalW, finalH);

  if (pad > 0) {
    ctx.fillStyle = f.frameColor;
    ctx.fillRect(0, 0, finalW, finalH);
  }

  ctx.save();
  if (radius > 0) {
    traceRoundedRect(ctx, pad, pad, imgW, imgH, radius);
    ctx.clip();
  }
  ctx.drawImage(workCanvas, pad, pad);
  ctx.restore();

  els.btnUndoRegion.disabled = state.regions.length === 0;
  els.btnClearRegions.disabled = state.regions.length === 0;
}

// Convert mouse event on #editor-canvas to sourceImage coordinates
function getImageCoordsFromEvent(e) {
  if (!state.sourceImage) return { x: 0, y: 0 };
  const rect = els.canvas.getBoundingClientRect();
  const scaleX = els.canvas.width / rect.width;
  const scaleY = els.canvas.height / rect.height;

  const canvasX = (e.clientX - rect.left) * scaleX;
  const canvasY = (e.clientY - rect.top) * scaleY;

  const imgW = state.sourceImage.naturalWidth;
  const pad = Math.round(state.filters.padding * (imgW / 600));

  return {
    x: Math.max(0, Math.min(imgW, canvasX - pad)),
    y: Math.max(0, Math.min(state.sourceImage.naturalHeight, canvasY - pad))
  };
}

// Set active capture into editor
async function setCaptureInEditor(capture) {
  try {
    setStatus('画像を読み込み中...');
    const img = await prepareCaptureImage(capture);
    state.sourceImage = img;
    state.activeCaptureId = capture.id;
    state.regions = [];
    state.selectedStampId = null;

    els.emptyState.hidden = true;
    els.canvas.hidden = false;
    els.btnCopyClipboard.disabled = false;
    els.btnDownloadPng.disabled = false;
    if (els.btnClearPreview) els.btnClearPreview.disabled = false;
    els.imageDimensions.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;

    renderPlacedIconList();
    renderCanvas();
    setStatus('編集可能');
  } catch (err) {
    console.error('Failed to load capture in editor:', err);
    setStatus('画像読込エラー', true);
  }
}

// Clear current preview image from editor
async function clearPreviewInEditor() {
  state.sourceImage = null;
  state.activeCaptureId = null;
  state.regions = [];
  state.selectedStampId = null;
  state.currentBrushPoints = [];
  state.dragStart = null;
  state.dragCurrent = null;
  state.hoverPos = null;

  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  els.canvas.hidden = true;
  els.emptyState.hidden = false;
  els.imageDimensions.textContent = '未キャプチャ';

  els.btnCopyClipboard.disabled = true;
  els.btnDownloadPng.disabled = true;
  els.btnUndoRegion.disabled = true;
  els.btnClearRegions.disabled = true;
  if (els.btnClearPreview) els.btnClearPreview.disabled = true;

  renderPlacedIconList();
  await chrome.storage.local.remove('latestCapture');
  const { captureHistory = [] } = await chrome.storage.local.get('captureHistory');
  renderHistory(captureHistory);
  setStatus('プレビューをクリアしました');
}

// Render history thumbnails
function renderHistory(history = []) {
  els.historyList.innerHTML = '';
  if (els.btnClearHistory) {
    els.btnClearHistory.disabled = history.length === 0;
  }
  if (!history.length) {
    const p = document.createElement('p');
    p.className = 'empty-history';
    p.textContent = '履歴はまだありません';
    els.historyList.appendChild(p);
    return;
  }

  for (const item of history) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `history-item${item.id === state.activeCaptureId ? ' active' : ''}`;
    btn.title = `${item.title || 'キャプチャ'} (${new Date(item.createdAt).toLocaleTimeString()})`;

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = item.title || 'キャプチャ履歴';
    btn.appendChild(img);

    btn.addEventListener('click', async () => {
      await setCaptureInEditor(item);
      renderHistory(history);
    });

    els.historyList.appendChild(btn);
  }
}

// Sync filter UI labels and sliders from state.filters
function syncFilterUIFromState() {
  const f = state.filters;
  els.filterBlur.value = f.blur;
  els.valBlur.textContent = `${f.blur} px`;

  els.filterPixelate.value = f.pixelate;
  els.valPixelate.textContent = f.pixelate > 0 ? `${f.pixelate} px` : 'OFF';

  els.filterBrightness.value = f.brightness;
  els.valBrightness.textContent = `${f.brightness}%`;

  els.filterContrast.value = f.contrast;
  els.valContrast.textContent = `${f.contrast}%`;

  els.filterSaturate.value = f.saturate;
  els.valSaturate.textContent = `${f.saturate}%`;

  els.filterGrayscale.value = f.grayscale;
  els.valGrayscale.textContent = `${f.grayscale}%`;

  els.filterSepia.value = f.sepia;
  els.valSepia.textContent = `${f.sepia}%`;

  els.framePadding.value = f.padding;
  els.valPadding.textContent = `${f.padding} px`;

  els.frameRadius.value = f.radius;
  els.valRadius.textContent = `${f.radius} px`;

  els.frameColor.value = f.frameColor;
}

// Event Listeners: Capture Actions
els.btnCaptureVisible.addEventListener('click', async () => {
  try {
    setStatus('キャプチャ中...');
    const response = await chrome.runtime.sendMessage({
      type: 'CAPTURE_VISIBLE_TAB'
    });

    if (!response || !response.ok) {
      setStatus(response?.error || 'キャプチャ失敗', true);
      return;
    }

    await setCaptureInEditor(response.capture);
    const { captureHistory = [] } = await chrome.storage.local.get('captureHistory');
    renderHistory(captureHistory);
    setStatus('キャプチャ完了');
  } catch (err) {
    console.error('Visible capture error:', err);
    setStatus('キャプチャ失敗', true);
  }
});

els.btnCaptureArea.addEventListener('click', async () => {
  try {
    setStatus('範囲を選択してください...');
    const response = await chrome.runtime.sendMessage({
      type: 'START_AREA_SELECTION'
    });

    if (!response || !response.ok) {
      setStatus(response?.error || '範囲選択を開始できません', true);
    }
  } catch (err) {
    console.error('Area selection error:', err);
    setStatus('範囲選択エラー', true);
  }
});

els.fileUpload.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    const record = {
      id: `local_${Date.now()}`,
      dataUrl: reader.result,
      title: file.name,
      createdAt: new Date().toISOString()
    };
    await setCaptureInEditor(record);
    setStatus('ローカル画像読込完了');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

function updateCanvasHint() {
  if (state.spotTool === 'icon') {
    const activeIcon = getActiveCharacterIcon();
    if (!activeIcon) {
      els.canvasHint.textContent =
        'ヒント: 「＋ アイコン追加」からキャラクター画像をアップロードすると、画像上をクリック・ドラッグして隠せます。';
    } else {
      els.canvasHint.textContent = `ヒント: クリックで「${activeIcon.name}」(${activeIcon.size}px) を配置、または隠したい場所をドラッグして任意の大きさで配置できます。配置後のアイコンは個別にサイズ変更・移動も可能です。`;
    }
    return;
  }

  if (state.drawMode === 'brush') {
    els.canvasHint.textContent =
      'ヒント: 画像上をクリック・ドラッグすると、丸いペンでなぞった部分にぼかしやモザイクを入れられます。';
  } else if (state.drawMode === 'circle') {
    els.canvasHint.textContent =
      'ヒント: 画像上をドラッグして、丸（円・楕円）の範囲にぼかしやモザイクを入れられます。';
  } else {
    els.canvasHint.textContent =
      'ヒント: 画像上をドラッグして、四角形の範囲にぼかしやモザイクを入れられます。';
  }
}

function setSpotTool(toolName) {
  state.spotTool = toolName;
  const isIconTool = toolName === 'icon';

  for (const c of els.toolChips) {
    c.classList.toggle('active', c.dataset.tool === toolName);
  }
  if (els.charIconPanel) {
    els.charIconPanel.hidden = !isIconTool;
    els.charIconPanel.classList.toggle('active-mode', isIconTool);
  }
  if (els.drawModeBar) {
    els.drawModeBar.hidden = isIconTool;
  }
  if (els.spotControlsStack) {
    els.spotControlsStack.hidden = isIconTool;
  }
  if (els.brushSizeRow) {
    els.brushSizeRow.hidden = isIconTool || state.drawMode !== 'brush';
  }
  updateCanvasHint();
  renderCanvas();
}

async function saveCharacterIconsToStorage() {
  try {
    await chrome.storage.local.set({
      characterIcons: state.characterIcons,
      selectedCharacterIconId: state.selectedIconId
    });
  } catch (err) {
    console.error('Failed to save character icons:', err);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsDataURL(file);
  });
}

// Normalize uploaded character icon to at most 512x512 PNG so 5 icons fit comfortably in chrome.storage.local
async function normalizeCharacterIconFile(file) {
  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);
  const maxDim = 512;
  const w = img.naturalWidth || img.width || 128;
  const h = img.naturalHeight || img.height || 128;

  if (w <= maxDim && h <= maxDim) {
    return rawDataUrl;
  }

  const scale = maxDim / Math.max(w, h);
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));
  const offCanvas = document.createElement('canvas');
  offCanvas.width = targetW;
  offCanvas.height = targetH;
  const offCtx = offCanvas.getContext('2d');
  offCtx.drawImage(img, 0, 0, targetW, targetH);
  return offCanvas.toDataURL('image/png');
}

function syncActiveCharacterIconClasses() {
  if (!els.charIconList) return;
  const rows = els.charIconList.querySelectorAll('.char-icon-item');
  for (const row of rows) {
    const isSelected = row.dataset.iconId === state.selectedIconId;
    row.classList.toggle('active', isSelected);
    const pill = row.querySelector('.char-icon-active-pill');
    if (pill) {
      pill.hidden = !isSelected;
    }
  }
}

function syncActivePlacedStampClasses() {
  if (!els.placedIconList) return;
  const rows = els.placedIconList.querySelectorAll('.placed-icon-item');
  for (const row of rows) {
    row.classList.toggle(
      'active-stamp',
      row.dataset.stampId === state.selectedStampId
    );
  }
}

function syncPlacedStampSliderUI(stampId, baseSize) {
  if (!els.placedIconList) return;
  const row = els.placedIconList.querySelector(
    `.placed-icon-item[data-stamp-id="${stampId}"]`
  );
  if (!row) return;
  const slider = row.querySelector('input[type="range"]');
  const output = row.querySelector('output');
  if (slider) slider.value = String(baseSize);
  if (output) output.textContent = `${baseSize} px`;
}

// Render list of character icons already placed on the current canvas so each hidden spot's size can be adjusted independently
function renderPlacedIconList() {
  if (!els.placedIconSection || !els.placedIconList || !els.placedIconCount) return;

  const placedStamps = state.regions.filter((r) => r.type === 'icon');
  els.placedIconCount.textContent = `${placedStamps.length} 箇所`;
  els.placedIconList.innerHTML = '';

  if (placedStamps.length === 0) {
    els.placedIconSection.hidden = true;
    return;
  }

  els.placedIconSection.hidden = false;

  placedStamps.forEach((stamp, idx) => {
    if (!stamp.id) {
      stamp.id = `stamp_${Date.now()}_${idx}`;
    }
    const baseSize =
      stamp.baseSize || getBaseIconSizeFromScaled(stamp.size || DEFAULT_CHAR_ICON_SIZE);
    stamp.baseSize = baseSize;

    const row = document.createElement('div');
    row.className = `placed-icon-item${stamp.id === state.selectedStampId ? ' active-stamp' : ''}`;
    row.dataset.stampId = stamp.id;

    const thumb = document.createElement('img');
    thumb.className = 'placed-icon-thumb';
    thumb.src = stamp.iconDataUrl;
    thumb.alt = `配置 #${idx + 1}`;

    const labelBtn = document.createElement('button');
    labelBtn.type = 'button';
    labelBtn.className = 'char-icon-name-btn placed-icon-label';
    labelBtn.textContent = `配置 #${idx + 1}`;
    labelBtn.title = 'クリックしてキャンバス上のこのアイコンを選択';
    labelBtn.addEventListener('click', () => {
      state.selectedStampId = stamp.id;
      syncActivePlacedStampClasses();
      renderCanvas();
    });

    const sliderId = `placed-size-${stamp.id}`;
    const slider = document.createElement('input');
    slider.id = sliderId;
    slider.className = 'char-icon-size-slider';
    slider.type = 'range';
    slider.min = '16';
    slider.max = '420';
    slider.step = '2';
    slider.value = String(baseSize);
    slider.title = `配置 #${idx + 1} の大きさを個別に調整`;

    const output = document.createElement('output');
    output.className = 'char-icon-size-val';
    output.htmlFor = sliderId;
    output.textContent = `${baseSize} px`;

    slider.addEventListener('input', () => {
      const newBaseSize = Number(slider.value);
      stamp.baseSize = newBaseSize;
      stamp.size = getScaledIconSize(newBaseSize);
      output.textContent = `${newBaseSize} px`;
      state.selectedStampId = stamp.id;
      syncActivePlacedStampClasses();
      renderCanvas();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-icon-slot btn-icon-slot-remove';
    delBtn.textContent = '×';
    delBtn.title = `配置 #${idx + 1} を画面から消す`;
    delBtn.addEventListener('click', () => {
      state.regions = state.regions.filter((r) => r !== stamp);
      if (state.selectedStampId === stamp.id) {
        const remaining = state.regions.filter((r) => r.type === 'icon');
        state.selectedStampId = remaining[remaining.length - 1]?.id || null;
      }
      renderPlacedIconList();
      renderCanvas();
    });

    row.appendChild(thumb);
    row.appendChild(labelBtn);
    row.appendChild(slider);
    row.appendChild(output);
    row.appendChild(delBtn);
    els.placedIconList.appendChild(row);
  });
}

function renderCharacterIconList() {
  if (!els.charIconList || !els.charIconCount) return;

  const count = state.characterIcons.length;
  els.charIconCount.textContent = `${count} / ${MAX_CHAR_ICONS} 保存`;
  els.charIconList.innerHTML = '';

  if (count === 0) {
    const emptyP = document.createElement('p');
    emptyP.className = 'char-icon-empty';
    emptyP.textContent =
      '「＋ アイコン追加」からキャラクター画像をアップロードしてください（最大5つ）';
    els.charIconList.appendChild(emptyP);
    return;
  }

  state.characterIcons.forEach((icon, index) => {
    const isSelected = icon.id === state.selectedIconId;
    const itemEl = document.createElement('div');
    itemEl.className = `char-icon-item${isSelected ? ' active' : ''}`;
    itemEl.dataset.iconId = icon.id;

    // Thumbnail button
    const thumbBtn = document.createElement('button');
    thumbBtn.type = 'button';
    thumbBtn.className = 'char-icon-thumb-btn';
    thumbBtn.title = `「${icon.name}」を選択して隠す`;
    const thumbImg = document.createElement('img');
    thumbImg.src = icon.dataUrl;
    thumbImg.alt = icon.name;
    thumbBtn.appendChild(thumbImg);

    const selectThisIcon = async () => {
      state.selectedIconId = icon.id;
      syncActiveCharacterIconClasses();
      setSpotTool('icon');
      await saveCharacterIconsToStorage();
      setStatus(`アイコン「${icon.name}」を選択中`);
    };

    thumbBtn.addEventListener('click', selectThisIcon);

    // Middle column: Name + Action buttons + Placement Size Slider
    const mainCol = document.createElement('div');
    mainCol.className = 'char-icon-main';

    const topRow = document.createElement('div');
    topRow.className = 'char-icon-top-row';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'char-icon-name-btn';
    nameBtn.title = `クリックして「${icon.name}」を使用`;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${index + 1}. ${icon.name}`;
    nameBtn.appendChild(nameSpan);

    const activePill = document.createElement('span');
    activePill.className = 'char-icon-active-pill';
    activePill.textContent = '選択中';
    activePill.hidden = !isSelected;
    nameBtn.appendChild(activePill);

    nameBtn.addEventListener('click', selectThisIcon);

    const itemBtns = document.createElement('div');
    itemBtns.className = 'char-icon-item-btns';

    const replaceBtn = document.createElement('button');
    replaceBtn.type = 'button';
    replaceBtn.className = 'btn-icon-slot';
    replaceBtn.textContent = '変更';
    replaceBtn.title = 'このスロットのアイコン画像を別のローカル画像に変更';
    replaceBtn.addEventListener('click', () => {
      state.replaceTargetIconId = icon.id;
      els.charIconReplace?.click();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-icon-slot btn-icon-slot-remove';
    removeBtn.textContent = '×';
    removeBtn.title = '保存リストから登録解除';
    removeBtn.addEventListener('click', async () => {
      state.characterIcons = state.characterIcons.filter((c) => c.id !== icon.id);
      if (state.selectedIconId === icon.id) {
        state.selectedIconId = state.characterIcons[0]?.id || null;
      }
      await saveCharacterIconsToStorage();
      renderCharacterIconList();
      updateCanvasHint();
      renderCanvas();
      setStatus('アイコンの登録を解除しました');
    });

    itemBtns.appendChild(replaceBtn);
    itemBtns.appendChild(removeBtn);

    topRow.appendChild(nameBtn);
    topRow.appendChild(itemBtns);

    // Placement Size Slider Row for this character icon (sets size for next placement; does NOT overwrite already placed spots)
    const sizeRow = document.createElement('div');
    sizeRow.className = 'char-icon-size-row';

    const sliderId = `char-size-${icon.id}`;
    const sizeLabel = document.createElement('label');
    sizeLabel.className = 'char-icon-size-label';
    sizeLabel.htmlFor = sliderId;
    sizeLabel.textContent = '配置サイズ';

    const sizeSlider = document.createElement('input');
    sizeSlider.id = sliderId;
    sizeSlider.className = 'char-icon-size-slider';
    sizeSlider.type = 'range';
    sizeSlider.min = '16';
    sizeSlider.max = '420';
    sizeSlider.step = '2';
    sizeSlider.value = String(icon.size || DEFAULT_CHAR_ICON_SIZE);

    const sizeOutput = document.createElement('output');
    sizeOutput.className = 'char-icon-size-val';
    sizeOutput.htmlFor = sliderId;
    sizeOutput.textContent = `${icon.size || DEFAULT_CHAR_ICON_SIZE} px`;

    sizeSlider.addEventListener('input', () => {
      const newSize = Number(sizeSlider.value);
      icon.size = newSize;
      sizeOutput.textContent = `${newSize} px`;

      state.selectedIconId = icon.id;
      syncActiveCharacterIconClasses();
      if (state.spotTool !== 'icon') {
        setSpotTool('icon');
      } else {
        updateCanvasHint();
      }

      // Show a temporary size preview on the canvas for the next placement without altering already-placed stamps
      state.previewingIconId = icon.id;
      if (iconSizePreviewTimer) clearTimeout(iconSizePreviewTimer);
      iconSizePreviewTimer = setTimeout(() => {
        state.previewingIconId = null;
        renderCanvas();
      }, 900);

      renderCanvas();
    });

    sizeSlider.addEventListener('change', async () => {
      await saveCharacterIconsToStorage();
    });

    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(sizeSlider);
    sizeRow.appendChild(sizeOutput);

    mainCol.appendChild(topRow);
    mainCol.appendChild(sizeRow);

    itemEl.appendChild(thumbBtn);
    itemEl.appendChild(mainCol);
    els.charIconList.appendChild(itemEl);
  });
}

// Hit-test placed character icons on the canvas (for individual on-canvas resize handle or move)
function hitTestPlacedIconRegion(pt) {
  if (!state.sourceImage) return null;
  const dummyCanvas = {
    width: state.sourceImage.naturalWidth,
    height: state.sourceImage.naturalHeight
  };
  const handleHitRadius = Math.max(12, Math.round(dummyCanvas.width / 45));

  for (let i = state.regions.length - 1; i >= 0; i--) {
    const reg = state.regions[i];
    if (reg.type !== 'icon') continue;
    const bounds = getIconRegionBounds(dummyCanvas, reg);
    if (!bounds) continue;

    const hx = bounds.dx + bounds.dw;
    const hy = bounds.dy + bounds.dh;
    if (Math.hypot(pt.x - hx, pt.y - hy) <= handleHitRadius) {
      return { action: 'resize-existing', region: reg, bounds };
    }

    if (
      pt.x >= bounds.dx &&
      pt.x <= bounds.dx + bounds.dw &&
      pt.y >= bounds.dy &&
      pt.y <= bounds.dy + bounds.dh
    ) {
      return { action: 'move-existing', region: reg, bounds };
    }
  }
  return null;
}

// Event Listeners: Character Icon Upload & Slot Replace
els.charIconUpload?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;

  try {
    setStatus('アイコン画像を読み込み中...');
    let lastAddedId = state.selectedIconId;

    for (const file of files) {
      const dataUrl = await normalizeCharacterIconFile(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, '') || 'キャラアイコン';

      if (state.characterIcons.length < MAX_CHAR_ICONS) {
        const newIcon = {
          id: `cicon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: cleanName,
          dataUrl,
          size: DEFAULT_CHAR_ICON_SIZE
        };
        await cacheCharacterIconImage(newIcon);
        state.characterIcons.push(newIcon);
        lastAddedId = newIcon.id;
      } else {
        // When all 5 slots are full, update the currently selected slot (or the last slot)
        const targetIdx = Math.max(
          0,
          state.characterIcons.findIndex((c) => c.id === state.selectedIconId)
        );
        const existing = state.characterIcons[targetIdx];
        existing.name = cleanName;
        existing.dataUrl = dataUrl;
        await cacheCharacterIconImage(existing);
        lastAddedId = existing.id;
      }
    }

    state.selectedIconId = lastAddedId;
    await saveCharacterIconsToStorage();
    renderCharacterIconList();
    setSpotTool('icon');
    setStatus(`キャラクターアイコンを保存しました (${state.characterIcons.length}/${MAX_CHAR_ICONS})`);
  } catch (err) {
    console.error('Character icon upload error:', err);
    setStatus('アイコンの読み込みに失敗しました', true);
  }
});

els.charIconReplace?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  const targetId = state.replaceTargetIconId;
  state.replaceTargetIconId = null;
  if (!file || !targetId) return;

  try {
    const targetIcon = state.characterIcons.find((c) => c.id === targetId);
    if (!targetIcon) return;

    const dataUrl = await normalizeCharacterIconFile(file);
    targetIcon.name = file.name.replace(/\.[^/.]+$/, '') || 'キャラアイコン';
    targetIcon.dataUrl = dataUrl;
    await cacheCharacterIconImage(targetIcon);

    state.selectedIconId = targetIcon.id;
    await saveCharacterIconsToStorage();
    renderCharacterIconList();
    setSpotTool('icon');
    setStatus(`「${targetIcon.name}」のアイコン画像を更新しました`);
  } catch (err) {
    console.error('Character icon replace error:', err);
    setStatus('アイコンの変更に失敗しました', true);
  }
});

// Event Listeners: Draw Mode Chips ('brush' | 'circle' | 'rect')
for (const modeBtn of els.modeChips) {
  modeBtn.addEventListener('click', () => {
    for (const m of els.modeChips) m.classList.remove('active');
    modeBtn.classList.add('active');
    state.drawMode = modeBtn.dataset.mode;

    els.brushSizeRow.hidden = state.drawMode !== 'brush';
    updateCanvasHint();
    renderCanvas();
  });
}

// Event Listeners: Brush Size Slider
els.brushSize.addEventListener('input', () => {
  state.brushSize = Number(els.brushSize.value);
  els.brushSizeVal.textContent = `${state.brushSize} px`;
  updateBrushPreviewDot();
  renderCanvas();
});

// Event Listeners: Spot Tool Chips & Canvas Dragging
for (const chip of els.toolChips) {
  chip.addEventListener('click', () => {
    setSpotTool(chip.dataset.tool);
  });
}

els.spotStrength.addEventListener('input', () => {
  state.spotStrength = Number(els.spotStrength.value);
  els.spotStrengthVal.textContent = String(state.spotStrength);
});

els.spotColor.addEventListener('input', () => {
  state.spotColor = els.spotColor.value;
});

els.canvas.addEventListener('mousedown', (e) => {
  if (!state.sourceImage || e.button !== 0) return;

  const pt = getImageCoordsFromEvent(e);
  state.hoverPos = pt;
  state.previewingIconId = null;

  if (state.spotTool === 'icon') {
    // Check if user clicked on an already-placed character icon's resize handle or body
    const hit = hitTestPlacedIconRegion(pt);
    if (hit) {
      state.isDragging = true;
      state.iconDragAction = hit.action;
      state.activeManipulatedRegion = hit.region;
      state.selectedStampId = hit.region.id;
      state.dragStart = pt;
      state.dragCurrent = pt;
      state.dragOffset = {
        x: pt.x - hit.bounds.cx,
        y: pt.y - hit.bounds.cy
      };
      syncActivePlacedStampClasses();
      renderCanvas();
      return;
    }

    if (!getActiveCharacterIcon()) {
      setStatus('先に「＋ アイコン追加」からキャラクター画像をアップロードしてください', true);
      return;
    }

    state.isDragging = true;
    state.iconDragAction = 'create-new';
    state.activeManipulatedRegion = null;
    state.dragStart = pt;
    state.dragCurrent = pt;
  } else if (state.drawMode === 'brush') {
    state.isDragging = true;
    state.currentBrushPoints = [pt];
  } else {
    state.isDragging = true;
    state.dragStart = pt;
    state.dragCurrent = pt;
  }
  renderCanvas();
});

els.canvas.addEventListener('mousemove', (e) => {
  if (!state.sourceImage) return;
  state.hoverPos = getImageCoordsFromEvent(e);
  if (!state.isDragging && (state.drawMode === 'brush' || state.spotTool === 'icon')) {
    renderCanvas();
  }
});

els.canvas.addEventListener('mouseleave', () => {
  state.hoverPos = null;
  if (!state.isDragging) {
    renderCanvas();
  }
});

window.addEventListener('mousemove', (e) => {
  if (!state.isDragging) return;
  const pt = getImageCoordsFromEvent(e);
  state.hoverPos = pt;

  if (state.spotTool === 'icon') {
    state.dragCurrent = pt;
    const targetReg = state.activeManipulatedRegion;
    if (state.iconDragAction === 'move-existing' && targetReg) {
      const newCx = pt.x - state.dragOffset.x;
      const newCy = pt.y - state.dragOffset.y;
      targetReg.cx = newCx;
      targetReg.cy = newCy;
      if (targetReg.customBox && targetReg.w !== undefined && targetReg.h !== undefined) {
        targetReg.x = newCx - Math.abs(targetReg.w) / 2;
        targetReg.y = newCy - Math.abs(targetReg.h) / 2;
      }
    } else if (state.iconDragAction === 'resize-existing' && targetReg) {
      const cx = targetReg.cx ?? state.dragStart.x;
      const cy = targetReg.cy ?? state.dragStart.y;
      const dist = Math.max(Math.abs(pt.x - cx), Math.abs(pt.y - cy)) * 2;
      const newScaledSize = Math.max(16, Math.round(dist));
      const newBaseSize = getBaseIconSizeFromScaled(newScaledSize);
      targetReg.size = newScaledSize;
      targetReg.baseSize = newBaseSize;
      syncPlacedStampSliderUI(targetReg.id, newBaseSize);
    }
  } else if (state.drawMode === 'brush') {
    const last = state.currentBrushPoints[state.currentBrushPoints.length - 1];
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 2) {
      state.currentBrushPoints.push(pt);
    }
  } else {
    state.dragCurrent = pt;
  }
  renderCanvas();
});

window.addEventListener('mouseup', () => {
  if (!state.isDragging) return;
  state.isDragging = false;

  if (state.spotTool === 'icon') {
    if (state.iconDragAction === 'create-new') {
      const activeIcon = getActiveCharacterIcon();
      const pt = state.dragCurrent || state.dragStart;
      if (activeIcon && pt) {
        const w =
          state.dragStart && state.dragCurrent
            ? state.dragCurrent.x - state.dragStart.x
            : 0;
        const h =
          state.dragStart && state.dragCurrent
            ? state.dragCurrent.y - state.dragStart.y
            : 0;
        const dragSpan = Math.max(Math.abs(w), Math.abs(h));
        const isDraggedSize = dragSpan >= 12;
        const stampId = `stamp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        if (isDraggedSize) {
          const draggedScaled = Math.max(16, Math.round(dragSpan));
          const draggedBase = getBaseIconSizeFromScaled(draggedScaled);
          state.regions.push({
            id: stampId,
            mode: 'stamp',
            type: 'icon',
            iconId: activeIcon.id,
            iconDataUrl: activeIcon.dataUrl,
            cx: state.dragStart.x + w / 2,
            cy: state.dragStart.y + h / 2,
            size: draggedScaled,
            baseSize: draggedBase
          });
        } else {
          const baseSize = activeIcon.size || DEFAULT_CHAR_ICON_SIZE;
          state.regions.push({
            id: stampId,
            mode: 'stamp',
            type: 'icon',
            iconId: activeIcon.id,
            iconDataUrl: activeIcon.dataUrl,
            cx: pt.x,
            cy: pt.y,
            size: getScaledIconSize(baseSize),
            baseSize
          });
        }
        state.selectedStampId = stampId;
        renderPlacedIconList();
      }
    } else {
      renderPlacedIconList();
    }
    state.iconDragAction = null;
    state.activeManipulatedRegion = null;
  } else if (state.drawMode === 'brush') {
    if (state.currentBrushPoints.length > 0) {
      state.regions.push({
        mode: 'brush',
        type: state.spotTool,
        points: [...state.currentBrushPoints],
        brushSize: getScaledBrushDiameter(),
        strength: state.spotStrength,
        color: state.spotColor
      });
    }
    state.currentBrushPoints = [];
  } else if (state.dragStart && state.dragCurrent) {
    const w = state.dragCurrent.x - state.dragStart.x;
    const h = state.dragCurrent.y - state.dragStart.y;
    if (Math.abs(w) >= 6 && Math.abs(h) >= 6) {
      state.regions.push({
        mode: state.drawMode,
        type: state.spotTool,
        x: state.dragStart.x,
        y: state.dragStart.y,
        w,
        h,
        strength: state.spotStrength,
        color: state.spotColor
      });
    }
  }

  state.dragStart = null;
  state.dragCurrent = null;
  renderCanvas();
});

els.btnUndoRegion.addEventListener('click', () => {
  if (state.regions.length > 0) {
    const removed = state.regions.pop();
    if (removed && removed.id === state.selectedStampId) {
      const remaining = state.regions.filter((r) => r.type === 'icon');
      state.selectedStampId = remaining[remaining.length - 1]?.id || null;
    }
    renderPlacedIconList();
    renderCanvas();
  }
});

els.btnClearRegions.addEventListener('click', () => {
  state.regions = [];
  state.selectedStampId = null;
  renderPlacedIconList();
  renderCanvas();
});

els.btnClearPreview?.addEventListener('click', async () => {
  try {
    await clearPreviewInEditor();
  } catch (err) {
    console.error('Clear preview error:', err);
    setStatus('プレビューのクリアに失敗しました', true);
  }
});

els.btnClearHistory?.addEventListener('click', async () => {
  try {
    await chrome.storage.local.remove(['captureHistory', 'latestCapture']);
    renderHistory([]);
    setStatus('履歴をクリアしました');
  } catch (err) {
    console.error('Clear history error:', err);
    setStatus('履歴のクリアに失敗しました', true);
  }
});

// Event Listeners: Global Blur Presets & Filter Sliders
for (const btn of els.presetBtns) {
  btn.addEventListener('click', () => {
    state.filters.blur = Number(btn.dataset.blurPreset);
    syncFilterUIFromState();
    renderCanvas();
  });
}

function bindSlider(inputEl, filterKey) {
  inputEl.addEventListener('input', () => {
    state.filters[filterKey] = Number(inputEl.value);
    syncFilterUIFromState();
    renderCanvas();
  });
}

bindSlider(els.filterBlur, 'blur');
bindSlider(els.filterPixelate, 'pixelate');
bindSlider(els.filterBrightness, 'brightness');
bindSlider(els.filterContrast, 'contrast');
bindSlider(els.filterSaturate, 'saturate');
bindSlider(els.filterGrayscale, 'grayscale');
bindSlider(els.filterSepia, 'sepia');
bindSlider(els.framePadding, 'padding');
bindSlider(els.frameRadius, 'radius');

els.frameColor.addEventListener('input', () => {
  state.filters.frameColor = els.frameColor.value;
  renderCanvas();
});

els.btnResetFilters.addEventListener('click', () => {
  state.filters = {
    blur: 0,
    pixelate: 0,
    brightness: 100,
    contrast: 100,
    saturate: 100,
    grayscale: 0,
    sepia: 0,
    padding: 0,
    radius: 0,
    frameColor: '#e2e8f0'
  };
  syncFilterUIFromState();
  renderCanvas();
  setStatus('フィルターをリセットしました');
});

// Event Listeners: Export (Clipboard & Download) — render without cursor UI before exporting
els.btnCopyClipboard.addEventListener('click', async () => {
  if (!state.sourceImage) return;
  try {
    renderCanvas(false);
    const blob = await new Promise((resolve) =>
      els.canvas.toBlob(resolve, 'image/png')
    );
    renderCanvas(true);
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    setStatus('クリップボードにコピーしました');
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    setStatus('コピーに失敗しました', true);
  }
});

els.btnDownloadPng.addEventListener('click', async () => {
  if (!state.sourceImage) return;
  try {
    renderCanvas(false);
    const dataUrl = els.canvas.toDataURL('image/png');
    renderCanvas(true);

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const filename = `screen-capture-${timestamp}.png`;

    const res = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGE',
      dataUrl,
      filename
    });

    if (res && res.ok) {
      setStatus('PNG画像を保存しました');
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
      setStatus('PNG画像を保存しました');
    }
  } catch (err) {
    console.error('Download failed:', err);
    setStatus('保存に失敗しました', true);
  }
});

// Listen for new captures from Service Worker (e.g. Area Selection or Context Menu)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NEW_CAPTURE_SAVED' && message.capture) {
    (async () => {
      await setCaptureInEditor(message.capture);
      const { captureHistory = [] } = await chrome.storage.local.get('captureHistory');
      renderHistory(captureHistory);
    })();
  }
});

// ============================================================================
// Prompt API (LanguageModel) Integration — Per-HTML-Element Judgment & Protection
// ============================================================================

let baseTextSession = null;
let lastProtectedTabId = null;

function setAiProgress(pct, labelText) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  els.aiProgressWrap.hidden = false;
  els.aiProgressBar.value = clamped;
  els.aiProgressPct.textContent = `${clamped}%`;
  els.aiProgressLabel.textContent = labelText;
}

// Check Prompt API availability and pre-warm base session on user interaction
async function checkAndPreparePromptApi() {
  if (!('LanguageModel' in self)) {
    els.aiModelBadge.textContent = 'AI + ルール併用';
    return 'unavailable';
  }
  try {
    const availability = await LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
      expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }]
    });
    if (availability === 'unavailable') {
      els.aiModelBadge.textContent = 'ローカルルール保護';
    } else if (availability === 'available') {
      els.aiModelBadge.textContent = 'Prompt API Ready';
    } else {
      els.aiModelBadge.textContent = 'Prompt API (DL可)';
    }
    return availability;
  } catch {
    els.aiModelBadge.textContent = 'AI + ルール併用';
    return 'unavailable';
  }
}

async function getOrCreateBaseTextSession(onDownloadProgress) {
  if (baseTextSession) return baseTextSession;
  if (!('LanguageModel' in self)) return null;

  const availability = await LanguageModel.availability({
    expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }]
  });
  if (availability === 'unavailable') {
    return null;
  }

  baseTextSession = await LanguageModel.create({
    expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja', 'en'] }],
    initialPrompts: [
      {
        role: 'system',
        content:
          'あなたはWebページのHTML要素から個人名や連絡先などの個人情報を抽出するアシスタントです。'
      }
    ],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        if (typeof onDownloadProgress === 'function') {
          const ratio = e.total ? e.loaded / e.total : e.loaded || 0;
          onDownloadProgress(Math.min(1, Math.max(0, ratio)));
        }
      });
    }
  });
  return baseTextSession;
}

// Fast local PII & context check for a single HTML text element
function evaluateTextElementHeuristically(item) {
  const text = item.text || '';
  const context = item.context || '';
  const foundSubstrings = new Set();

  const piiPatterns = [
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email
    /\b0\d{1,4}-\d{1,4}-\d{3,4}\b/g, // Phone number (JP)
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // Credit card
    /〒?\s?\d{3}-\d{4}/g, // Postal code
    /(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県).{1,18}[0-9０-９一二三四五六七八九十]+[-ー丁目番地号]+/g, // Address
    /(?:sk|pk|ghp|AIza)[a-zA-Z0-9_-]{16,}/g // API keys / tokens
  ];

  for (const rx of piiPatterns) {
    const matches = text.match(rx) || [];
    for (const m of matches) {
      foundSubstrings.add(m.trim());
    }
  }

  // Extract names accompanied by Japanese honorifics inside sentences (e.g. "山田太郎さん", "佐藤 花子様", "鈴木氏")
  const honorificNameRx =
    /([一-龠々ヶ]{1,4}[\s　]*[一-龠々ぁ-んァ-ヶ]{1,5})(?:さん|様|氏|殿|君|先生)/g;
  let hm;
  while ((hm = honorificNameRx.exec(text)) !== null) {
    const candidate = hm[1].trim();
    if (
      candidate.length >= 2 &&
      !/^(?:お客|皆|会員|担当|ご本人|利用|購入|代表|管理|責任|関係|当事|対象|窓口|会社|企業)/.test(
        candidate
      )
    ) {
      foundSubstrings.add(candidate);
    }
  }

  // Extract inline labeled names inside text (e.g. "氏名：山田太郎", "担当: 佐藤健")
  const inlineLabelNameRx =
    /(?:氏名|お名前|名前|担当者?|代表者?|作成者|著者|連絡先)\s*[:：]\s*([一-龠々ぁ-んァ-ヶa-zA-Z]+(?:[\s　]+[一-龠々ぁ-んァ-ヶa-zA-Z]+)?)/g;
  let lm;
  while ((lm = inlineLabelNameRx.exec(text)) !== null) {
    if (lm[1] && lm[1].trim().length >= 2) {
      foundSubstrings.add(lm[1].trim());
    }
  }

  // If the label/context explicitly says this HTML element holds a password, secret, or personal name value
  const strictMaskContextRx =
    /\b(password|passwd|secret|token|api[-_]?key|credit[-_]?card|ssn)\b|パスワード|暗証番号|マイナンバー|口座番号|カード番号/i;
  const nameLabelContextRx = /氏名|お名前|フルネーム|\bfull[\s_-]?name\b/i;
  const isNameValueElement =
    nameLabelContextRx.test(context) &&
    ['td', 'dd', 'input', 'textarea'].includes(item.tag) &&
    !nameLabelContextRx.test(text);
  const maskAll =
    (strictMaskContextRx.test(context) || isNameValueElement) && text.length <= 64;

  // Skip obvious generic 2-6 char UI navigation words so large portal sites (like cosme.net) don't waste AI calls
  const genericUiWordRx =
    /^(?:ログイン|ログアウト|新規登録|会員登録|マイページ|ランキング|クチコミ|口コミ|検索|商品検索|一覧|もっと見る|閉じる|次へ|前へ|トップ|ホーム|メニュー|カート|お気に入り|ヘルプ|お知らせ|利用規約|プライバシーポリシー|特定商取引法|会社概要|お問い合わせ|ポイント|カテゴリ|ブランド|特集|新着|すべて|詳細|設定|保存|削除|編集|キャンセル|OK|Yes|No|NEW|PR|AD)$/i;

  const needsAiInspection =
    !maskAll &&
    text.length >= 2 &&
    !genericUiWordRx.test(text) &&
    /[一-龠々ぁ-んァ-ヶa-zA-Z0-9]/.test(text);

  return {
    maskAll,
    sensitiveSubstrings: Array.from(foundSubstrings),
    needsAiInspection
  };
}

// Helper: prompt with timeout so a single slow element never stalls the progress bar
async function promptWithTimeout(session, promptText, schema, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await session.prompt(promptText, {
      responseConstraint: schema,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// Individual Prompt API evaluation for a single HTML text element
async function judgeHtmlTextElement(item, baseSession) {
  const local = evaluateTextElementHeuristically(item);
  const substrings = new Set(local.sensitiveSubstrings);
  let maskAll = local.maskAll;

  if (baseSession && local.needsAiInspection) {
    const session = await baseSession.clone();
    try {
      const schema = {
        type: 'object',
        properties: {
          isInappropriateOrPII: { type: 'boolean' },
          maskEntireElement: { type: 'boolean' },
          sensitiveSubstrings: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['isInappropriateOrPII', 'maskEntireElement', 'sensitiveSubstrings']
      };

      const promptText = [
        '次のHTMLテキスト要素に個人名（人名・フルネーム・姓・名）や連絡先・住所などの個人情報が含まれているか判定してください。',
        `- タグ: <${item.tag}>`,
        `- ラベル: ${item.context || 'なし'}`,
        `- テキスト: "${item.text}"`,
        '',
        '文章中に個人名や個人情報が含まれる場合は、その部分文字列だけを sensitiveSubstrings 配列に入れてください。要素全体が1つの個人情報値のみの場合は maskEntireElement を true にしてください。'
      ].join('\n');

      const raw = await promptWithTimeout(session, promptText, schema, 15000);
      const parsed = JSON.parse(raw);

      if (parsed.maskEntireElement && item.text.length <= 30) {
        maskAll = true;
      }
      if (Array.isArray(parsed.sensitiveSubstrings)) {
        for (const s of parsed.sensitiveSubstrings) {
          if (typeof s === 'string' && s.trim().length >= 2) {
            substrings.add(s.trim());
          }
        }
      }
    } catch (err) {
      console.info(
        `Prompt API text element (${item.id}) skipped (${err?.name || 'Error'}: ${err?.message || String(err)})`
      );
    } finally {
      session.destroy();
    }
  }

  if (maskAll || substrings.size > 0) {
    return {
      id: item.id,
      maskAll,
      sensitiveSubstrings: Array.from(substrings)
    };
  }
  return null;
}

// Individual Prompt API evaluation for a single HTML image element
async function judgeHtmlImageElement(imgItem, baseSession) {
  const combinedMeta = `${imgItem.alt} ${imgItem.title} ${imgItem.srcHint} ${imgItem.context}`;
  const sensitiveImgKeywords =
    /face|portrait|profile|avatar|photo|member|user|license|passport|card|secret|private|confidential|nsfw|adult|r18|顔|写真|人物|プロフィール|アイコン|免許|マイナンバー|保険証|身分証|個人情報|社外秘|非公開|パスワード|明細|住所/i;

  if (sensitiveImgKeywords.test(combinedMeta)) {
    return true;
  }

  if (!baseSession) {
    return false;
  }

  const session = await baseSession.clone();
  try {
    const schema = {
      type: 'object',
      properties: {
        shouldBlur: { type: 'boolean' },
        reason: { type: 'string' }
      },
      required: ['shouldBlur', 'reason']
    };

    const promptText = [
      '次のHTML画像要素の属性と周辺テキストから、人物の顔写真・プロフィール写真・身分証などぼかしを入れるべき画像か判定してください。',
      `- タグ: <${imgItem.tag}> (${imgItem.width}x${imgItem.height}px)`,
      `- alt: "${imgItem.alt || ''}"`,
      `- title: "${imgItem.title || ''}"`,
      `- ファイル名: "${imgItem.srcHint || ''}"`,
      `- 周辺テキスト: "${imgItem.context || ''}"`,
      '',
      'ぼかしを入れるべき場合は shouldBlur を true、サイトロゴや商品画像・装飾アイコンの場合は false にしてください。'
    ].join('\n');

    const raw = await promptWithTimeout(session, promptText, schema, 15000);
    const parsed = JSON.parse(raw);
    return Boolean(parsed.shouldBlur);
  } catch (err) {
    console.info(
      `Prompt API image element (${imgItem.id}) skipped (${err?.name || 'Error'}: ${err?.message || String(err)})`
    );
    return false;
  } finally {
    session.destroy();
  }
}

// Direct tab helpers in Side Panel to avoid Service Worker sendMessage channel timeouts
async function resolveTargetTab(preferredTabId = null) {
  if (preferredTabId) {
    try {
      const tab = await chrome.tabs.get(preferredTabId);
      if (tab && tab.id) return tab;
    } catch {
      // Fallback to active tab
    }
  }
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return activeTab || null;
}

async function saveCaptureRecordDirect(dataUrl, meta = {}) {
  const { captureHistory = [] } = await chrome.storage.local.get('captureHistory');
  const record = {
    id: `cap_${Date.now()}`,
    dataUrl,
    title: meta.title || 'Screen Capture',
    url: meta.url || '',
    cropRect: meta.cropRect || null,
    createdAt: new Date().toISOString()
  };
  const updatedHistory = [record, ...captureHistory].slice(0, 5);
  await chrome.storage.local.set({
    latestCapture: record,
    captureHistory: updatedHistory
  });
  return { record, updatedHistory };
}

// Pre-warm availability check when user hovers over the AI card
els.btnAiProtect.addEventListener('mouseenter', () => {
  checkAndPreparePromptApi();
});

// Main AI Protection Button Handler — Per-HTML-Element Judgment & DOM/CSS Update
els.btnAiProtect.addEventListener('click', async () => {
  els.btnAiProtect.disabled = true;
  els.aiResultBox.hidden = true;
  setStatus('HTML要素をAI判定中...');

  try {
    setAiProgress(5, 'WebページからHTML要素（テキスト・画像）を取得中...');
    const targetTab = await resolveTargetTab();

    if (
      !targetTab ||
      !targetTab.id ||
      (targetTab.url &&
        (targetTab.url.startsWith('chrome://') ||
          targetTab.url.startsWith('chrome-extension://')))
    ) {
      throw new Error(
        'このページではWebページ内のHTML要素走査ができません。通常のWebページでお試しください。'
      );
    }

    lastProtectedTabId = targetTab.id;

    // Inject privacy-redactor.js directly from Side Panel (no SW sendMessage timeout risk)
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      files: ['content/privacy-redactor.js']
    });

    const [snapExec] = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => globalThis.__scbsPrivacyRedactor?.collectHtmlElements()
    });

    const snapshot = snapExec?.result || { textItems: [], imageItems: [] };
    const { textItems = [], imageItems = [] } = snapshot;
    const totalElements = textItems.length + imageItems.length;

    if (totalElements === 0) {
      setAiProgress(100, '判定対象のHTML要素が見つかりませんでした');
      els.aiResultBox.hidden = false;
      els.aiResultSummary.textContent = 'ページ内に判定対象のテキスト・画像要素がありませんでした。';
      els.aiResultDetail.textContent = '';
      setStatus('完了');
      return;
    }

    // Prepare Prompt API base session (with download progress bar support if needed)
    const base = await getOrCreateBaseTextSession((dlRatio) => {
      setAiProgress(
        5 + Math.round(dlRatio * 10),
        `AIモデルを準備中 (${Math.round(dlRatio * 100)}%)...`
      );
    });

    const textDecisions = [];
    const blurImageIds = [];
    let processed = 0;

    // Step 1: Individually evaluate each HTML text element
    for (const item of textItems) {
      processed++;
      const pct = 15 + Math.round((processed / totalElements) * 70);
      setAiProgress(
        pct,
        `HTMLテキスト要素を個別判定中 (${processed} / ${totalElements})...`
      );

      const decision = await judgeHtmlTextElement(item, base);
      if (decision) {
        textDecisions.push(decision);
      }
    }

    // Step 2: Individually evaluate each HTML image element
    for (const imgItem of imageItems) {
      processed++;
      const pct = 15 + Math.round((processed / totalElements) * 70);
      setAiProgress(
        pct,
        `HTML画像要素を個別判定中 (${processed} / ${totalElements})...`
      );

      const shouldBlur = await judgeHtmlImageElement(imgItem, base);
      if (shouldBlur) {
        blurImageIds.push(imgItem.id);
      }
    }

    // Step 3: Apply HTML text modifications (伏せ字 ●●●) and CSS filter: blur() directly on targetTab
    setAiProgress(90, 'HTMLの文字変更（伏せ字）と画像のぼかしCSSを適用中...');
    const applyTab = await resolveTargetTab(lastProtectedTabId);
    if (!applyTab || !applyTab.id) {
      throw new Error('適用対象のタブが見つかりません。');
    }

    const [applyExec] = await chrome.scripting.executeScript({
      target: { tabId: applyTab.id },
      func: async (payload) => {
        if (!globalThis.__scbsPrivacyRedactor) {
          return { redactedTextCount: 0, blurredImageCount: 0 };
        }
        return await globalThis.__scbsPrivacyRedactor.applyElementChanges(payload);
      },
      args: [
        {
          textDecisions,
          blurImageIds,
          blurPx: Math.max(10, state.spotStrength)
        }
      ]
    });

    const stats = applyExec?.result || { redactedTextCount: 0, blurredImageCount: 0 };
    const redactedTextCount = stats.redactedTextCount || 0;
    const blurredImageCount = stats.blurredImageCount || 0;

    // Wait briefly for CSS blur & text repaint, then capture visible tab directly
    await new Promise((r) => setTimeout(r, 80));
    const dataUrl = await chrome.tabs.captureVisibleTab(applyTab.windowId, {
      format: 'png'
    });
    const { record, updatedHistory } = await saveCaptureRecordDirect(dataUrl, {
      title: `${applyTab.title || 'ページ'} (AI保護済)`,
      url: applyTab.url || ''
    });

    await setCaptureInEditor(record);
    renderHistory(updatedHistory);
    els.btnAiRestore.disabled = false;

    setAiProgress(100, 'HTML要素の判定・変更が完了しました');

    // Render result summary using textContent (NEVER innerHTML)
    els.aiResultBox.hidden = false;
    els.aiResultSummary.textContent = `完了 (検査 ${totalElements} 要素): HTML文字の伏せ字変更 ${redactedTextCount} 箇所 / 画像のCSSぼかし設定 ${blurredImageCount} 件`;
    els.aiResultDetail.textContent =
      'ページ上の各HTML要素を個別に判定し、HTMLテキストの伏せ字化と画像要素への filter: blur() CSS設定を反映しました。';

    setStatus('AI保護完了');
  } catch (err) {
    console.error('AI privacy protection error:', err);
    const rawMsg = err?.message || '';
    let friendlyMsg = rawMsg || 'HTML要素のAI判定中にエラーが発生しました。';
    const fileAccessAllowed = await chrome.extension
      .isAllowedFileSchemeAccess()
      .catch(() => true);
    if (/file:\/\/\//i.test(rawMsg)) {
      friendlyMsg =
        'ローカルファイル(file://)を操作するには、chrome://extensions の「詳細」で「ファイルの URL へのアクセスを許可する」をONにしてから拡張機能アイコンをクリックしてください。';
    } else if (/activeTab|<all_urls>|Cannot access contents/i.test(rawMsg)) {
      friendlyMsg = !fileAccessAllowed
        ? 'ローカルファイル(file://)を操作する場合は chrome://extensions の「詳細」で「ファイルの URL へのアクセスを許可する」をONにしてから、ツールバーの拡張機能アイコンをクリックしてください。'
        : 'このタブへのアクセスを有効にするため、ツールバーの拡張機能アイコン（または右クリックメニュー）を1回クリックしてから実行してください。';
    }
    setAiProgress(100, '判定中にエラーが発生しました');
    els.aiResultBox.hidden = false;
    els.aiResultSummary.textContent = '判定処理エラー';
    els.aiResultDetail.textContent = friendlyMsg;
    setStatus('AI判定エラー', true);
  } finally {
    els.btnAiProtect.disabled = false;
  }
});

// Restore Page Redactions Button Handler
els.btnAiRestore.addEventListener('click', async () => {
  try {
    els.btnAiRestore.disabled = true;
    setStatus('HTML要素を復元中...');
    const targetTab = await resolveTargetTab(lastProtectedTabId);
    if (targetTab && targetTab.id) {
      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        files: ['content/privacy-redactor.js']
      });
      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        func: async () => {
          return await globalThis.__scbsPrivacyRedactor?.restoreAllChanges();
        }
      });
      await new Promise((r) => setTimeout(r, 80));
      const dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
        format: 'png'
      });
      const { record, updatedHistory } = await saveCaptureRecordDirect(dataUrl, {
        title: `${targetTab.title || 'ページ'} (復元)`,
        url: targetTab.url || ''
      });
      await setCaptureInEditor(record);
      renderHistory(updatedHistory);
    }
    els.aiProgressWrap.hidden = true;
    els.aiResultBox.hidden = false;
    els.aiResultSummary.textContent = 'HTMLの文字変更と画像のぼかしCSSを元に戻しました。';
    els.aiResultDetail.textContent = '';
    setStatus('復元完了');
  } catch (err) {
    console.error('Restore page error:', err);
    setStatus('復元エラー', true);
  }
});

// Clean up base session when side panel closes
window.addEventListener('pagehide', () => {
  if (baseTextSession) {
    baseTextSession.destroy();
    baseTextSession = null;
  }
});

// Initialize Side Panel on load
(async function init() {
  syncFilterUIFromState();
  updateBrushPreviewDot();
  setSpotTool(state.spotTool);
  checkAndPreparePromptApi();
  try {
    const {
      latestCapture,
      captureHistory = [],
      characterIcons = [],
      selectedCharacterIconId = null
    } = await chrome.storage.local.get([
      'latestCapture',
      'captureHistory',
      'characterIcons',
      'selectedCharacterIconId'
    ]);

    if (Array.isArray(characterIcons) && characterIcons.length > 0) {
      state.characterIcons = characterIcons.slice(0, MAX_CHAR_ICONS).map((item) => ({
        id: item.id || `cicon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: item.name || 'キャラアイコン',
        dataUrl: item.dataUrl,
        size: Math.max(16, Math.min(320, Number(item.size) || DEFAULT_CHAR_ICON_SIZE))
      }));
      await Promise.all(state.characterIcons.map((icon) => cacheCharacterIconImage(icon)));
      state.selectedIconId =
        state.characterIcons.find((c) => c.id === selectedCharacterIconId)?.id ||
        state.characterIcons[0]?.id ||
        null;
    }
    renderCharacterIconList();

    if (latestCapture) {
      await setCaptureInEditor(latestCapture);
    }
    renderHistory(captureHistory);
  } catch (err) {
    console.error('Initialization error:', err);
  }
})();
