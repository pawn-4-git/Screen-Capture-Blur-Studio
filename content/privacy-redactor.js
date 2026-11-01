// content/privacy-redactor.js - Per-Element HTML Text Redaction (伏せ字) & Image CSS Blur
// Supports main document + same-origin <frame> / <iframe> (<frameset> sites like abehiroshi)
// while skipping cross-origin ad iframes that would hang execution on portal sites like cosme.net.
(() => {
  const state = (globalThis.__scbsPrivacyState = globalThis.__scbsPrivacyState || {
    textTargetMap: new Map(), // id -> { kind: 'textNode' | 'input', node }
    imageTargetMap: new Map(), // id -> HTMLElement
    originalTextValues: new Map(), // Node/Element -> { kind, value }
    originalImageStyles: new Map() // HTMLElement -> { filter, webkitFilter, transition }
  });

  const {
    textTargetMap,
    imageTargetMap,
    originalTextValues,
    originalImageStyles
  } = state;

  function waitFrameSafe() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 35);
    });
  }

  // Gather all accessible same-origin document roots (main document + <frame> / <iframe>)
  function getAccessibleRoots(rootDoc = document, visited = new Set()) {
    const roots = [];
    if (!rootDoc || visited.has(rootDoc)) return roots;
    visited.add(rootDoc);

    const body = rootDoc.body;
    if (body && body.tagName !== 'FRAMESET') {
      roots.push({ doc: rootDoc, win: rootDoc.defaultView || window, body });
    }

    const frameEls = rootDoc.querySelectorAll('frame, iframe');
    for (const frameEl of frameEls) {
      try {
        const subDoc = frameEl.contentDocument;
        if (subDoc) {
          roots.push(...getAccessibleRoots(subDoc, visited));
        }
      } catch {
        // Cross-origin ad/tracking iframe — safely ignore
      }
    }
    return roots;
  }

  // Helper: find nearby label/heading context for an element
  function getElementLabelContext(el) {
    if (!el) return '';
    const parts = [];

    const attrHint = [
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('name'),
      el.id,
      typeof el.className === 'string' ? el.className : ''
    ]
      .filter(Boolean)
      .join(' ');
    if (attrHint) parts.push(attrHint);

    const td = el.closest?.('td');
    if (td && td.parentElement) {
      const firstCell = td.parentElement.querySelector('th, td');
      if (firstCell && firstCell !== td && firstCell.innerText) {
        const labelTxt = firstCell.innerText.replace(/\s+/g, ' ').trim();
        if (labelTxt.length <= 40) {
          parts.push(labelTxt);
        }
      }
    }

    const dd = el.closest?.('dd');
    if (dd && dd.previousElementSibling?.tagName === 'DT') {
      parts.push(dd.previousElementSibling.innerText.trim());
    }

    const prev = el.previousElementSibling;
    if (
      prev &&
      (prev.tagName === 'LABEL' ||
        prev.tagName === 'DT' ||
        prev.tagName === 'TH' ||
        prev.tagName === 'SPAN' ||
        prev.tagName === 'B' ||
        prev.tagName === 'STRONG' ||
        /^H[1-6]$/.test(prev.tagName))
    ) {
      const prevTxt = (prev.innerText || '').trim();
      if (prevTxt && prevTxt.length <= 40) {
        parts.push(prevTxt);
      }
    }

    return parts.join(' | ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  // Collect individual HTML text nodes/inputs and HTML image elements across all accessible roots
  function collectHtmlElements() {
    textTargetMap.clear();
    imageTargetMap.clear();

    const roots = getAccessibleRoots(document);
    const textItems = [];
    const imageItems = [];
    let txtCounter = 0;
    let imgCounter = 0;

    for (const { doc, win, body } of roots) {
      const viewportH = win.innerHeight || doc.documentElement?.clientHeight || 800;
      const viewportW = win.innerWidth || doc.documentElement?.clientWidth || 1200;

      function isNearViewport(rect) {
        if (rect.width < 2 || rect.height < 2) return false;
        return (
          rect.bottom >= -100 &&
          rect.top <= viewportH + 350 &&
          rect.right >= -50 &&
          rect.left <= viewportW + 100
        );
      }

      // 1. Collect HTML text nodes via TreeWalker
      const walker = doc.createTreeWalker(
        body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            if (
              tag === 'SCRIPT' ||
              tag === 'STYLE' ||
              tag === 'NOSCRIPT' ||
              tag === 'SVG' ||
              tag === 'TEMPLATE' ||
              tag === 'FRAMESET' ||
              tag === 'FRAME'
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            const val = (node.nodeValue || '').trim();
            if (val.length < 2) return NodeFilter.FILTER_REJECT;

            const style = win.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }

            const rect = parent.getBoundingClientRect();
            if (!isNearViewport(rect)) return NodeFilter.FILTER_REJECT;

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let curr = walker.nextNode();
      while (curr && textItems.length < 55) {
        const parent = curr.parentElement;
        const rawText = curr.nodeValue;
        const trimmed = rawText.replace(/\s+/g, ' ').trim();

        if (trimmed.length >= 2) {
          const id = `txt_${txtCounter++}`;
          textTargetMap.set(id, { kind: 'textNode', node: curr });
          textItems.push({
            id,
            tag: parent.tagName.toLowerCase(),
            text: trimmed.slice(0, 220),
            context: getElementLabelContext(parent)
          });
        }
        curr = walker.nextNode();
      }

      // Also collect visible <input> and <textarea> elements with values
      const formFields = body.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea'
      );
      for (const field of formFields) {
        if (textItems.length >= 65) break;
        const val = (field.value || '').trim();
        if (val.length < 2) continue;
        const rect = field.getBoundingClientRect();
        if (!isNearViewport(rect)) continue;

        const id = `txt_${txtCounter++}`;
        textTargetMap.set(id, { kind: 'input', node: field });
        textItems.push({
          id,
          tag: field.tagName.toLowerCase(),
          text: val.slice(0, 220),
          context: getElementLabelContext(field)
        });
      }

      // 2. Collect HTML image elements (<img> and non-body elements with CSS background-image)
      const candidates = Array.from(
        body.querySelectorAll('img, svg, canvas, video, [style*="background-image"]')
      );

      for (const el of candidates) {
        if (imageItems.length >= 25) break;
        if (el.tagName === 'BODY' || el.tagName === 'HTML') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 28 || rect.height < 28) continue;
        if (!isNearViewport(rect)) continue;

        const style = win.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const id = `img_${imgCounter++}`;
        el.dataset.scbsImgId = id;
        imageTargetMap.set(id, el);

        const srcRaw =
          el.currentSrc ||
          el.src ||
          style.backgroundImage?.replace(/^url\(["']?|["']?\)$/g, '') ||
          '';
        const srcHint = srcRaw.startsWith('data:')
          ? 'data-uri-image'
          : srcRaw.split('?')[0].slice(-100);

        const figText = (
          el.closest('figure, a, li, td, tr, div')?.innerText || ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);

        imageItems.push({
          id,
          tag: el.tagName.toLowerCase(),
          alt: (el.getAttribute('alt') || '').slice(0, 100),
          title: (el.getAttribute('title') || '').slice(0, 100),
          srcHint,
          context: `${getElementLabelContext(el)} ${figText}`.trim().slice(0, 140),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        });
      }
    }

    return { textItems, imageItems };
  }

  function maskWithBullets(str) {
    if (!str) return str;
    const len = Math.max(3, Math.min(16, Array.from(str.trim()).length));
    return '●'.repeat(len);
  }

  // Apply per-element HTML text replacements and CSS blur on target HTML image elements
  async function applyElementChanges({ textDecisions = [], blurImageIds = [], blurPx = 14 } = {}) {
    let redactedTextCount = 0;
    let blurredImageCount = 0;

    const localDecisions = textDecisions.filter((d) => textTargetMap.has(d.id));
    const localImgEls = [];
    for (const id of new Set(blurImageIds.map(String))) {
      const el = imageTargetMap.get(id);
      if (el) localImgEls.push(el);
    }

    if (localDecisions.length === 0 && localImgEls.length === 0) {
      return { redactedTextCount: 0, blurredImageCount: 0 };
    }

    const BATCH = 20;
    for (let i = 0; i < localDecisions.length; i += BATCH) {
      const slice = localDecisions.slice(i, i + BATCH);
      await waitFrameSafe();
      for (const decision of slice) {
        const target = textTargetMap.get(decision.id);
        if (!target) continue;

        const currentVal =
          target.kind === 'input' ? target.node.value : target.node.nodeValue;
        if (!currentVal) continue;

        let newVal = currentVal;
        if (decision.maskAll) {
          newVal = currentVal.replace(/\S+/g, (word) => maskWithBullets(word));
        } else if (Array.isArray(decision.sensitiveSubstrings)) {
          const sortedTerms = [...decision.sensitiveSubstrings]
            .filter((t) => typeof t === 'string' && t.trim().length >= 2)
            .sort((a, b) => b.length - a.length);

          for (const term of sortedTerms) {
            if (newVal.includes(term)) {
              newVal = newVal.split(term).join(maskWithBullets(term));
            } else {
              const compact = term.replace(/[\s　]+/g, '');
              if (compact.length >= 2) {
                const escapedChars = Array.from(compact).map((ch) =>
                  ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                );
                const flexRx = new RegExp(escapedChars.join('[\\s　]*'), 'g');
                newVal = newVal.replace(flexRx, (m) => maskWithBullets(m));
              }
            }
          }
        }

        if (newVal !== currentVal) {
          if (!originalTextValues.has(target.node)) {
            originalTextValues.set(target.node, {
              kind: target.kind,
              value: currentVal
            });
          }
          if (target.kind === 'input') {
            target.node.value = newVal;
          } else {
            target.node.nodeValue = newVal;
          }
          redactedTextCount++;
        }
      }
    }

    if (localImgEls.length > 0) {
      await waitFrameSafe();
      for (const el of localImgEls) {
        if (!originalImageStyles.has(el)) {
          originalImageStyles.set(el, {
            filter: el.style.filter,
            webkitFilter: el.style.webkitFilter,
            transition: el.style.transition
          });
        }
        el.style.transition = 'filter 0.2s ease';
        el.style.filter = `blur(${blurPx}px)`;
        el.style.webkitFilter = `blur(${blurPx}px)`;
        blurredImageCount++;
      }
    }

    return { redactedTextCount, blurredImageCount };
  }

  // Restore modified HTML text nodes and CSS blurred image elements
  async function restoreAllChanges() {
    if (originalTextValues.size === 0 && originalImageStyles.size === 0) {
      return { restored: true };
    }

    const textEntries = Array.from(originalTextValues.entries());
    const BATCH = 25;
    for (let i = 0; i < textEntries.length; i += BATCH) {
      const slice = textEntries.slice(i, i + BATCH);
      await waitFrameSafe();
      for (const [node, info] of slice) {
        if (info.kind === 'input') {
          node.value = info.value;
        } else {
          node.nodeValue = info.value;
        }
      }
    }
    originalTextValues.clear();

    if (originalImageStyles.size > 0) {
      await waitFrameSafe();
      for (const [el, saved] of originalImageStyles.entries()) {
        el.style.filter = saved.filter;
        el.style.webkitFilter = saved.webkitFilter;
        el.style.transition = saved.transition;
      }
      originalImageStyles.clear();
    }

    return { restored: true };
  }

  globalThis.__scbsPrivacyRedactor = {
    collectHtmlElements,
    applyElementChanges,
    restoreAllChanges
  };
})();
