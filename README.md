# 🗂️ LLM Archive Extension

**Jeff Su 스타일의 LLM 대화 아카이빙 Chrome 확장 프로그램**

LLM(Large Language Model) 서비스에서 대화 내용을 손쉽게 추출하여 로컬 파일 시스템에 Markdown 파일로 저장하는 Chrome 확장 프로그램입니다. Obsidian과 호환되는 YAML frontmatter 형식을 지원합니다.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285f4?style=flat-square&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-10a37f?style=flat-square)
![Version](https://img.shields.io/badge/Version-1.0.0-blue?style=flat-square)

---

## ✨ 주요 기능

### 🤖 다중 LLM 지원
현재 4개의 주요 LLM 서비스에서 대화 내용을 추출할 수 있습니다:

| LLM 서비스 | 지원 여부 | 색상 코드 |
|-----------|:--------:|---------|
| **ChatGPT** (chatgpt.com, chat.openai.com) | ✅ | `#10a37f` |
| **Claude** (claude.ai) | ✅ | `#d97757` |
| **Gemini** (gemini.google.com) | ✅ | `#7b61ff` |
| **Grok** (grok.com) | ✅ | `#1d9bf0` |
| Copilot | 🔮 예정 | `#0078d4` |
| Perplexity | 🔮 예정 | `#20b2aa` |

### 💾 로컬 파일 시스템 저장
- **File System Access API** 사용으로 브라우저에서 직접 로컬 디렉토리에 저장
- IndexedDB를 통한 디렉토리 핸들 영구 저장
- 권한 재확인 없이 자동 재연결

### 📝 Obsidian 호환 Markdown
- YAML frontmatter 메타데이터 포함
- 이미지/비디오 자동 다운로드 및 `[98] Attachments` 폴더에 저장
- Obsidian 내부 링크 (`![[...]]`) 및 표준 Markdown 이미지 링크 동시 지원

### 🗃️ 폴더 구조 관리
- 디렉토리 트리 시각화
- Shift+클릭으로 저장 위치 선택
- 기본 저장 위치: `[00] Inbox`
- 중첩 폴더 지원

---

## 📁 프로젝트 구조

```
google_extension_practice/
├── manifest.json          # Chrome 확장 프로그램 설정 (Manifest V3)
├── background.js          # Service Worker - 이미지 다운로드, 사이드패널 제어
├── sidepanel.html         # 사이드패널 UI
├── sidepanel.js           # 핵심 로직 (1850+ lines)
│   ├── LLM 감지 및 UI 업데이트
│   ├── 대화 추출 (ChatGPT, Claude, Gemini, Grok)
│   ├── HTML → Markdown 변환 (Turndown.js)
│   ├── 미디어 다운로드 및 저장
│   └── 디렉토리 트리 렌더링
├── fileSystemUtils.js     # File System Access API 유틸리티
├── content.js             # Content Script (현재 비활성화)
├── popup.html             # 팝업 UI (테스트용)
├── popup.js               # 팝업 스크립트
├── turndown.min.js        # HTML to Markdown 변환 라이브러리
└── icon.png               # 확장 프로그램 아이콘
```

---

## 🚀 설치 방법

### 개발자 모드 설치

1. 이 저장소를 클론하거나 다운로드합니다:
   ```bash
   git clone <repository-url>
   cd google_extension_practice
   ```

2. Chrome 브라우저에서 `chrome://extensions/` 접속

3. 우측 상단의 **개발자 모드** 활성화

4. **압축해제된 확장 프로그램을 로드합니다** 클릭

5. `google_extension_practice` 폴더 선택

6. 확장 프로그램 아이콘이 툴바에 추가됩니다

---

## 📖 사용 방법

### 1️⃣ 디렉토리 연결

1. 확장 프로그램 아이콘 클릭 → 사이드패널 열기
2. **📦 저장소 연결** 섹션에서 `폴더 선택` 버튼 클릭
3. 대화를 저장할 로컬 디렉토리 선택 (예: Obsidian Vault)
4. 브라우저 권한 요청 승인

### 2️⃣ 대화 저장

1. LLM 서비스 페이지 (ChatGPT, Claude, Gemini, Grok) 접속
2. 저장하고 싶은 대화 열기
3. 사이드패널에서 LLM 자동 감지 확인
4. (선택) 제목 및 태그 입력
5. **💬 [LLM명] 대화 저장** 버튼 클릭

### 3️⃣ 저장 위치 변경

- 디렉토리 트리에서 원하는 폴더를 **Shift+클릭**
- 우측 상단에 선택된 경로 표시
- `✕` 버튼으로 기본 위치(`[00] Inbox`)로 복원

### 4️⃣ 클립보드 저장

- **📋 클립보드** 버튼으로 복사된 텍스트를 Markdown 파일로 저장

---

## 📄 저장 파일 형식

저장된 Markdown 파일은 다음과 같은 구조를 가집니다:

```markdown
---
savedAt: "2024-12-21T12:30:00.000Z"
createdAt: "2024-12-21T12:25:00.000Z"
sourceUrl: "https://chatgpt.com/c/..."
llm: "ChatGPT"
folder: "/[00] Inbox"
folderId: "00"
title: "대화 제목"
tags:
  - "AI"
  - "프로그래밍"
---

# 대화 제목

## user

사용자 질문 내용...

---

## assistant

AI 응답 내용...

![[첨부파일/image.png]]

![이미지](../[98] Attachments/대화제목/image.png)

---
```

---

## ⚙️ 기술 스택

| 분류 | 기술 |
|------|-----|
| **플랫폼** | Chrome Extension (Manifest V3) |
| **API** | File System Access API, Chrome Extensions API |
| **저장소** | IndexedDB (핸들 저장), chrome.storage.local |
| **변환** | Turndown.js (HTML → Markdown) |
| **언어** | JavaScript (ES Modules) |

---

## 🔐 권한 설명

| 권한 | 용도 |
|------|-----|
| `sidePanel` | 사이드패널 UI 제공 |
| `storage` | 설정 및 대기 중인 저장 데이터 관리 |
| `tabs` | 현재 탭의 URL 및 LLM 감지 |
| `scripting` | 페이지에서 대화 내용 추출 |
| `activeTab` | 현재 활성 탭 접근 |
| `clipboardRead` | 클립보드 내용 읽기 |
| `host_permissions` | LLM 서비스 페이지 접근 및 이미지 다운로드 |

---

## 🛠️ 개발

### 디버깅

```bash
# Chrome DevTools에서 Service Worker 디버깅
chrome://extensions → 세부정보 → 서비스 워커 검사

# 사이드패널 디버깅
사이드패널 우클릭 → 검사
```

### 주요 함수

| 함수 | 설명 |
|------|-----|
| `detectAndUpdateLLM()` | 현재 탭의 LLM 감지 및 UI 업데이트 |
| `saveConversationUnified()` | 통합 대화 저장 (LLM별 분기) |
| `extractGeminiConversationFromActiveTab()` | Gemini 대화 추출 |
| `extractChatGPTConversationFromActiveTab()` | ChatGPT 대화 추출 |
| `extractClaudeConversationFromActiveTab()` | Claude 대화 추출 |
| `extractGrokConversationFromActiveTab()` | Grok 대화 추출 |
| `htmlToMarkdown()` | Turndown.js를 사용한 HTML→MD 변환 |
| `downloadImageFromBackground()` | Background script를 통한 이미지 다운로드 |
| `saveClipToFileSystem()` | 파일 시스템에 클립 저장 |
| `renderDirectoryTree()` | 디렉토리 트리 UI 렌더링 |

---

## 📋 TODO

- [ ] Copilot 지원 추가
- [ ] Perplexity 지원 추가
- [ ] 대화 검색 기능
- [ ] 핀 기능 구현 (현재 UI만 존재)
- [ ] 내보내기 형식 선택 (JSON, HTML 등)
- [ ] 자동 저장 옵션

---

## 📝 라이선스

이 프로젝트는 개인 사용 목적으로 개발되었습니다.

---

## 🙏 크레딧

- [Turndown.js](https://github.com/mixmark-io/turndown) - HTML to Markdown 변환
- [Jeff Su](https://www.youtube.com/@JeffSu) - 아카이빙 워크플로우 영감

---

**Made with ❤️ for better LLM conversation management**
