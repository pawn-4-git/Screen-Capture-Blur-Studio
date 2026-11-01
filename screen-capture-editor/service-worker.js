// service-worker.js - Manifest V3 Background Service Worker

// IMPORTANT: Set openPanelOnActionClick to false and open the side panel via chrome.action.onClicked.
// In Chromium, openPanelOnActionClick: true intercepts the click in browser UI and does NOT grant `activeTab`,
// whereas chrome.action.onClicked explicitly grants `activeTab` to the current tab AND opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch((err) => console.error('Failed to set panel behavior:', err));

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      await flashBadge('OK', '#4F46E5');
    }
  } catch (err) {
    console.error('Action click open sidePanel error:', err);
  }
});

// Set up context menu on install
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'capture-visible-to-panel',
      title: 'この画面をキャプチャしてサイドパネルで編集',
      contexts: ['page', 'image', 'selection']
    });
  } catch (err) {
    console.error('Context menu setup error:', err);
  }
});

// Helper: flash badge for user confirmation
async function flashBadge(text, color = '#4F46E5') {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    // Clear badge after a short delay using storage timestamp + alarm or safe timeout
    await chrome.alarms.create('clear-badge', { when: Date.now() + 2000 });
  } catch (err) {
    console.error('Badge update error:', err);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'clear-badge') {
    await chrome.action.setBadgeText({ text: '' });
  }
});

// Helper: save capture entry into chrome.storage.local (keeps up to 5 recent captures)
async function saveCaptureRecord(dataUrl, meta = {}) {
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
  return record;
}

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'capture-visible-to-panel' || !tab) return;

  try {
    // Open side panel immediately on user gesture
    await chrome.sidePanel.open({ windowId: tab.windowId });

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    });

    const record = await saveCaptureRecord(dataUrl, {
      title: tab.title || 'ページキャプチャ',
      url: tab.url || ''
    });

    await flashBadge('OK', '#10B981');

    // Notify side panel if already listening
    try {
      await chrome.runtime.sendMessage({
        type: 'NEW_CAPTURE_SAVED',
        capture: record
      });
    } catch {
      // Side panel may still be initializing; it will load latestCapture from storage on startup
    }
  } catch (err) {
    console.error('Context menu capture failed:', err);
    await flashBadge('ERR', '#EF4444');
  }
});

// Handle messages from Side Panel and Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'CAPTURE_VISIBLE_TAB') {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

        if (!activeTab) {
          sendResponse({ ok: false, error: 'アクティブなタブが見つかりません。' });
          return;
        }

        const dataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
          format: 'png'
        });

        const record = await saveCaptureRecord(dataUrl, {
          title: activeTab.title || '表示領域キャプチャ',
          url: activeTab.url || ''
        });

        await flashBadge('CAP', '#4F46E5');
        sendResponse({ ok: true, capture: record });
        return;
      }

      if (message.type === 'START_AREA_SELECTION') {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

        if (!activeTab || !activeTab.id) {
          sendResponse({ ok: false, error: 'アクティブなタブが見つかりません。' });
          return;
        }

        if (
          activeTab.url &&
          (activeTab.url.startsWith('chrome://') ||
            activeTab.url.startsWith('chrome-extension://') ||
            activeTab.url.startsWith('https://chrome.google.com/webstore') ||
            activeTab.url.startsWith('https://chromewebstore.google.com'))
        ) {
          sendResponse({
            ok: false,
            error: 'Chromeのシステムページでは範囲選択を使用できません。通常のWebページでお試しください。'
          });
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content/crop-overlay.js']
        });

        sendResponse({ ok: true });
        return;
      }

      if (message.type === 'AREA_SELECTED') {
        const tab = sender.tab;
        if (!tab) {
          sendResponse({ ok: false, error: '送信元のタブ情報が取得できませんでした。' });
          return;
        }

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png'
        });

        const record = await saveCaptureRecord(dataUrl, {
          title: `${tab.title || '範囲キャプチャ'} (範囲選択)`,
          url: tab.url || '',
          cropRect: message.rect
        });

        await flashBadge('CAP', '#10B981');

        try {
          await chrome.runtime.sendMessage({
            type: 'NEW_CAPTURE_SAVED',
            capture: record
          });
        } catch {
          // Ignore if side panel is not open
        }

        sendResponse({ ok: true, capture: record });
        return;
      }

      if (message.type === 'DOWNLOAD_IMAGE') {
        const downloadId = await chrome.downloads.download({
          url: message.dataUrl,
          filename: message.filename || `capture_${Date.now()}.png`,
          saveAs: Boolean(message.saveAs)
        });
        sendResponse({ ok: true, downloadId });
        return;
      }

      if (message.type === 'RUN_PAGE_PRIVACY_SNAPSHOT') {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true
        });

        if (
          !activeTab ||
          !activeTab.id ||
          (activeTab.url &&
            (activeTab.url.startsWith('chrome://') ||
              activeTab.url.startsWith('chrome-extension://')))
        ) {
          sendResponse({
            ok: false,
            error: 'このページではWebページ内のHTML要素走査ができません。通常のWebページでお試しください。'
          });
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ['content/privacy-redactor.js']
        });

        const [execRes] = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => globalThis.__scbsPrivacyRedactor?.collectHtmlElements()
        });

        sendResponse({
          ok: true,
          tabId: activeTab.id,
          windowId: activeTab.windowId,
          snapshot: execRes?.result || { textItems: [], imageItems: [] }
        });
        return;
      }

      if (message.type === 'APPLY_PAGE_PRIVACY_REDACTIONS') {
        let targetTab = null;
        if (message.tabId) {
          try {
            targetTab = await chrome.tabs.get(message.tabId);
          } catch {
            targetTab = null;
          }
        }
        if (!targetTab) {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
          });
          targetTab = activeTab;
        }

        if (!targetTab || !targetTab.id) {
          sendResponse({ ok: false, error: '対象のタブが見つかりません。' });
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['content/privacy-redactor.js']
        });

        const [execRes] = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: async (payload) => {
            if (!globalThis.__scbsPrivacyRedactor) {
              return { redactedTextCount: 0, blurredImageCount: 0 };
            }
            return await globalThis.__scbsPrivacyRedactor.applyElementChanges(payload);
          },
          args: [message.payload || {}]
        });

        // Wait briefly for CSS blur & text layout repaint before capturing
        await new Promise((r) => setTimeout(r, 80));

        const dataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, {
          format: 'png'
        });

        const record = await saveCaptureRecord(dataUrl, {
          title: `${targetTab.title || 'ページ'} (AI保護済)`,
          url: targetTab.url || ''
        });

        await flashBadge('AI', '#7C3AED');
        sendResponse({
          ok: true,
          stats: execRes?.result || { redactedTextCount: 0, blurredImageCount: 0 },
          capture: record
        });
        return;
      }

      if (message.type === 'RESTORE_PAGE_PRIVACY_REDACTIONS') {
        let targetTab = null;
        if (message.tabId) {
          try {
            targetTab = await chrome.tabs.get(message.tabId);
          } catch {
            targetTab = null;
          }
        }
        if (!targetTab) {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
          });
          targetTab = activeTab;
        }

        if (!targetTab || !targetTab.id) {
          sendResponse({ ok: false, error: '対象のタブが見つかりません。' });
          return;
        }

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

        const record = await saveCaptureRecord(dataUrl, {
          title: `${targetTab.title || 'ページ'} (復元)`,
          url: targetTab.url || ''
        });

        sendResponse({ ok: true, capture: record });
        return;
      }

      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (err) {
      console.error('Service worker message error:', err);
      const rawMsg = err?.message || '';
      let friendlyMsg = rawMsg || 'キャプチャ処理中にエラーが発生しました。';
      const fileAccessAllowed = await chrome.extension
        .isAllowedFileSchemeAccess()
        .catch(() => true);
      if (/file:\/\/\//i.test(rawMsg)) {
        friendlyMsg =
          'ローカルファイル(file://)を操作するには、chrome://extensions の「詳細」で「ファイルの URL へのアクセスを許可する」をONにしてから拡張機能アイコンをクリックしてください。';
      } else if (/activeTab|<all_urls>|Cannot access contents/i.test(rawMsg)) {
        friendlyMsg = !fileAccessAllowed
          ? 'ローカルファイル(file://)を操作する場合は chrome://extensions の「詳細」で「ファイルの URL へのアクセスを許可する」をONにしてから、ツールバーの拡張機能アイコンをクリックしてください。通常のページの場合は拡張機能アイコンを1回クリックしてください。'
          : 'このタブへのアクセスを有効にするため、ツールバーの拡張機能アイコン（または右クリックメニュー）を1回クリックしてください。';
      }
      sendResponse({
        ok: false,
        error: friendlyMsg
      });
    }
  })();

  return true; // Keep message channel open for async response
});

