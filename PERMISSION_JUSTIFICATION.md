# Chrome Extension 권한 사용 근거

## 📌 확장 프로그램 전용 목적

LLM Archive Extension은 LLM(Large Language Model) 서비스의 대화 내용을 로컬 파일 시스템에 Markdown 형식으로 아카이빙하는 전용 도구입니다.

### 핵심 기능
- ChatGPT, Claude, Gemini, Grok 등 주요 LLM 서비스의 대화 추출
- 로컬 파일 시스템에 Markdown 파일로 저장 (File System Access API 사용)
- Obsidian 호환 YAML frontmatter 메타데이터 포함
- 대화 내 이미지/비디오 자동 다운로드 및 저장
- 클립보드 내용을 Markdown 파일로 저장

---

## 🔐 권한별 사용 근거

### 1. `sidePanel` 권한

사용 목적: 사용자 인터페이스 제공

구체적 사용 위치:
- `background.js:4` - 사이드패널 자동 열기 설정
  ```javascript
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  ```
- `background.js:41` - 단축키를 통한 사이드패널 열기
  ```javascript
  await chrome.sidePanel.open({ windowId: tab.windowId });
  ```

필요성: 
- 브라우저 측면에 고정된 UI를 제공하여 LLM 대화를 보면서 동시에 저장 작업 수행 가능
- 팝업 대신 사이드패널을 사용하여 작업 중 UI가 닫히지 않도록 보장

---

### 2. `storage` 권한

사용 목적: 확장 프로그램 설정 및 대기 중인 저장 데이터 관리

구체적 사용 위치:
- 대화 데이터 임시 저장 (`sidepanel.js:308-309`, `696-697`, `877-878`, `1130-1131`, `1350-1351`)
  ```javascript
  const { clips = [] } = await chrome.storage.local.get('clips');
  await chrome.storage.local.set({ clips: [...clips, clip] });
  ```

- 디렉토리 미연결 시 대기 큐 관리 (`sidepanel.js:324-326`, `710-712`, `901-903`, `1144-1146`, `1364-1366`, `1827`, `1845`)
  ```javascript
  const { pendingFileSaves = [] } = await chrome.storage.local.get('pendingFileSaves');
  pendingFileSaves.push(clip);
  await chrome.storage.local.set({ pendingFileSaves });
  ```

- 사용자 설정 저장
  - 선택된 폴더 경로 (`sidepanel.js:1381`, `1405`)
  - 핀된 경로 목록 (`sidepanel.js:1417`, `1430`)
  - 기본 태그 설정 (`sidepanel.js:1538`, `1550`, `1906`)
  - 마지막 저장 정보 (`sidepanel.js:316`, `885`, `1711`, `1768`)

필요성:
- 디렉토리 연결 전에 추출한 대화 데이터를 손실 없이 보관
- 사용자 설정(선택 폴더, 핀, 태그)을 영구 저장하여 재사용
- 확장 프로그램 재시작 시에도 데이터 유지

---

### 3. `tabs` 권한

사용 목적: 현재 활성 탭의 URL 및 LLM 서비스 감지

구체적 사용 위치:
- 활성 탭 조회 (`sidepanel.js:111`, `226`, `340`, `background.js:38`)
  ```javascript
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  const url = tab && tab.url ? tab.url : '';
  ```

- LLM 감지 (`sidepanel.js:73-87`)
  ```javascript
  function detectLLMFromUrl(url) {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes('chat.openai.com') || host.includes('chatgpt.com')) return 'ChatGPT';
    if (host.includes('claude.ai')) return 'Claude';
    if (host.includes('gemini.google.com')) return 'Gemini';
    if (host.includes('grok.com')) return 'Grok';
    return 'Unknown';
  }
  ```

- 탭 변경 감지 (`sidepanel.js:2012-2013`)
  ```javascript
  chrome.tabs.onActivated.addListener(detectAndUpdateLLM);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => { ... });
  ```

필요성:
- 현재 탭의 URL을 분석하여 어떤 LLM 서비스인지 자동 감지
- 탭 전환 시 자동으로 LLM 감지 상태 업데이트
- 저장할 대화의 출처 URL을 메타데이터에 포함

---

### 4. `scripting` 권한

사용 목적: LLM 웹페이지에서 대화 내용 추출

구체적 사용 위치:
- Gemini 대화 추출 (`sidepanel.js:421-491`)
  ```javascript
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const turnNodes = Array.from(document.querySelectorAll('.conversation-container'));
      // DOM에서 대화 내용 추출
    }
  });
  ```

- Grok 대화 추출 (`sidepanel.js:512-564`)
  ```javascript
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const messageNodes = Array.from(document.querySelectorAll('[id^="response-"]'));
      // DOM에서 대화 내용 추출
    }
  });
  ```

- ChatGPT 대화 추출 (`sidepanel.js:922`)
- Claude 대화 추출 (`sidepanel.js:1165`)

필요성:
- 각 LLM 서비스의 웹페이지 DOM 구조에 접근하여 대화 내용 추출
- 사용자 질문과 AI 응답을 구분하여 수집
- 대화 내 이미지/비디오 URL 추출
- 원격 코드 실행 없음: 모든 스크립트는 확장 프로그램 내부에 포함됨

---

### 5. `activeTab` 권한

사용 목적: 현재 활성화된 탭에 대한 접근

필요성:
- `scripting` 권한과 함께 사용하여 현재 보고 있는 LLM 대화만 추출
- 사용자가 명시적으로 저장 버튼을 클릭한 탭에만 접근
- 백그라운드에서 모든 탭에 접근하지 않고, 사용자 액션이 있는 탭만 접근

---

### 6. `clipboardRead` 권한

사용 목적: 클립보드 내용을 Markdown 파일로 저장

구체적 사용 위치:
- 클립보드 읽기 (`sidepanel.js:237-248`)
  ```javascript
  async function readClipboardText() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch (error) {
        throw new Error('클립보드 읽기 권한이 없습니다.');
      }
    }
  }
  ```

- 클립보드 저장 기능 (`sidepanel.js:270-337`)
  ```javascript
  async function saveClipboardMarkdown() {
    const text = await readClipboardText();
    const md = String(text || '').trim();
    // Markdown 파일로 저장
  }
  ```

필요성:
- 사용자가 복사한 텍스트를 Markdown 파일로 저장하는 부가 기능 제공
- LLM 대화 외에도 일반 텍스트를 아카이빙할 수 있도록 지원
- 사용자 클릭(gesture) 컨텍스트에서만 실행되어 보안 유지

---

### 7. `host_permissions` 권한

사용 목적: LLM 서비스 페이지 접근 및 이미지 다운로드

#### 7.1 LLM 서비스 도메인
```json
"https://chatgpt.com/*",
"https://chat.openai.com/*",
"https://claude.ai/*",
"https://gemini.google.com/*",
"https://grok.com/*",
"https://x.com/*"
```

필요성:
- 각 LLM 서비스 페이지에서 대화 내용 추출
- `scripting` 권한으로 DOM 접근 시 필요
- `x.com`은 Grok의 통합 서비스로 접근 필요

#### 7.2 이미지 호스팅 도메인
```json
"https://lh3.googleusercontent.com/*",
"https://*.googleusercontent.com/*",
"https://contribution.usercontent.google.com/*",
"https://*.fastcompany.com/*",
"https://*.wordpress.com/*",
"https://*.theverge.com/*",
"https://i.ytimg.com/*",
"https://image.adsoftheworld.com/*",
"https://*.brandinginasia.com/*",
"https://*.hakuhodo-global.com/*"
```

필요성:
- CORS 우회 이미지 다운로드 (`background.js:6-31`)
  ```javascript
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOWNLOAD_IMAGE') {
      const response = await fetch(message.url, { credentials: 'include' });
      const arrayBuffer = await response.arrayBuffer();
      // 이미지 데이터 반환
    }
  });
  ```

- 이미지 다운로드 호출 (`sidepanel.js:402-413`)
  ```javascript
  async function downloadImageFromBackground(imageUrl) {
    const result = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGE',
      url: imageUrl
    });
    return { data: new Uint8Array(result.data), contentType: result.contentType };
  }
  ```

- LLM 대화에 포함된 이미지를 로컬에 저장하기 위해 필요
- Google 서비스(Gemini)의 이미지는 `googleusercontent.com`에서 호스팅
- 외부 참조 이미지(뉴스, 블로그 등)도 다운로드하여 영구 보관

---

## ❌ 원격 코드 사용 여부

사용하지 않음

### 검증 결과
1. `eval()` 사용 없음 - 검색 결과 0건
2. `new Function()` 사용 없음 - 검색 결과 0건
3. 외부 스크립트 로드 없음 - 모든 스크립트는 로컬 파일
   - `turndown.min.js` - 로컬에 포함된 라이브러리
   - `sidepanel.js` - 로컬 모듈
   - `fileSystemUtils.js` - 로컬 모듈
   - `background.js` - 로컬 서비스 워커

### HTML 파일 검증
`sidepanel.html`에서 로드하는 모든 스크립트:
```html
<script src="turndown.min.js"></script>  <!-- 로컬 파일 -->
<script type="module" src="sidepanel.js"></script>  <!-- 로컬 모듈 -->
```

결론: 모든 코드는 확장 프로그램 패키지 내부에 포함되어 있으며, 외부에서 코드를 동적으로 로드하거나 실행하지 않습니다.

---

## 📊 권한 요약표

| 권한 | 사용 목적 | 핵심 기능 | 보안 고려사항 |
|------|----------|----------|--------------|
| `sidePanel` | 사이드패널 UI 제공 | 지속적인 UI 접근 | 사용자 명시적 액션 필요 |
| `storage` | 설정 및 대기 데이터 관리 | 데이터 손실 방지 | 로컬 저장소만 사용 |
| `tabs` | URL 및 LLM 감지 | 자동 LLM 감지 | URL만 읽음, 내용 접근 안함 |
| `scripting` | 대화 내용 추출 | DOM에서 대화 추출 | 활성 탭에만 실행 |
| `activeTab` | 현재 탭 접근 | 사용자 선택 탭만 처리 | 사용자 클릭 시에만 활성화 |
| `clipboardRead` | 클립보드 읽기 | 텍스트 저장 기능 | 사용자 gesture 필요 |
| `host_permissions` | LLM 페이지 및 이미지 접근 | 대화 추출 및 이미지 다운로드 | 명시된 도메인만 접근 |

---

## 🎯 최소 권한 원칙 준수

이 확장 프로그램은 최소 권한 원칙(Principle of Least Privilege)을 준수합니다:

1. 필요한 권한만 요청: 각 권한은 핵심 기능 수행에 필수적
2. 사용자 액션 기반: 모든 주요 작업은 사용자의 명시적 클릭으로 시작
3. 로컬 저장: File System Access API로 사용자가 선택한 폴더에만 저장
4. 원격 코드 없음: 모든 코드는 확장 프로그램 내부에 포함
5. 명시적 도메인: `host_permissions`는 필요한 도메인만 명시

---

작성일: 2024-12-21  
버전: 1.0.0  
문서 목적: Chrome Web Store 제출 시 권한 사용 근거 제공
