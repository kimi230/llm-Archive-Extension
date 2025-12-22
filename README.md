# 🗂️ LLM Archive Extension

[**🇺🇸 English**](README.md) | [**🇰🇷 한국어**](README_ko.md)

**Jeff Su Style LLM Conversation Archiving Chrome Extension**

A Chrome extension that easily extracts conversation content from LLM (Large Language Model) services and saves them to the local file system as Markdown files. Supports YAML frontmatter format compatible with Obsidian.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285f4?style=flat-square&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-10a37f?style=flat-square)
![Version](https://img.shields.io/badge/Version-1.0.0-blue?style=flat-square)

---

## ✨ Key Features

### 🤖 Multi-LLM Support
Currently supports conversation extraction from 4 major LLM services:

| LLM Service | Supported | Color Code |
|-----------|:--------:|---------|
| **ChatGPT** (chatgpt.com, chat.openai.com) | ✅ | `#10a37f` |
| **Claude** (claude.ai) | ✅ | `#d97757` |
| **Gemini** (gemini.google.com) | ✅ | `#7b61ff` |
| **Grok** (grok.com) | ✅ | `#1d9bf0` |

### 💾 Local File System Storage
- Saves directly to local directory using **File System Access API**
- Persistent directory handle storage via IndexedDB
- Auto-reconnect without re-prompting permissions

### 📝 Obsidian Compatible Markdown
- Includes YAML frontmatter metadata
- Automatically downloads images/videos to `[98] Attachments` folder
- Supports both Obsidian internal links (`![[...]]`) and standard Markdown image links

### 🗃️ Folder Structure Management
- Directory tree visualization
- Shift+Click to select save location
- Default save location: `[00] Inbox`
- Supports nested folders

---

## 📁 Project Structure

```
google_extension_practice/
├── manifest.json          # Chrome Extension Configuration (Manifest V3)
├── background.js          # Service Worker - Image downloading, sidepanel control
├── sidepanel.html         # Sidepanel UI
├── sidepanel.js           # Core Logic (1850+ lines)
│   ├── LLM detection & UI update
│   ├── Conversation extraction (ChatGPT, Claude, Gemini, Grok)
│   ├── HTML → Markdown conversion (Turndown.js)
│   ├── Media downloading & saving
│   └── Directory tree rendering
├── fileSystemUtils.js     # File System Access API Utilities
├── content.js             # Content Script (Currently inactive)
├── popup.html             # Popup UI (For testing)
├── popup.js               # Popup Script
├── turndown.min.js        # HTML to Markdown conversion library
└── icon.png               # Extension Icon
```

---

## 🚀 Installation

### Developer Mode Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/kimi230/llm-Archive-Extension.git
   cd llm-Archive-Extension
   ```

2. Open `chrome://extensions/` in Chrome browser.

3. Enable **Developer mode** in the top right corner.

4. Click **Load unpacked**.

5. Select the `llm-Archive-Extension` folder.

6. The extension icon will be added to your toolbar.

---

## 📖 Usage

### 1️⃣ Connect Directory

1. Click the extension icon → Open Sidepanel.
2. In the **📦 Storage Connection** section, click the `Select Folder` button.
3. Select the local directory to save conversations (e.g., Obsidian Vault).
4. Approve the browser permission request.

### 2️⃣ Save Conversation

1. Open an LLM service page (ChatGPT, Claude, Gemini, Grok).
2. Open the conversation you want to save.
3. Check if the LLM is automatically detected in the sidepanel.
4. (Optional) Enter a title and tags.
5. Click the **💬 Save [LLM Name] Chat** button.

### 3️⃣ Change Save Location

- **Shift+Click** a folder in the directory tree.
- The selected path is displayed in the top right.
- Click `✕` to restore the default location (`[00] Inbox`).

### 4️⃣ Save Clipboard

- Click the **📋 Clipboard** button to save copied text as a Markdown file.

---

## 📄 Saved File Format

Saved Markdown files have the following structure:

```markdown
---
savedAt: "2024-12-21T12:30:00.000Z"
createdAt: "2024-12-21T12:25:00.000Z"
sourceUrl: "https://chatgpt.com/c/..."
llm: "ChatGPT"
folder: "/[00] Inbox"
folderId: "00"
title: "Conversation Title"
tags:
  - "AI"
  - "Programming"
---

# Conversation Title

## user

User question content...

---

## assistant

AI response content...

![[attachments/image.png]]

![Image](../[98] Attachments/ConversationTitle/image.png)

---
```

---

## ⚙️ Tech Stack

| Category | Technology |
|------|-----|
| **Platform** | Chrome Extension (Manifest V3) |
| **API** | File System Access API, Chrome Extensions API |
| **Storage** | IndexedDB (Handle storage), chrome.storage.local |
| **Conversion** | Turndown.js (HTML → Markdown) |
| **Language** | JavaScript (ES Modules) |

---

## 🔐 Permissions

| Permission | Usage |
|------|-----|
| `sidePanel` | Provides Sidepanel UI |
| `storage` | Manages settings and pending save data |
| `tabs` | Gets current tab URL and detects LLM |
| `scripting` | Extracts conversation content from pages |
| `activeTab` | Accesses current active tab |
| `clipboardRead` | Reads clipboard content |
| `host_permissions` | Accesses LLM service pages and downloads images |

---

## 🛠️ Development

### Debugging

```bash
# Debug Service Worker in Chrome DevTools
chrome://extensions → Details → Inspect views: Service Worker

# Debug Sidepanel
Right-click Sidepanel → Inspect
```

### Key Functions

| Function | Description |
|------|-----|
| `detectAndUpdateLLM()` | Detects current tab's LLM and updates UI |
| `saveConversationUnified()` | Unified conversation saving (Branches by LLM) |
| `extractGeminiConversationFromActiveTab()` | Extracts Gemini conversation |
| `extractChatGPTConversationFromActiveTab()` | Extracts ChatGPT conversation |
| `extractClaudeConversationFromActiveTab()` | Extracts Claude conversation |
| `extractGrokConversationFromActiveTab()` | Extracts Grok conversation |
| `htmlToMarkdown()` | Converts HTML → MD using Turndown.js |
| `downloadImageFromBackground()` | Downloads images via Background script |
| `saveClipToFileSystem()` | Saves clipboard content to file system |
| `renderDirectoryTree()` | Renders directory tree UI |

---

## 📝 License

This project was developed for personal use.

---

## 🙏 Credits

- [Turndown.js](https://github.com/mixmark-io/turndown) - HTML to Markdown conversion
- [Jeff Su](https://www.youtube.com/@JeffSu) - Archiving workflow inspiration

---

**Made with ❤️ for better LLM conversation management**
