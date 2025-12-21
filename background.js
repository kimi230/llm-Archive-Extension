// background.js

// 1. 아이콘 클릭 시 사이드패널 열기 설정
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// 2. 이미지 다운로드 핸들러 (CORS 우회)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOWNLOAD_IMAGE') {
    (async () => {
      try {
        const response = await fetch(message.url, {
          credentials: 'include'
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/png';
        sendResponse({
          ok: true,
          data: Array.from(new Uint8Array(arrayBuffer)),
          contentType
        });
      } catch (error) {
        console.error('Image download failed:', error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true; // 비동기 응답
  }
});

// 단축키/Content Script 기반 자동 저장 워크플로우는 비활성화됨.
// 단, 패널 열기 단축키는 사용자가 chrome://extensions/shortcuts 에서 직접 지정 가능.
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-sidepanel") {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = tabs && tabs[0];
      if (tab && typeof tab.windowId === 'number') {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
    } catch (error) {
      console.log('sidepanel open failed:', error);
    }
  }
});