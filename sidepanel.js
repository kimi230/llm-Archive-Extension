// sidepanel.js
import {
	chooseAndStoreDirectory,
	loadAndVerifyDirectory,
	checkDirectoryPermission,
	saveFileToDirectory,
	getOrCreateSubfolder,
	getOrCreateNestedSubfolder,
	ensureUniqueFileName
} from './fileSystemUtils.js';
import { generateMetadata, planExtraction, writeExtraction } from './openaiUtils.js';


let currentDirHandle = null;
let selectedFolderPath = []; // 현재 선택된 저장 경로 (배열)
let pinnedPaths = [];        // 핀된 경로 목록 (배열의 배열)
let expandedPaths = new Set(); // 펼쳐진 폴더 경로 저장

// 핀 최대 개수
const MAX_PINS = 5;

// 추출 파이프라인 상태
let currentExtractionPlan = null;
let currentConversationContent = null;

// API Key 관련 함수
async function loadApiKey() {
	try {
		const { openaiApiKey = '' } = await chrome.storage.local.get('openaiApiKey');
		return openaiApiKey;
	} catch (error) {
		console.error('API Key 로드 실패:', error);
		return '';
	}
}

async function saveApiKey(key) {
	try {
		await chrome.storage.local.set({ openaiApiKey: key });
		return true;
	} catch (error) {
		console.error('API Key 저장 실패:', error);
		return false;
	}
}

async function updateApiKeyStatus() {
	const statusEl = document.getElementById('api-key-status');
	const inputEl = document.getElementById('openai-api-key');
	if (!statusEl) return;

	const key = await loadApiKey();
	if (key && key.trim()) {
		statusEl.textContent = '설정됨';
		statusEl.className = 'status-badge connected';
		if (inputEl) inputEl.value = key;
	} else {
		statusEl.textContent = '미설정';
		statusEl.className = 'status-badge disconnected';
	}
}


// Turndown 인스턴스 생성 및 설정
const turndownService = new TurndownService({
	headingStyle: 'atx',           // # 스타일 헤딩
	hr: '---',
	bulletListMarker: '-',
	codeBlockStyle: 'fenced',      // ``` 스타일 코드 블록
	fence: '```',
	emDelimiter: '*',
	strongDelimiter: '**',
	linkStyle: 'inlined',
	linkReferenceStyle: 'full'
});

// 불필요한 요소 무시 (버튼, SVG 등)
turndownService.addRule('ignoreButtons', {
	filter: ['button', 'svg', 'path', 'script', 'style'],
	replacement: function () {
		return '';
	}
});

// 이미지는 무시 (별도로 처리하므로)
turndownService.addRule('ignoreImages', {
	filter: 'img',
	replacement: function () {
		return '';
	}
});

/**
 * HTML 문자열을 Markdown으로 변환
 * @param {string} html - HTML 문자열
 * @returns {string} - Markdown 문자열
 */
function htmlToMarkdown(html) {
	if (!html || typeof html !== 'string') {
		return '';
	}

	try {
		const markdown = turndownService.turndown(html);

		// 결과 정리: 연속 빈 줄 제거
		return markdown
			.replace(/\n{3,}/g, '\n\n')
			.trim();
	} catch (error) {
		console.error('HTML to Markdown 변환 실패:', error);
		// 폴백: HTML 태그만 제거
		return html.replace(/<[^>]+>/g, '').trim();
	}
}

function detectLLMFromUrl(url) {
	try {
		const u = new URL(url);
		const host = u.hostname.toLowerCase();
		if (host.includes('chat.openai.com') || host.includes('chatgpt.com')) return 'ChatGPT';
		if (host.includes('claude.ai')) return 'Claude';
		if (host.includes('gemini.google.com')) return 'Gemini';
		if (host.includes('grok.com')) return 'Grok';
		if (host.includes('copilot.microsoft.com')) return 'Copilot';
		if (host.includes('perplexity.ai')) return 'Perplexity';
		return 'Unknown';
	} catch (error) {
		return 'Unknown';
	}
}

// LLM별 색상 맵
const LLM_COLORS = {
	ChatGPT: '#10a37f',
	Claude: '#d97757',
	Gemini: '#7b61ff',
	Grok: '#1d9bf0',
	Copilot: '#0078d4',
	Perplexity: '#20b2aa',
	Unknown: '#888'
};

let currentDetectedLLM = 'Unknown';
let lastDetectedUrl = '';
let currentGeneratedSummary = ''; // AI가 생성한 요약 저장

/**
 * 현재 활성 탭의 LLM을 감지하고 UI 업데이트
 */
async function detectAndUpdateLLM() {
	const indicator = document.getElementById('llm-indicator');
	const nameEl = document.getElementById('llm-name');
	const saveBtn = document.getElementById('save-conversation-btn');

	try {
		const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		const tab = tabs && tabs[0];

		const url = tab && tab.url ? tab.url : '';

		// URL이 변경되었으면 입력창 초기화
		if (url !== lastDetectedUrl) {
			lastDetectedUrl = url;
			const titleInput = document.getElementById('clip-title');
			const tagsInput = document.getElementById('default-tags');
			// 상태 메시지도 초기화
			const statusEl = document.getElementById('save-status');

			if (titleInput) titleInput.value = '';
			if (tagsInput) tagsInput.value = '';
			if (statusEl) statusEl.textContent = '';
			currentGeneratedSummary = ''; // 요약 초기화
		}

		currentDetectedLLM = detectLLMFromUrl(url);
		const color = LLM_COLORS[currentDetectedLLM] || LLM_COLORS.Unknown;

		if (indicator) indicator.style.background = color;

		if (currentDetectedLLM === 'Unknown') {
			if (nameEl) nameEl.textContent = 'LLM 페이지 아님';
			if (saveBtn) {
				saveBtn.disabled = true;
				saveBtn.style.background = '#ccc';
				saveBtn.textContent = '저장';
			}
		} else {
			if (nameEl) nameEl.textContent = `${currentDetectedLLM} 감지됨`;
			if (saveBtn) {
				saveBtn.disabled = false;
				saveBtn.style.background = color;
				saveBtn.textContent = `저장`;
			}
		}
	} catch (error) {
		console.error('LLM 감지 실패:', error);
		currentDetectedLLM = 'Unknown';
		if (indicator) indicator.style.background = LLM_COLORS.Unknown;
		if (nameEl) nameEl.textContent = '감지 실패';
		if (saveBtn) {
			saveBtn.disabled = true;
			saveBtn.style.background = '#ccc';
		}
	}
}

/**
 * 통합 대화 저장 함수 - 감지된 LLM에 따라 적절한 함수 호출
 */
async function saveConversationUnified() {
	const statusEl = document.getElementById('save-status');
	const saveBtn = document.getElementById('save-conversation-btn');
	const multiFileMode = document.getElementById('multi-file-mode')?.checked;

	const setStatus = (text, color) => {
		if (statusEl) {
			statusEl.textContent = text;
			statusEl.style.color = color || '#888';
		}
	};

	// 내용정리 모드(글 여러개 저장)가 켜져 있으면 추출 파이프라인 시작
	if (multiFileMode) {
		await startExtractionPipeline();
		return;
	}

	if (saveBtn) saveBtn.disabled = true;

	try {
		switch (currentDetectedLLM) {
			case 'ChatGPT':
				setStatus('ChatGPT 대화 저장 중...', '#888');
				await saveChatGPTConversation();
				break;
			case 'Claude':
				setStatus('Claude 대화 저장 중...', '#888');
				await saveClaudeConversation();
				break;
			case 'Gemini':
				setStatus('Gemini 대화 저장 중...', '#888');
				await saveGeminiConversation();
				break;
			case 'Grok':
				setStatus('Grok 대화 저장 중...', '#888');
				await saveGrokConversation();
				break;
			default:
				setStatus('LLM 페이지가 아닙니다.', '#f44336');
		}
	} catch (error) {
		console.error('대화 저장 실패:', error);
		setStatus(`저장 실패: ${error.message}`, '#f44336');
	} finally {
		if (saveBtn) saveBtn.disabled = false;
	}
}

function sanitizeFileName(input) {
	try {
		const name = String(input || '').trim();
		if (!name) return 'untitled';
		const cleaned = name
			.replace(/[\\\/:*?"<>|]/g, '_')
			.replace(/[\u0000-\u001f\u007f]/g, '_')
			.replace(/\s+/g, ' ')
			.trim();
		return cleaned.slice(0, 120) || 'untitled';
	} catch (error) {
		return 'untitled';
	}
}

function formatTags(tags) {
	const lines = [];
	for (const t of tags) {
		lines.push(`  - ${yamlQuote(t)}`);
	}
	return lines.join('\n');
}

function yamlQuote(value) {
	// 간단하고 안전하게 YAML 문자열로 만들기 (JSON string literal 사용)
	try {
		return JSON.stringify(String(value ?? ''));
	} catch (error) {
		return '""';
	}
}

async function getActiveTabUrl() {
	try {
		const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
		const tab = tabs && tabs[0];
		if (tab && typeof tab.url === 'string' && tab.url) {
			return tab.url;
		}
	} catch (error) {
		// ignore
	}
	return 'clipboard://local';
}

async function readClipboardText() {
	// 사용자 클릭(gesture) 컨텍스트에서 호출되어야 함
	if (navigator.clipboard && navigator.clipboard.readText) {
		try {
			return await navigator.clipboard.readText();
		} catch (error) {
			// 권한/정책 이슈일 가능성이 큼
			throw new Error('클립보드 읽기 권한이 없습니다. (확장프로그램 재로드 후 다시 시도 / permissions에 clipboardRead 필요)');
		}
	}
	throw new Error('클립보드 API를 사용할 수 없습니다.');
}

function formatDateForTitle(date) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildAutoTitle(sourceUrl) {
	try {
		const d = new Date();
		let host = 'unknown';
		try {
			host = new URL(sourceUrl).hostname || 'unknown';
		} catch (error) {
			// ignore
		}
		return `${formatDateForTitle(d)}_${host}_clip`;
	} catch (error) {
		return 'untitled';
	}
}

async function saveClipboardMarkdown() {
	const statusEl = document.getElementById('clipboard-status');
	const saveBtn = document.getElementById('save-clipboard-btn');
	const titleInput = document.getElementById('clip-title');

	const setStatus = (text, color) => {
		if (!statusEl) return;
		statusEl.textContent = text;
		if (color) statusEl.style.color = color;
	};

	try {
		if (saveBtn) saveBtn.disabled = true;
		setStatus('클립보드 읽는 중...', '#888');

		const t0 = performance.now();
		const text = await readClipboardText();
		const md = String(text || '').trim();
		if (!md) {
			setStatus('클립보드가 비어있습니다.', '#f44336');
			return;
		}

		const sourceUrl = await getActiveTabUrl();
		const manualTitle = titleInput ? String(titleInput.value || '').trim() : '';
		const title = manualTitle || buildAutoTitle(sourceUrl);

		// 선택 안하면 00. Inbox로 저장
		const clip = {
			id: Date.now().toString(),
			title,
			content: md,
			content: md,
			folderId: '00',
			sourceUrl,
			summary: currentGeneratedSummary, // AI 요약 포함
			createdAt: new Date().toISOString()
		};

		// 내부 저장소에도 저장(원본 데이터 유지)
		const { clips = [] } = await chrome.storage.local.get('clips');
		await chrome.storage.local.set({ clips: [...clips, clip] });

		// 파일 저장: 디렉토리 연결 시 즉시 저장, 아니면 큐에 적재
		if (currentDirHandle) {
			const ok = await saveClipToFileSystem(clip);
			const t1 = performance.now();
			const ms = Math.round((t1 - t0) * 100) / 100;
			await chrome.storage.local.set({ lastSave: { at: new Date().toISOString(), ms, ok } });
			if (ok) {
				setStatus(`저장 완료 (${ms}ms)`, '#34a853');
				renderDirectoryTree(currentDirHandle);
			} else {
				setStatus('저장 실패 (콘솔 확인)', '#f44336');
			}
		} else {
			const { pendingFileSaves = [] } = await chrome.storage.local.get('pendingFileSaves');
			pendingFileSaves.push(clip);
			await chrome.storage.local.set({ pendingFileSaves });
			setStatus('디렉토리 미연결: 일단 큐에 저장됨(연결되면 자동 저장)', '#ff9800');
		}

	} catch (error) {
		console.error('클립보드 저장 실패:', error);
		const msg = error && error.message ? error.message : String(error);
		setStatus(`클립보드 저장 실패: ${msg}`, '#f44336');
	} finally {
		if (saveBtn) saveBtn.disabled = false;
	}
}

async function getActiveTab() {
	const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
	return tabs && tabs[0] ? tabs[0] : null;
}

function buildGeminiMarkdownFromTurns(turns, mediaMap, mediaFolderName) {
	// mediaMap: { originalSrc: { fileName, alt, type: 'image'|'video' } }
	// mediaFolderName: 미디어가 저장된 하위 폴더명 (문서 제목)
	const blocks = [];
	for (const t of turns) {
		const userText = htmlToMarkdown(t.userHtml);
		const modelText = htmlToMarkdown(t.modelHtml);

		if (userText) {
			blocks.push(`## user\n\n${userText}\n`);
		}
		// user 이미지/비디오 삽입
		if (t.images && t.images.length > 0) {
			for (const img of t.images) {
				if (img.role === 'user' && mediaMap && mediaMap[img.src]) {
					const { fileName, alt } = mediaMap[img.src];
					blocks.push(`![[${mediaFolderName}/${fileName}]]\n\n![${alt}](../98. Attachments/${mediaFolderName}/${fileName})\n\n`);
				}
			}
		}
		if (t.videos && t.videos.length > 0) {
			for (const video of t.videos) {
				if (video.role === 'user' && mediaMap && mediaMap[video.src]) {
					const { fileName } = mediaMap[video.src];
					blocks.push(`![[${mediaFolderName}/${fileName}]]\n\n[Video](../98. Attachments/${mediaFolderName}/${fileName})\n\n`);
				}
			}
		}
		if (modelText) {
			blocks.push(`## assistant\n\n${modelText}\n`);
		}
		// assistant 이미지/비디오 삽입
		if (t.images && t.images.length > 0) {
			for (const img of t.images) {
				if (img.role === 'assistant' && mediaMap && mediaMap[img.src]) {
					const { fileName, alt } = mediaMap[img.src];
					blocks.push(`![[${mediaFolderName}/${fileName}]]\n\n![${alt}](../98. Attachments/${mediaFolderName}/${fileName})\n\n`);
				}
			}
		}
		if (t.videos && t.videos.length > 0) {
			for (const video of t.videos) {
				if (video.role === 'assistant' && mediaMap && mediaMap[video.src]) {
					const { fileName } = mediaMap[video.src];
					blocks.push(`![[${mediaFolderName}/${fileName}]]\n\n[Video](../98. Attachments/${mediaFolderName}/${fileName})\n\n`);
				}
			}
		}
		blocks.push('---\n');
	}
	// 마지막 구분선 정리
	let md = blocks.join('\n').trim();
	if (md.endsWith('---')) {
		md = md.slice(0, -3).trim();
	}
	return md;
}

async function downloadImageFromBackground(imageUrl) {
	// Background script를 통해 이미지 다운로드 (CORS 우회)
	const result = await chrome.runtime.sendMessage({
		type: 'DOWNLOAD_IMAGE',
		url: imageUrl
	});

	if (!result || !result.ok) {
		throw new Error(`이미지 다운로드 실패: ${result?.error || 'unknown'}`);
	}
	return { data: new Uint8Array(result.data), contentType: result.contentType };
}

async function extractGeminiConversationFromActiveTab() {
	const tab = await getActiveTab();
	if (!tab || typeof tab.id !== 'number') {
		throw new Error('활성 탭을 찾지 못했습니다.');
	}

	const results = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			const url = location.href;
			let hostname = '';
			try {
				hostname = location.hostname.toLowerCase();
			} catch (error) {
				hostname = '';
			}

			if (!hostname.includes('gemini.google.com')) {
				return { ok: false, reason: 'NOT_GEMINI', url };
			}

			const turnNodes = Array.from(document.querySelectorAll('.conversation-container'));
			const turns = [];

			for (const node of turnNodes) {
				const userHtml = node.querySelector('user-query')?.innerHTML || '';
				const modelHtml = node.querySelector('model-response')?.innerHTML || '';
				if (!userHtml.trim() && !modelHtml.trim()) {
					continue;
				}

				// 부모 요소로 user/assistant 판별하는 헬퍼 함수
				const getRoleFromParent = (element) => {
					let role = 'assistant';
					let parent = element.parentElement;
					while (parent && parent !== node) {
						if (parent.tagName === 'USER-QUERY') {
							role = 'user';
							break;
						}
						if (parent.tagName === 'MODEL-RESPONSE') {
							role = 'assistant';
							break;
						}
						parent = parent.parentElement;
					}
					return role;
				};

				// 이미지 추출 (conversation-container 전체에서 찾기)
				const images = [];
				const allImgs = Array.from(node.querySelectorAll('img'));
				for (const img of allImgs) {
					const src = img.src || img.getAttribute('src') || '';
					const alt = img.alt || img.getAttribute('alt') || 'image';
					if (src && src.startsWith('http')) {
						images.push({ src, alt, role: getRoleFromParent(img) });
					}
				}

				// 비디오 추출
				const videos = [];
				const allVideos = Array.from(node.querySelectorAll('video'));
				for (const video of allVideos) {
					const src = video.src || video.getAttribute('src') || '';
					if (src && src.startsWith('http')) {
						videos.push({ src, role: getRoleFromParent(video) });
					}
				}

				turns.push({ userHtml, modelHtml, images, videos });
			}

			const title = document.title || 'Gemini Conversation';
			return { ok: true, url, title, turns, turnCount: turns.length, rawTurnCount: turnNodes.length };
		}
	});

	const result = results && results[0] && results[0].result ? results[0].result : null;
	if (!result) {
		throw new Error('대화 추출 결과가 비어있습니다.');
	}
	if (!result.ok) {
		if (result.reason === 'NOT_GEMINI') {
			throw new Error('Gemini 페이지가 아닙니다. gemini.google.com 탭에서 실행해주세요.');
		}
		throw new Error('대화 추출 실패');
	}
	return result;
}

async function extractGrokConversationFromActiveTab() {
	const tab = await getActiveTab();
	if (!tab || typeof tab.id !== 'number') {
		throw new Error('활성 탭을 찾지 못했습니다.');
	}

	const results = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			const url = location.href;
			let hostname = '';
			try {
				hostname = location.hostname.toLowerCase();
			} catch (error) {
				hostname = '';
			}

			const isGrok = hostname.includes('grok.com');

			if (!isGrok) {
				return { ok: false, reason: 'NOT_GROK', url };
			}

			// 모든 메시지 컨테이너 찾기 (일반 대화 + 마지막 대화)
			const messageNodes = Array.from(document.querySelectorAll('[id^="response-"]'));
			const turns = [];

			for (const node of messageNodes) {
				// user/assistant 판별: items-end = user, items-start = assistant
				const isUser = node.classList.contains('items-end');
				const role = isUser ? 'user' : 'assistant';

				// 텍스트 추출 (HTML로)
				const contentEl = node.querySelector('.response-content-markdown');
				const html = contentEl?.innerHTML || '';

				if (!html.trim()) continue;

				// 이미지 추출 (data-testid="image-viewer" 내부)
				const images = [];
				const imageViewer = node.querySelector('[data-testid="image-viewer"]');
				if (imageViewer) {
					const allImgs = Array.from(imageViewer.querySelectorAll('img'));
					for (const img of allImgs) {
						const src = img.src || img.getAttribute('src') || '';
						const alt = img.alt || img.getAttribute('alt') || 'image';
						if (src && src.startsWith('http')) {
							images.push({ src, alt, role });
						}
					}
				}

				turns.push({ role, html, images });
			}

			const title = document.title || 'Grok Conversation';
			return { ok: true, url, title, turns, turnCount: turns.length };
		}
	});

	const result = results && results[0] && results[0].result ? results[0].result : null;
	if (!result) {
		throw new Error('대화 추출 결과가 비어있습니다.');
	}
	if (!result.ok) {
		if (result.reason === 'NOT_GROK') {
			throw new Error('Grok 페이지가 아닙니다. grok.com 탭에서 실행해주세요.');
		}
		throw new Error('대화 추출 실패');
	}
	return result;
}

function buildGrokMarkdownFromTurns(turns, mediaMap, mediaFolderName) {
	const blocks = [];
	for (const t of turns) {
		const text = htmlToMarkdown(t.html);
		blocks.push(`## ${t.role}\n\n${text}\n`);

		// 이미지 삽입
		if (t.images && t.images.length > 0) {
			for (const img of t.images) {
				if (mediaMap && mediaMap[img.src]) {
					const { fileName, alt } = mediaMap[img.src];
					blocks.push(`![[${mediaFolderName}/${fileName}]]\n\n![${alt}](../98. Attachments/${mediaFolderName}/${fileName})\n\n`);
				}
			}
		}
		blocks.push('---\n');
	}

	let md = blocks.join('\n').trim();
	if (md.endsWith('---')) {
		md = md.slice(0, -3).trim();
	}
	return md;
}

async function saveGrokConversation() {
	const statusEl = document.getElementById('save-status');
	const btn = document.getElementById('save-grok-btn');
	const titleInput = document.getElementById('clip-title');

	const setStatus = (text, color) => {
		if (!statusEl) return;
		statusEl.textContent = text;
		if (color) statusEl.style.color = color;
	};

	try {
		if (btn) btn.disabled = true;
		setStatus('Grok 대화 추출 중...', '#888');

		const t0 = performance.now();
		const extracted = await extractGrokConversationFromActiveTab();

		// 제목 먼저 결정
		const manualTitle = titleInput ? String(titleInput.value || '').trim() : '';
		const autoTitle = `${formatDateForTitle(new Date())}_Grok_conversation`;
		const title = manualTitle || sanitizeFileName(extracted.title) || autoTitle;
		const mediaFolderName = sanitizeFileName(title);

		// 이미지 수집 (중복 제거)
		const uniqueImages = [];
		const imageSrcSet = new Set();
		for (const turn of extracted.turns) {
			if (turn.images && turn.images.length > 0) {
				for (const img of turn.images) {
					if (img.src && !imageSrcSet.has(img.src)) {
						imageSrcSet.add(img.src);
						uniqueImages.push(img);
					}
				}
			}
		}

		// 미디어 다운로드 및 저장
		const mediaMap = {};
		if (uniqueImages.length > 0 && currentDirHandle) {
			setStatus(`이미지 다운로드 중... (${uniqueImages.length}개)`, '#888');
			const attachmentsDir = await getOrCreateSubfolder(currentDirHandle, '98. Attachments');
			const mediaSubDir = await getOrCreateSubfolder(attachmentsDir, mediaFolderName);

			for (let i = 0; i < uniqueImages.length; i++) {
				const img = uniqueImages[i];
				try {
					setStatus(`이미지 다운로드 중... (${i + 1}/${uniqueImages.length})`, '#888');
					const { data, contentType } = await downloadImageFromBackground(img.src);

					let fileName = sanitizeFileName(img.alt) || `image_${Date.now()}_${i}`;
					let ext = 'png';
					if (contentType.includes('jpeg') || contentType.includes('jpg')) {
						ext = 'jpg';
					} else if (contentType.includes('webp')) {
						ext = 'webp';
					} else if (contentType.includes('gif')) {
						ext = 'gif';
					}
					if (!fileName.toLowerCase().endsWith(`.${ext}`)) {
						fileName = `${fileName}.${ext}`;
					}

					const fileHandle = await mediaSubDir.getFileHandle(fileName, { create: true });
					const writable = await fileHandle.createWritable();
					await writable.write(data);
					await writable.close();

					mediaMap[img.src] = { fileName, alt: img.alt || 'image' };
					console.log(`이미지 저장 완료: ${mediaFolderName}/${fileName}`);
				} catch (error) {
					console.error(`이미지 다운로드 실패 (${img.src}):`, error);
				}
			}
		}

		const md = buildGrokMarkdownFromTurns(extracted.turns, mediaMap, mediaFolderName);
		if (!md || !md.trim()) {
			setStatus('대화가 비어있습니다.', '#f44336');
			return;
		}

		const clip = {
			id: Date.now().toString(),
			title,
			content: md,
			folderId: '00',
			sourceUrl: extracted.url,
			summary: currentGeneratedSummary, // AI 요약 포함
			createdAt: new Date().toISOString()
		};

		const { clips = [] } = await chrome.storage.local.get('clips');
		await chrome.storage.local.set({ clips: [...clips, clip] });

		if (currentDirHandle) {
			const ok = await saveClipToFileSystem(clip);
			const t1 = performance.now();
			const ms = Math.round((t1 - t0) * 100) / 100;
			if (ok) {
				setStatus(`Grok 저장 완료: ${extracted.turnCount}턴 (${ms}ms)`, '#34a853');
				renderDirectoryTree(currentDirHandle);
			} else {
				setStatus('Grok 저장 실패 (콘솔 확인)', '#f44336');
			}
		} else {
			const { pendingFileSaves = [] } = await chrome.storage.local.get('pendingFileSaves');
			pendingFileSaves.push(clip);
			await chrome.storage.local.set({ pendingFileSaves });
			setStatus(`디렉토리 미연결: 큐에 저장됨 (턴 ${extracted.turnCount})`, '#ff9800');
		}

	} catch (error) {
		console.error('Grok 저장 실패:', error);
		const msg = error && error.message ? error.message : String(error);
		setStatus(`Grok 저장 실패: ${msg}`, '#f44336');
	} finally {
		if (btn) btn.disabled = false;
	}
}

async function saveGeminiConversation() {
	const statusEl = document.getElementById('save-status');
	const btn = document.getElementById('save-gemini-btn');
	const titleInput = document.getElementById('clip-title');

	const setStatus = (text, color) => {
		if (!statusEl) return;
		statusEl.textContent = text;
		if (color) statusEl.style.color = color;
	};

	try {
		if (btn) btn.disabled = true;
		setStatus('Gemini 대화 추출 중...', '#888');

		const t0 = performance.now();
		const extracted = await extractGeminiConversationFromActiveTab();

		// 제목 먼저 결정 (미디어 폴더명으로 사용)
		const manualTitle = titleInput ? String(titleInput.value || '').trim() : '';
		const autoTitle = `${formatDateForTitle(new Date())}_Gemini_conversation`;
		const title = manualTitle || sanitizeFileName(extracted.title) || autoTitle;
		const mediaFolderName = sanitizeFileName(title); // 미디어 저장용 폴더명

		// 이미지 수집 (중복 제거)
		const uniqueImages = [];
		const imageSrcSet = new Set();
		for (const turn of extracted.turns) {
			if (turn.images && turn.images.length > 0) {
				for (const img of turn.images) {
					if (img.src && !imageSrcSet.has(img.src)) {
						imageSrcSet.add(img.src);
						uniqueImages.push(img);
					}
				}
			}
		}

		// 비디오 수집 (중복 제거)
		const uniqueVideos = [];
		const videoSrcSet = new Set();
		for (const turn of extracted.turns) {
			if (turn.videos && turn.videos.length > 0) {
				for (const video of turn.videos) {
					if (video.src && !videoSrcSet.has(video.src)) {
						videoSrcSet.add(video.src);
						uniqueVideos.push(video);
					}
				}
			}
		}

		const totalMedia = uniqueImages.length + uniqueVideos.length;

		// 미디어 다운로드 및 저장
		const mediaMap = {}; // { originalSrc: { fileName, alt, type } }
		if (totalMedia > 0 && currentDirHandle) {
			setStatus(`미디어 다운로드 중... (${totalMedia}개)`, '#888');
			const attachmentsDir = await getOrCreateSubfolder(currentDirHandle, '98. Attachments');
			// 문서 제목으로 하위 폴더 생성
			const mediaSubDir = await getOrCreateSubfolder(attachmentsDir, mediaFolderName);

			let mediaIndex = 0;

			// 이미지 다운로드
			for (let i = 0; i < uniqueImages.length; i++) {
				const img = uniqueImages[i];
				try {
					mediaIndex++;
					setStatus(`미디어 다운로드 중... (${mediaIndex}/${totalMedia}) - 이미지`, '#888');
					const { data, contentType } = await downloadImageFromBackground(img.src);

					// 파일명 생성
					let fileName = sanitizeFileName(img.alt) || `image_${Date.now()}_${i}`;
					// 확장자 결정
					let ext = 'png';
					if (contentType.includes('jpeg') || contentType.includes('jpg')) {
						ext = 'jpg';
					} else if (contentType.includes('webp')) {
						ext = 'webp';
					} else if (contentType.includes('gif')) {
						ext = 'gif';
					}
					if (!fileName.toLowerCase().endsWith(`.${ext}`)) {
						fileName = `${fileName}.${ext}`;
					}

					// 파일 저장 (하위 폴더에)
					const fileHandle = await mediaSubDir.getFileHandle(fileName, { create: true });
					const writable = await fileHandle.createWritable();
					await writable.write(data);
					await writable.close();

					mediaMap[img.src] = { fileName, alt: img.alt || 'image', type: 'image' };
					console.log(`이미지 저장 완료: ${mediaFolderName}/${fileName}`);
				} catch (error) {
					console.error(`이미지 다운로드 실패 (${img.src}):`, error);
				}
			}

			// 비디오 다운로드
			for (let i = 0; i < uniqueVideos.length; i++) {
				const video = uniqueVideos[i];
				try {
					mediaIndex++;
					setStatus(`미디어 다운로드 중... (${mediaIndex}/${totalMedia}) - 비디오`, '#888');
					const { data, contentType } = await downloadImageFromBackground(video.src);

					// 파일명 생성
					let fileName = `video_${Date.now()}_${i}`;
					// 확장자 결정
					let ext = 'mp4';
					if (contentType.includes('webm')) {
						ext = 'webm';
					} else if (contentType.includes('mov')) {
						ext = 'mov';
					}
					fileName = `${fileName}.${ext}`;

					// 파일 저장 (하위 폴더에)
					const fileHandle = await mediaSubDir.getFileHandle(fileName, { create: true });
					const writable = await fileHandle.createWritable();
					await writable.write(data);
					await writable.close();

					mediaMap[video.src] = { fileName, type: 'video' };
					console.log(`비디오 저장 완료: ${mediaFolderName}/${fileName}`);
				} catch (error) {
					console.error(`비디오 다운로드 실패 (${video.src}):`, error);
				}
			}
		} else if (totalMedia > 0 && !currentDirHandle) {
			// 디렉토리 미연결 시 미디어는 다운로드하지 않고 텍스트만 저장
			console.log(`${totalMedia}개의 미디어가 있지만 디렉토리가 연결되지 않아 저장하지 않습니다.`);
		}

		const md = buildGeminiMarkdownFromTurns(extracted.turns, mediaMap, mediaFolderName);
		if (!md || !md.trim()) {
			setStatus('대화가 비어있습니다(스크롤로 대화가 로드되었는지 확인).', '#f44336');
			return;
		}

		const clip = {
			id: Date.now().toString(),
			title,
			content: md,
			folderId: '00',
			sourceUrl: extracted.url,
			summary: currentGeneratedSummary, // AI 요약 포함
			createdAt: new Date().toISOString()
		};

		// 내부 저장소에도 저장(원본 데이터 유지)
		const { clips = [] } = await chrome.storage.local.get('clips');
		await chrome.storage.local.set({ clips: [...clips, clip] });

		// 파일 저장: 디렉토리 연결 시 즉시 저장, 아니면 큐에 적재
		if (currentDirHandle) {
			const ok = await saveClipToFileSystem(clip);
			const t1 = performance.now();
			const ms = Math.round((t1 - t0) * 100) / 100;
			await chrome.storage.local.set({
				lastGeminiSave: {
					at: new Date().toISOString(),
					ms,
					ok,
					turnCount: extracted.turnCount,
					rawTurnCount: extracted.rawTurnCount
				}
			});
			if (ok) {
				setStatus(`Gemini 저장 완료: ${extracted.turnCount}턴 (${ms}ms)`, '#34a853');
				renderDirectoryTree(currentDirHandle);
			} else {
				setStatus('Gemini 저장 실패 (콘솔 확인)', '#f44336');
			}
		} else {
			const { pendingFileSaves = [] } = await chrome.storage.local.get('pendingFileSaves');
			pendingFileSaves.push(clip);
			await chrome.storage.local.set({ pendingFileSaves });
			setStatus(`디렉토리 미연결: 큐에 저장됨 (턴 ${extracted.turnCount})`, '#ff9800');
		}

	} catch (error) {
		console.error('Gemini 저장 실패:', error);
		const msg = error && error.message ? error.message : String(error);
		setStatus(`Gemini 저장 실패: ${msg}`, '#f44336');
	} finally {
		if (btn) btn.disabled = false;
	}
}

async function extractChatGPTConversationFromActiveTab() {
	const tab = await getActiveTab();
	if (!tab || typeof tab.id !== 'number') {
		throw new Error('활성 탭을 찾지 못했습니다.');
	}

	const results = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			const url = location.href;
			let hostname = '';
			try {
				hostname = location.hostname.toLowerCase();
			} catch (error) {
				hostname = '';
			}

			if (!hostname.includes('chat.openai.com') && !hostname.includes('chatgpt.com')) {
				return { ok: false, reason: 'NOT_CHATGPT', url };
			}

			// article[data-testid^="conversation-turn-"] 
			const turnNodes = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"]'));
			const turns = [];

			for (const node of turnNodes) {
				const roleAttr = node.getAttribute('data-turn'); // 'user' or 'assistant'
				let role = roleAttr || 'unknown';

				// 롤이 명확하지 않을 때 내부 요소로 확인
				if (!roleAttr) {
					if (node.querySelector('[data-message-author-role="user"]')) {
						role = 'user';
					} else if (node.querySelector('[data-message-author-role="assistant"]')) {
						role = 'assistant';
					}
				}

				let html = '';
				const images = [];

				if (role === 'user') {
					const msgDiv = node.querySelector('[data-message-author-role="user"]');
					if (msgDiv) {
						// 텍스트 (줄바꿈 클래스 포함)
						const textDiv = msgDiv.querySelector('.whitespace-pre-wrap');
						// innerText 대신 innerHTML 사용하려고 했으나, user 메시지는 보통 텍스트만 있음
						// 하지만 서식이 있을 수 있으니 innerHTML 사용
						html = textDiv ? textDiv.innerHTML : msgDiv.innerHTML;

						// 이미지 추출
						const imgs = Array.from(msgDiv.querySelectorAll('img'));
						for (const img of imgs) {
							const src = img.src || img.getAttribute('src');
							const alt = img.alt || img.getAttribute('alt') || 'User Image';
							if (src && src.startsWith('http')) {
								images.push({ src, alt, role });
							}
						}
					}
				} else if (role === 'assistant') {
					const msgDiv = node.querySelector('[data-message-author-role="assistant"]');
					if (msgDiv) {
						// 마크다운 클래스 (.markdown.prose)
						const markdownDiv = msgDiv.querySelector('.markdown');
						html = markdownDiv ? markdownDiv.innerHTML : msgDiv.innerHTML;

						// 이미지 추출 (있을 경우)
						const imgs = Array.from(msgDiv.querySelectorAll('img'));
						for (const img of imgs) {
							const src = img.src || img.getAttribute('src');
							const alt = img.alt || img.getAttribute('alt') || 'Generated Image';
							if (src && src.startsWith('http') && !src.includes('sprites')) {
								images.push({ src, alt, role });
							}
						}
					}
				}

				if (html.trim() || images.length > 0) {
					turns.push({ role, html, images });
				}
			}

			const title = document.title || 'ChatGPT Conversation';
			return { ok: true, url, title, turns, turnCount: turns.length };
		}
	});

	const result = results && results[0] && results[0].result ? results[0].result : null;
	if (!result) {
		throw new Error('대화 추출 결과가 비어있습니다.');
	}
	if (!result.ok) {
		if (result.reason === 'NOT_CHATGPT') {
			throw new Error('ChatGPT 페이지가 아닙니다. chatgpt.com 탭에서 실행해주세요.');
		}
		throw new Error('대화 추출 실패');
	}
	return result;
}

function buildChatGPTMarkdownFromTurns(turns, mediaMap, mediaFolderName) {
	const blocks = [];
	for (const t of turns) {
		const text = htmlToMarkdown(t.html);
		blocks.push(`## ${t.role}\n\n${text}\n`);

		if (t.images && t.images.length > 0) {
			for (const img of t.images) {
				if (mediaMap && mediaMap[img.src]) {
					const { fileName, alt } = mediaMap[img.src];
					blocks.push(`![[${mediaFolderName}/${fileName}]]\n\n![${alt}](../98. Attachments/${mediaFolderName}/${fileName})\n\n`);
				}
			}
		}
		blocks.push('---\n');
	}

	let md = blocks.join('\n').trim();
	if (md.endsWith('---')) {
		md = md.slice(0, -3).trim();
	}
	return md;
}

async function saveChatGPTConversation() {
	const statusEl = document.getElementById('save-status');
	const btn = document.getElementById('save-chatgpt-btn');
	const titleInput = document.getElementById('clip-title');

	const setStatus = (text, color) => {
		if (!statusEl) return;
		statusEl.textContent = text;
		if (color) statusEl.style.color = color;
	};

	try {
		if (btn) btn.disabled = true;
		setStatus('ChatGPT 대화 추출 중...', '#888');

		const t0 = performance.now();
		const extracted = await extractChatGPTConversationFromActiveTab();

		const manualTitle = titleInput ? String(titleInput.value || '').trim() : '';
		const autoTitle = `${formatDateForTitle(new Date())}_ChatGPT_conversation`;
		const title = manualTitle || sanitizeFileName(extracted.title) || autoTitle;
		const mediaFolderName = sanitizeFileName(title);

		const uniqueImages = [];
		const imageSrcSet = new Set();
		for (const turn of extracted.turns) {
			if (turn.images && turn.images.length > 0) {
				for (const img of turn.images) {
					if (img.src && !imageSrcSet.has(img.src)) {
						imageSrcSet.add(img.src);
						uniqueImages.push(img);
					}
				}
			}
		}

		const mediaMap = {};
		if (uniqueImages.length > 0 && currentDirHandle) {
			setStatus(`이미지 다운로드 중... (${uniqueImages.length}개)`, '#888');
			const attachmentsDir = await getOrCreateSubfolder(currentDirHandle, '98. Attachments');
			const mediaSubDir = await getOrCreateSubfolder(attachmentsDir, mediaFolderName);

			for (let i = 0; i < uniqueImages.length; i++) {
				const img = uniqueImages[i];
				try {
					setStatus(`이미지 다운로드 중... (${i + 1}/${uniqueImages.length})`, '#888');
					const { data, contentType } = await downloadImageFromBackground(img.src);

					let fileName = sanitizeFileName(img.alt) || `image_${Date.now()}_${i}`;
					let ext = 'png';
					if (contentType.includes('jpeg') || contentType.includes('jpg')) {
						ext = 'jpg';
					} else if (contentType.includes('webp')) {
						ext = 'webp';
					} else if (contentType.includes('gif')) {
						ext = 'gif';
					}
					if (!fileName.toLowerCase().endsWith(`.${ext}`)) {
						fileName = `${fileName}.${ext}`;
					}

					const fileHandle = await mediaSubDir.getFileHandle(fileName, { create: true });
					const writable = await fileHandle.createWritable();
					await writable.write(data);
					await writable.close();

					mediaMap[img.src] = { fileName, alt: img.alt || 'image', type: 'image' };
				} catch (error) {
					console.error(`이미지 다운로드 실패 (${img.src}):`, error);
				}
			}
		}

		const md = buildChatGPTMarkdownFromTurns(extracted.turns, mediaMap, mediaFolderName);
		if (!md || !md.trim()) {
			setStatus('대화가 비어있습니다.', '#f44336');
			return;
		}

		const clip = {
			id: Date.now().toString(),
			title,
			content: md,
			folderId: '00',
			sourceUrl: extracted.url,
			summary: currentGeneratedSummary, // AI 요약 포함
			createdAt: new Date().toISOString()
		};

		const { clips = [] } = await chrome.storage.local.get('clips');
		await chrome.storage.local.set({ clips: [...clips, clip] });

		if (currentDirHandle) {
			const ok = await saveClipToFileSystem(clip);
			const t1 = performance.now();
			const ms = Math.round((t1 - t0) * 100) / 100;
			if (ok) {
				setStatus(`ChatGPT 저장 완료: ${extracted.turnCount}턴 (${ms}ms)`, '#34a853');
				renderDirectoryTree(currentDirHandle);
			} else {
				setStatus('ChatGPT 저장 실패 (콘솔 확인)', '#f44336');
			}
		} else {
			const { pendingFileSaves = [] } = await chrome.storage.local.get('pendingFileSaves');
			pendingFileSaves.push(clip);
			await chrome.storage.local.set({ pendingFileSaves });
			setStatus(`디렉토리 미연결: 큐에 저장됨 (턴 ${extracted.turnCount})`, '#ff9800');
		}

	} catch (error) {
		console.error('ChatGPT 저장 실패:', error);
		const msg = error && error.message ? error.message : String(error);
		setStatus(`ChatGPT 저장 실패: ${msg}`, '#f44336');
	} finally {
		if (btn) btn.disabled = false;
	}
}

async function extractClaudeConversationFromActiveTab() {
	const tab = await getActiveTab();
	if (!tab || typeof tab.id !== 'number') {
		throw new Error('활성 탭을 찾지 못했습니다.');
	}

	const results = await chrome.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			const url = location.href;
			let hostname = '';
			try {
				hostname = location.hostname.toLowerCase();
			} catch (error) {
				hostname = '';
			}

			if (!hostname.includes('claude.ai')) {
				return { ok: false, reason: 'NOT_CLAUDE', url };
			}

			const allMsgNodes = Array.from(document.querySelectorAll('div[data-testid="user-message"], div.font-claude-response'));
			const turns = [];

			for (const msgNode of allMsgNodes) {
				let role = 'user';
				let html = '';
				const images = [];

				if (msgNode.getAttribute('data-testid') === 'user-message') {
					role = 'user';
					html = msgNode.innerHTML || '';

					// Image extraction
					const turnContainer = msgNode.closest('div[data-test-render-count]');
					if (turnContainer) {
						const imgs = Array.from(turnContainer.querySelectorAll('img'));
						for (const img of imgs) {
							const src = img.src || img.getAttribute('src');
							const alt = img.alt || img.getAttribute('alt') || 'image';
							if (src && src.includes('/api/')) {
								let fullSrc = src;
								if (src.startsWith('/')) {
									fullSrc = location.origin + src;
								}
								images.push({ src: fullSrc, alt, role });
							}
						}
					}

				} else if (msgNode.classList.contains('font-claude-response')) {
					role = 'assistant';
					html = msgNode.innerHTML || '';
				}

				if (html.trim() || images.length > 0) {
					turns.push({ role, html, images });
				}
			}

			const title = document.title || 'Claude Conversation';
			return { ok: true, url, title, turns, turnCount: turns.length };
		}
	});

	const result = results && results[0] && results[0].result ? results[0].result : null;
	if (!result) {
		throw new Error('대화 추출 결과가 비어있습니다.');
	}
	if (!result.ok) {
		if (result.reason === 'NOT_CLAUDE') {
			throw new Error('Claude 페이지가 아닙니다. claude.ai 탭에서 실행해주세요.');
		}
		throw new Error('대화 추출 실패');
	}
	return result;
}

function buildClaudeMarkdownFromTurns(turns, mediaMap, mediaFolderName) {
	const blocks = [];
	for (const t of turns) {
		const text = htmlToMarkdown(t.html);
		blocks.push(`## ${t.role}\n\n${text}\n`);

		if (t.images && t.images.length > 0) {
			for (const img of t.images) {
				if (mediaMap && mediaMap[img.src]) {
					const { fileName, alt } = mediaMap[img.src];
					blocks.push(`![[${mediaFolderName}/${fileName}]]\n\n![${alt}](../98. Attachments/${mediaFolderName}/${fileName})\n\n`);
				}
			}
		}
		blocks.push('---\n');
	}

	let md = blocks.join('\n').trim();
	if (md.endsWith('---')) {
		md = md.slice(0, -3).trim();
	}
	return md;
}

async function saveClaudeConversation() {
	const statusEl = document.getElementById('save-status');
	const btn = document.getElementById('save-claude-btn');
	const titleInput = document.getElementById('clip-title');

	const setStatus = (text, color) => {
		if (!statusEl) return;
		statusEl.textContent = text;
		if (color) statusEl.style.color = color;
	};

	try {
		if (btn) btn.disabled = true;
		setStatus('Claude 대화 추출 중...', '#888');

		const t0 = performance.now();
		const extracted = await extractClaudeConversationFromActiveTab();

		const manualTitle = titleInput ? String(titleInput.value || '').trim() : '';
		const autoTitle = `${formatDateForTitle(new Date())}_Claude_conversation`;
		const title = manualTitle || sanitizeFileName(extracted.title) || autoTitle;
		const mediaFolderName = sanitizeFileName(title);

		const uniqueImages = [];
		const imageSrcSet = new Set();
		for (const turn of extracted.turns) {
			if (turn.images && turn.images.length > 0) {
				for (const img of turn.images) {
					if (img.src && !imageSrcSet.has(img.src)) {
						imageSrcSet.add(img.src);
						uniqueImages.push(img);
					}
				}
			}
		}

		const mediaMap = {};
		if (uniqueImages.length > 0 && currentDirHandle) {
			setStatus(`이미지 다운로드 중... (${uniqueImages.length}개)`, '#888');
			const attachmentsDir = await getOrCreateSubfolder(currentDirHandle, '98. Attachments');
			const mediaSubDir = await getOrCreateSubfolder(attachmentsDir, mediaFolderName);

			for (let i = 0; i < uniqueImages.length; i++) {
				const img = uniqueImages[i];
				try {
					setStatus(`이미지 다운로드 중... (${i + 1}/${uniqueImages.length})`, '#888');
					const { data, contentType } = await downloadImageFromBackground(img.src);

					let fileName = sanitizeFileName(img.alt) || `image_${Date.now()}_${i}`;
					let ext = 'png';
					if (contentType.includes('jpeg') || contentType.includes('jpg')) {
						ext = 'jpg';
					} else if (contentType.includes('webp')) {
						ext = 'webp';
					} else if (contentType.includes('gif')) {
						ext = 'gif';
					}
					if (!fileName.toLowerCase().endsWith(`.${ext}`)) {
						fileName = `${fileName}.${ext}`;
					}

					const fileHandle = await mediaSubDir.getFileHandle(fileName, { create: true });
					const writable = await fileHandle.createWritable();
					await writable.write(data);
					await writable.close();

					mediaMap[img.src] = { fileName, alt: img.alt || 'image', type: 'image' };
					console.log(`이미지 저장 완료: ${mediaFolderName}/${fileName}`);
				} catch (error) {
					console.error(`이미지 다운로드 실패 (${img.src}):`, error);
				}
			}
		}

		const md = buildClaudeMarkdownFromTurns(extracted.turns, mediaMap, mediaFolderName);
		if (!md || !md.trim()) {
			setStatus('대화가 비어있습니다.', '#f44336');
			return;
		}

		const clip = {
			id: Date.now().toString(),
			title,
			content: md,
			folderId: '00',
			sourceUrl: extracted.url,
			summary: currentGeneratedSummary, // AI 요약 포함
			createdAt: new Date().toISOString()
		};

		const { clips = [] } = await chrome.storage.local.get('clips');
		await chrome.storage.local.set({ clips: [...clips, clip] });

		if (currentDirHandle) {
			const ok = await saveClipToFileSystem(clip);
			const t1 = performance.now();
			const ms = Math.round((t1 - t0) * 100) / 100;
			if (ok) {
				setStatus(`Claude 저장 완료: ${extracted.turnCount}턴 (${ms}ms)`, '#34a853');
				renderDirectoryTree(currentDirHandle);
			} else {
				setStatus('Claude 저장 실패 (콘솔 확인)', '#f44336');
			}
		} else {
			const { pendingFileSaves = [] } = await chrome.storage.local.get('pendingFileSaves');
			pendingFileSaves.push(clip);
			await chrome.storage.local.set({ pendingFileSaves });
			setStatus(`디렉토리 미연결: 큐에 저장됨 (턴 ${extracted.turnCount})`, '#ff9800');
		}

	} catch (error) {
		console.error('Claude 저장 실패:', error);
		const msg = error && error.message ? error.message : String(error);
		setStatus(`Claude 저장 실패: ${msg}`, '#f44336');
	} finally {
		if (btn) btn.disabled = false;
	}
}

async function loadSelectedFolderPath() {
	try {
		const { selectedFolderPath: stored } = await chrome.storage.local.get('selectedFolderPath');
		if (Array.isArray(stored)) {
			selectedFolderPath = stored.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim());
		}
	} catch (error) {
		// ignore
	}
	updateSelectedFolderUI();
}

function updateSelectedFolderUI() {
	const el = document.getElementById('selected-folder');
	if (!el) return;
	if (!selectedFolderPath || selectedFolderPath.length === 0) {
		el.textContent = '저장 위치: /00. Inbox (기본) — 트리에서 폴더 클릭';
		return;
	}
	el.textContent = `저장 위치: /${selectedFolderPath.join('/')}`;
}

/**
 * 선택된 폴더를 트리에서 시각적으로 하이라이트
 */
function updateSelectedFolderHighlight(pathSegments) {
	// 기존 선택 해제
	document.querySelectorAll('.folder-label.folder-selected').forEach(el => {
		el.classList.remove('folder-selected');
	});

	// 새 선택 표시
	if (!pathSegments || pathSegments.length === 0) return;

	const pathStr = pathSegments.join('/');
	const targetLabel = document.querySelector(`.folder-label[data-folder-path="${pathStr}"]`);
	if (targetLabel) {
		targetLabel.classList.add('folder-selected');
	}
}

async function setSelectedFolderPath(pathSegments) {
	selectedFolderPath = Array.isArray(pathSegments) ? pathSegments : [];
	updateSelectedFolderUI();
	updateSelectedFolderHighlight(selectedFolderPath);
	try {
		await chrome.storage.local.set({ selectedFolderPath });
	} catch (error) {
		// ignore
	}
}

/**
 * 핀 관련 기능
 */

async function loadPinnedPaths() {
	try {
		const { pinnedPaths: stored } = await chrome.storage.local.get('pinnedPaths');
		if (Array.isArray(stored)) {
			// 유효성 검사
			pinnedPaths = stored.filter(p => Array.isArray(p));
		}
	} catch (error) {
		console.error('핀 목록 로드 실패:', error);
	}
	renderPinList();
}

async function savePinnedPaths() {
	try {
		await chrome.storage.local.set({ pinnedPaths });
		renderPinList();
	} catch (error) {
		console.error('핀 목록 저장 실패:', error);
	}
}

function isPinned(pathSegments) {
	const pathStr = JSON.stringify(pathSegments);
	return pinnedPaths.some(p => JSON.stringify(p) === pathStr);
}

async function togglePin(pathSegments) {
	if (isPinned(pathSegments)) {
		// Unpin
		const pathStr = JSON.stringify(pathSegments);
		pinnedPaths = pinnedPaths.filter(p => JSON.stringify(p) !== pathStr);
	} else {
		// Pin
		if (pinnedPaths.length >= MAX_PINS) {
			alert(`핀은 최대 ${MAX_PINS}개까지만 가능합니다.`);
			return;
		}
		pinnedPaths.push(pathSegments);
	}
	await savePinnedPaths();

	// 트리 UI 갱신 (핀 상태 반영을 위해)
	// 전체 트리를 다시 그리는 건 비효율적일 수 있으나, 현재 구조상 가장 확실함
	// 또는 DOM에서 해당 버튼만 찾아서 업데이트할 수도 있음.
	// 여기서는 간단히 트리를 사용중인 경우 업데이트
	if (currentDirHandle) {
		renderDirectoryTree(currentDirHandle);
	}
}

function renderPinList() {
	const pinListEl = document.getElementById('pin-list');
	const headerTextEl = document.getElementById('pin-header-text');

	if (headerTextEl) {
		headerTextEl.textContent = `핀 (${pinnedPaths.length}/${MAX_PINS})`;
	}

	if (!pinListEl) return;

	pinListEl.innerHTML = '';

	if (pinnedPaths.length === 0) {
		pinListEl.style.color = '#555';
		pinListEl.textContent = '핀된 항목이 없습니다.';
		return;
	}

	pinnedPaths.forEach(path => {
		const item = document.createElement('div');
		item.className = 'folder-item';
		item.style.justifyContent = 'space-between';

		const left = document.createElement('div');
		left.style.display = 'flex';
		left.style.alignItems = 'center';
		left.style.flex = '1';
		left.style.overflow = 'hidden';

		const icon = document.createElement('span');
		icon.className = 'icon icon-sm';
		icon.style.marginRight = '5px';
		icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

		const text = document.createElement('span');
		text.textContent = path.join('/');
		text.style.whiteSpace = 'nowrap';
		text.style.overflow = 'hidden';
		text.style.textOverflow = 'ellipsis';
		text.title = path.join('/'); // 툴팁

		left.appendChild(icon);
		left.appendChild(text);

		const delBtn = document.createElement('button');
		delBtn.textContent = '✕';
		delBtn.style.background = 'transparent';
		delBtn.style.border = 'none';
		delBtn.style.color = '#999';
		delBtn.style.cursor = 'pointer';
		delBtn.style.padding = '0 5px';
		delBtn.title = '제거';

		delBtn.onclick = (e) => {
			e.stopPropagation();
			togglePin(path);
		};

		item.onclick = () => {
			setSelectedFolderPath(path);
		};

		item.appendChild(left);
		item.appendChild(delBtn);
		pinListEl.appendChild(item);
	});
}




function sortHandles(entries) {
	// directories first, then files; name asc
	return entries.sort((a, b) => {
		const aIsDir = a.handle && a.handle.kind === 'directory';
		const bIsDir = b.handle && b.handle.kind === 'directory';
		if (aIsDir !== bIsDir) {
			return aIsDir ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

async function listDirectoryEntries(dirHandle, maxEntries) {
	const entries = [];
	let count = 0;
	try {
		for await (const [name, handle] of dirHandle.entries()) {
			entries.push({ name, handle });
			count++;
			if (typeof maxEntries === 'number' && count >= maxEntries) {
				break;
			}
		}
	} catch (error) {
		console.error('디렉토리 엔트리 로드 실패:', error);
	}
	return sortHandles(entries);
}

function createTreeFileNode(name) {
	const el = document.createElement('div');
	el.style.padding = '2px 0 2px 16px';
	el.style.display = 'flex';
	el.style.alignItems = 'center';
	el.style.gap = '4px';

	const icon = document.createElement('span');
	icon.className = 'icon icon-sm';
	icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

	const nameSpan = document.createElement('span');
	nameSpan.textContent = name;
	nameSpan.style.whiteSpace = 'nowrap';
	nameSpan.style.overflow = 'hidden';
	nameSpan.style.textOverflow = 'ellipsis';

	el.appendChild(icon);
	el.appendChild(nameSpan);
	return el;
}

function createTreeFolderNode(name, dirHandle, depth, options, parentPath) {
	const details = document.createElement('details');
	details.style.padding = '2px 0';
	details.dataset.loaded = '0';
	const pathSegments = Array.isArray(parentPath) ? parentPath.concat([name]) : [name];
	details.dataset.path = pathSegments.join('/');

	const summary = document.createElement('summary');
	summary.style.cursor = 'pointer';
	summary.style.listStyle = 'none';
	summary.style.display = 'flex'; // Flexbox for alignment
	summary.style.alignItems = 'center';

	// 폴더 아이콘과 이름 (클릭 영역)
	const labelGroup = document.createElement('div');
	labelGroup.className = 'folder-label';
	labelGroup.dataset.folderPath = pathSegments.join('/');
	labelGroup.style.display = 'flex';
	labelGroup.style.alignItems = 'center';
	labelGroup.style.flex = '1';
	labelGroup.style.overflow = 'hidden';

	const iconMap = document.createElement('span');
	iconMap.className = 'icon icon-sm';
	iconMap.style.marginRight = '4px';
	iconMap.innerHTML = '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

	const nameSpan = document.createElement('span');
	nameSpan.textContent = name;
	nameSpan.style.whiteSpace = 'nowrap';
	nameSpan.style.overflow = 'hidden';
	nameSpan.style.textOverflow = 'ellipsis';

	labelGroup.appendChild(iconMap);
	labelGroup.appendChild(nameSpan);

	// 폴더 아이콘/이름 클릭 시 저장 위치 선택 (확장은 차단)
	labelGroup.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		setSelectedFolderPath(pathSegments);
	});

	// 확장/축소용 화살표 아이콘 (Chevron)
	const chevron = document.createElement('span');
	chevron.className = 'tree-chevron';
	chevron.innerHTML = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>';

	summary.appendChild(chevron);
	summary.appendChild(labelGroup);

	// 핀 버튼 (우측)
	const pinBtn = document.createElement('span');
	const pinned = isPinned(pathSegments);
	pinBtn.className = 'icon icon-sm';
	pinBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z"/></svg>';
	pinBtn.style.cursor = 'pointer';
	pinBtn.style.marginLeft = '5px';
	pinBtn.style.opacity = pinned ? '1' : '0.4';
	pinBtn.style.color = pinned ? '#4285f4' : '#888';
	pinBtn.title = pinned ? '핀 해제' : '핀 고정';

	// Hover 효과
	pinBtn.onmouseenter = () => { if (!isPinned(pathSegments)) { pinBtn.style.opacity = '1'; pinBtn.style.color = '#4285f4'; } };
	pinBtn.onmouseleave = () => { if (!isPinned(pathSegments)) { pinBtn.style.opacity = '0.4'; pinBtn.style.color = '#888'; } };

	pinBtn.onclick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		togglePin(pathSegments);
	};

	summary.appendChild(pinBtn);

	details.appendChild(summary);

	const children = document.createElement('div');
	children.style.marginLeft = '14px';
	children.style.borderLeft = '1px solid #eee';
	children.style.paddingLeft = '8px';
	children.style.marginTop = '2px';
	details.appendChild(children);

	details.addEventListener('toggle', async () => {
		const pathKey = pathSegments.join('/');
		if (!details.open) {
			expandedPaths.delete(pathKey);
			return;
		}
		expandedPaths.add(pathKey);

		if (details.dataset.loaded === '1') {
			return;
		}
		if (depth >= options.maxDepth) {
			const hint = document.createElement('div');
			hint.style.padding = '3px 0 2px 16px';
			hint.style.color = '#888';
			hint.textContent = '… (더 깊은 폴더는 생략됨)';
			children.appendChild(hint);
			details.dataset.loaded = '1';
			return;
		}

		children.textContent = '불러오는 중...';
		const t0 = performance.now();
		const entries = await listDirectoryEntries(dirHandle, options.maxEntriesPerDir);
		children.textContent = '';

		for (const entry of entries) {
			if (!entry.handle) {
				continue;
			}
			if (entry.handle.kind === 'directory') {
				children.appendChild(createTreeFolderNode(entry.name, entry.handle, depth + 1, options, pathSegments));
			} else {
				children.appendChild(createTreeFileNode(entry.name));
			}
		}

		if (entries.length === 0) {
			const empty = document.createElement('div');
			empty.style.padding = '2px 0 2px 16px';
			empty.style.color = '#888';
			empty.textContent = '(비어있음)';
			children.appendChild(empty);
		}

		const t1 = performance.now();
		const ms = Math.round((t1 - t0) * 100) / 100;
		console.log(`폴더 로드 시간: ${name} (${ms}ms)`);
		try {
			await chrome.storage.local.set({
				lastTreeLoad: { at: new Date().toISOString(), folder: name, ms }
			});
		} catch (error) {
			// ignore
		}

		details.dataset.loaded = '1';

		// 하위 폴더가 로드된 후 선택된 폴더 하이라이트 갱신
		updateSelectedFolderHighlight(selectedFolderPath);
	});

	// 상태 복원: 이전에 열려있던 폴더면 자동으로 열기
	if (expandedPaths.has(pathSegments.join('/'))) {
		details.open = true;
	}

	return details;
}

async function renderDirectoryTree(dirHandle) {
	const tree = document.getElementById('dir-tree');
	if (!tree) {
		return;
	}

	if (!dirHandle) {
		tree.textContent = '디렉토리를 연결하면 여기에 폴더/파일이 표시됩니다.';
		return;
	}

	const options = {
		maxDepth: 4,
		maxEntriesPerDir: 200
	};

	tree.textContent = '트리 불러오는 중...';
	const t0 = performance.now();

	const rootEntries = await listDirectoryEntries(dirHandle, options.maxEntriesPerDir);
	tree.textContent = '';

	if (rootEntries.length === 0) {
		tree.textContent = '(디렉토리가 비어있음)';
		return;
	}

	for (const entry of rootEntries) {
		if (!entry.handle) {
			continue;
		}
		if (entry.handle.kind === 'directory') {
			// 루트 레벨은 기본 펼침
			const node = createTreeFolderNode(entry.name, entry.handle, 1, options, []);
			tree.appendChild(node);
		} else {
			tree.appendChild(createTreeFileNode(entry.name));
		}
	}

	const t1 = performance.now();
	const ms = Math.round((t1 - t0) * 100) / 100;
	console.log(`트리 초기 렌더 시간: ${ms}ms`);
	try {
		await chrome.storage.local.set({
			lastTreeRender: { at: new Date().toISOString(), ms }
		});
	} catch (error) {
		// ignore
	}

	// 저장된 선택 폴더 하이라이트
	updateSelectedFolderHighlight(selectedFolderPath);
}

// 페이지 로드 시 권한 확인 및 디렉토리 로드
async function initDirectory() {
	const statusDiv = document.getElementById('dir-status');
	const quickInfo = document.getElementById('storage-quick-info');

	try {
		// 권한 상태 확인 (prompt 없이)
		const { exists, permission, dirHandle } = await checkDirectoryPermission();

		if (exists && permission === 'granted') {
			// 권한이 이미 부여됨 - 바로 사용 가능
			currentDirHandle = dirHandle;
			if (statusDiv) {
				statusDiv.textContent = '연결됨';
				statusDiv.className = 'status-badge connected';
			}
			if (quickInfo) quickInfo.style.borderColor = '#e6f4ea';

			// 대기 중인 파일 저장 처리
			processPendingFileSaves();
			renderDirectoryTree(currentDirHandle);
			loadSelectedFolderPath();
		} else if (exists && permission === 'prompt') {
			// 권한이 만료됨 - 사용자 제스처 필요
			if (statusDiv) {
				statusDiv.textContent = '권한 필요';
				statusDiv.className = 'status-badge warning';
			}
			if (quickInfo) quickInfo.style.borderColor = '#fef7e0';
			renderDirectoryTree(null);
			loadSelectedFolderPath();
		} else {
			// 디렉토리가 선택되지 않음
			if (statusDiv) {
				statusDiv.textContent = '미연결';
				statusDiv.className = 'status-badge disconnected';
			}
			if (quickInfo) quickInfo.style.borderColor = '#fce8e6';
			renderDirectoryTree(null);
			loadSelectedFolderPath();
		}
	} catch (error) {
		console.error('초기화 실패:', error);
		if (statusDiv) {
			statusDiv.textContent = '오류';
			statusDiv.className = 'status-badge disconnected';
		}
		renderDirectoryTree(null);
		loadSelectedFolderPath();
	}
}

// 대기 중인 파일 저장 처리
async function processPendingFileSaves() {
	if (!currentDirHandle) {
		return;
	}

	try {
		const { pendingFileSaves = [] } = await chrome.storage.local.get('pendingFileSaves');

		if (pendingFileSaves.length === 0) {
			return;
		}

		console.log(`${pendingFileSaves.length}개의 대기 중인 파일 저장 처리 시작`);
		let anySaved = false;

		// 각 클립을 파일 시스템에 저장
		for (const clip of pendingFileSaves) {
			const ok = await saveClipToFileSystem(clip);
			if (ok) {
				anySaved = true;
			}
		}

		// 처리 완료 후 대기 목록 비우기
		await chrome.storage.local.set({ pendingFileSaves: [] });
		console.log('대기 중인 파일 저장 완료');

		// 저장이 발생했으면 트리 새로고침 (1회)
		if (anySaved) {
			renderDirectoryTree(currentDirHandle);
		}
	} catch (error) {
		console.error('대기 중인 파일 저장 처리 실패:', error);
	}
}

// 디렉토리 선택 버튼 클릭 핸들러
async function handleSelectDirectory() {
	const statusDiv = document.getElementById('dir-status');
	const quickInfo = document.getElementById('storage-quick-info');

	try {
		if (quickInfo) quickInfo.style.opacity = '0.5';
		if (statusDiv) {
			statusDiv.textContent = '처리 중...';
			statusDiv.className = 'status-badge';
		}

		// 사용자 제스처 컨텍스트에서 바로 디렉토리 선택 (await 없이)
		// 비동기 작업 후 user activation이 만료되므로 바로 호출
		currentDirHandle = await chooseAndStoreDirectory();

		if (currentDirHandle) {
			if (statusDiv) {
				statusDiv.textContent = '연결됨';
				statusDiv.className = 'status-badge connected';
			}
			if (quickInfo) quickInfo.style.borderColor = '#e6f4ea';

			// 대기 중인 파일 저장 처리
			processPendingFileSaves();
			renderDirectoryTree(currentDirHandle);
			loadSelectedFolderPath();
		}
	} catch (error) {
		console.error('Final Error Catch:', error);
		const errName = error.name || 'UnknownName';
		const errMsg = error.message || 'UnknownMessage';
		const fullMsg = `오류: ${errName} - ${errMsg}`;

		alert(fullMsg);

		if (errName === 'AbortError') {
			if (statusDiv) {
				statusDiv.textContent = '취소됨';
				statusDiv.className = 'status-badge';
			}
		} else {
			if (statusDiv) {
				statusDiv.textContent = '오류';
				statusDiv.className = 'status-badge disconnected';
			}
		}
	} finally {
		if (quickInfo) quickInfo.style.opacity = '1';
	}
}

// ============================================
// 추출 파이프라인 모달 관련 함수들
// ============================================

function openPlanModal() {
	const modal = document.getElementById('plan-modal');
	if (modal) modal.classList.add('open');
}

function closePlanModal() {
	const modal = document.getElementById('plan-modal');
	if (modal) modal.classList.remove('open');
	currentExtractionPlan = null;
}

function showPlanLoading() {
	const body = document.getElementById('plan-modal-body');
	const footer = document.getElementById('plan-modal-footer');
	if (body) {
		body.innerHTML = `
			<div class="plan-loading">
				<div class="spinner"></div>
				<div>대화를 분석하고 있습니다...</div>
			</div>
		`;
	}
	if (footer) footer.style.display = 'none';
}

function renderPlanResult(plan) {
	const body = document.getElementById('plan-modal-body');
	const footer = document.getElementById('plan-modal-footer');

	if (!body || !plan) return;

	// 태그 배지 생성
	const tagBadges = (plan.tags || [])
		.map(tag => `<span class="tag-badge">${tag}</span>`)
		.join('');

	// 문서별 렌더링
	const documents = plan.documents || [];
	const documentsHtml = documents.map((doc, idx) => {
		const sectionsHtml = doc.sections.map(section =>
			`<div class="extraction-item">${section.heading}</div>`
		).join('');

		return `
			<div class="extraction-type" data-doc-idx="${idx}">
				<label class="extraction-type-header">
					<input type="checkbox" class="doc-checkbox" checked data-doc-idx="${idx}">
					<span class="extraction-type-label">${doc.title}</span>
					<span class="extraction-type-count">${doc.sections?.length || 0}섹션</span>
				</label>
				<div class="extraction-items">
					<div style="font-size: 0.85em; color: #666; margin-bottom: 4px;">${doc.description}</div>
					${sectionsHtml}
				</div>
			</div>
		`;
	}).join('');

	body.innerHTML = `
		<div class="plan-folder-name">
			<strong>${plan.folder_name || '새 폴더'}</strong>
		</div>
		<div class="plan-summary">
			${plan.summary || ''}
			<div class="tags-preview">${tagBadges}</div>
		</div>
		${documentsHtml || '<div style="color: #888; text-align: center; padding: 20px;">추출할 문서가 없습니다.</div>'}
	`;

	if (footer) footer.style.display = 'flex';
}

function showPlanError(message) {
	const body = document.getElementById('plan-modal-body');
	const footer = document.getElementById('plan-modal-footer');
	if (body) {
		body.innerHTML = `
			<div style="text-align: center; padding: 30px; color: #d93025;">
				<div style="font-size: 2em; margin-bottom: 10px;">!</div>
				<div>${message}</div>
			</div>
		`;
	}
	if (footer) footer.style.display = 'none';
}

function getSelectedDocumentIndices() {
	const checkboxes = document.querySelectorAll('.doc-checkbox:checked');
	return Array.from(checkboxes).map(cb => parseInt(cb.dataset.docIdx, 10));
}

async function executeExtraction() {
	const statusEl = document.getElementById('save-status');
	const confirmBtn = document.getElementById('plan-confirm-btn');

	if (!currentExtractionPlan || !currentConversationContent) {
		console.error('추출 계획 또는 대화 내용이 없습니다.');
		return;
	}

	const selectedIndices = getSelectedDocumentIndices();
	if (selectedIndices.length === 0) {
		alert('최소 하나의 문서를 선택해주세요.');
		return;
	}

	try {
		if (confirmBtn) {
			confirmBtn.disabled = true;
			confirmBtn.textContent = '추출 중...';
		}

		const apiKey = await loadApiKey();
		const plan = currentExtractionPlan;
		const content = currentConversationContent;

		// 1. 폴더 생성
		if (!currentDirHandle) {
			throw new Error('저장소가 연결되지 않았습니다.');
		}

		// 선택된 폴더 경로에 새 폴더 생성
		let targetHandle = currentDirHandle;
		if (selectedFolderPath.length > 0) {
			targetHandle = await getOrCreateNestedSubfolder(currentDirHandle, selectedFolderPath);
		}

		const folderName = sanitizeFileName(plan.folder_name || `${formatDateForTitle(new Date())}_extraction`);
		const extractionFolder = await targetHandle.getDirectoryHandle(folderName, { create: true });

		// 2. _raw.md 저장 (원본 대화)
		const rawFileName = '_raw.md';
		const rawContent = createRawMarkdownContent(plan, content);
		const rawFileHandle = await extractionFolder.getFileHandle(rawFileName, { create: true });
		const rawWritable = await rawFileHandle.createWritable();
		await rawWritable.write(rawContent);
		await rawWritable.close();

		// 3. 선택된 문서별 파일 생성
		const selectedDocuments = selectedIndices.map(idx => plan.documents[idx]).filter(Boolean);

		for (const doc of selectedDocuments) {
			try {
				const { title: extractedTitle, content: extractedContent } = await writeExtraction(content, doc, apiKey);
				const fileName = `${sanitizeFileName(extractedTitle)}.md`;
				const fileHandle = await extractionFolder.getFileHandle(fileName, { create: true });
				const writable = await fileHandle.createWritable();
				await writable.write(extractedContent);
				await writable.close();
			} catch (err) {
				console.error(`${doc.title} 파일 생성 실패:`, err);
			}
		}

		// 4. 완료
		closePlanModal();
		if (statusEl) {
			statusEl.textContent = `${folderName}에 ${selectedDocuments.length + 1}개 파일 저장 완료!`;
			statusEl.style.color = '#34a853';
		}

		// 디렉토리 트리 새로고침
		renderDirectoryTree(currentDirHandle);

	} catch (error) {
		console.error('추출 실행 실패:', error);
		showPlanError(error.message);
	} finally {
		if (confirmBtn) {
			confirmBtn.disabled = false;
			confirmBtn.textContent = '추출 시작';
		}
	}
}

function createRawMarkdownContent(plan, content) {
	const now = new Date();
	const tzOffset = -now.getTimezoneOffset();
	const tzSign = tzOffset >= 0 ? '+' : '-';
	const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
	const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
	const localISOTime = now.getFullYear() + '-' +
		String(now.getMonth() + 1).padStart(2, '0') + '-' +
		String(now.getDate()).padStart(2, '0') + 'T' +
		String(now.getHours()).padStart(2, '0') + ':' +
		String(now.getMinutes()).padStart(2, '0') + ':' +
		String(now.getSeconds()).padStart(2, '0') +
		tzSign + tzHours + ':' + tzMins;

	const tagsYaml = plan.tags?.length
		? `\ntags:\n${plan.tags.map(t => `  - ${yamlQuote(t)}`).join('\n')}`
		: '\ntags: []';

	const frontmatter = `---
createdAt: ${yamlQuote(localISOTime)}
title: ${yamlQuote(plan.folder_name || 'Untitled')}
summary: ${yamlQuote(plan.summary || '')}${tagsYaml}
llm: ${yamlQuote(currentDetectedLLM)}
type: "raw"
---`;

	return `${frontmatter}\n\n# ${plan.folder_name || 'Conversation'}\n\n${content}\n`;
}

/**
 * AI 버튼 클릭 - 제목/태그 자동 생성 (내용정리 모드 OFF용) 또는 추출 파이프라인 시작 (ON용)
 */
async function handleAIGenerate() {
	// 내용정리 모드가 켜져 있으면 추출 파이프라인 시작
	const multiFileMode = document.getElementById('multi-file-mode')?.checked;
	if (multiFileMode) {
		await startExtractionPipeline();
		return;
	}

	const statusEl = document.getElementById('save-status');
	const aiGenBtn = document.getElementById('ai-gen-btn');
	const titleInput = document.getElementById('clip-title');
	const tagsInput = document.getElementById('default-tags');

	const setStatus = (text, color) => {
		if (statusEl) {
			statusEl.textContent = text;
			statusEl.style.color = color || '#888';
		}
	};

	try {
		if (aiGenBtn) aiGenBtn.disabled = true;
		setStatus('AI 분석 중...', '#888');

		// 1. 대화 내용 추출
		let content = '';
		if (currentDetectedLLM === 'ChatGPT') {
			const res = await extractChatGPTConversationFromActiveTab();
			content = buildChatGPTMarkdownFromTurns(res.turns, null, 'temp');
		} else if (currentDetectedLLM === 'Claude') {
			const res = await extractClaudeConversationFromActiveTab();
			content = buildClaudeMarkdownFromTurns(res.turns, null, 'temp');
		} else if (currentDetectedLLM === 'Gemini') {
			const res = await extractGeminiConversationFromActiveTab();
			content = buildGeminiMarkdownFromTurns(res.turns, null, 'temp');
		} else if (currentDetectedLLM === 'Grok') {
			const res = await extractGrokConversationFromActiveTab();
			content = buildGrokMarkdownFromTurns(res.turns, null, 'temp');
		} else {
			setStatus('지원되는 LLM 페이지에서 이용해 주세요', '#888');
			return;
		}

		if (!content?.trim()) {
			throw new Error('분석할 대화 내용이 없습니다.');
		}

		// 2. API Key 확인
		const apiKey = await loadApiKey();
		if (!apiKey?.trim()) {
			throw new Error('API Key가 설정되지 않았습니다.');
		}

		// 3. generateMetadata 호출
		const metadata = await generateMetadata(content, apiKey);

		// 4. 결과를 입력창에 채우기
		if (titleInput && metadata.title) {
			titleInput.value = metadata.title;
		}
		if (tagsInput && metadata.tags) {
			tagsInput.value = metadata.tags.join(', ');
		}

		setStatus('AI 생성 완료', '#4caf50');

	} catch (error) {
		console.error('AI 생성 실패:', error);
		setStatus(`AI 생성 실패: ${error.message}`, '#f44336');
	} finally {
		if (aiGenBtn) aiGenBtn.disabled = false;
	}
}

async function startExtractionPipeline() {
	const statusEl = document.getElementById('save-status');
	const aiGenBtn = document.getElementById('ai-gen-btn');

	try {
		// 1. 대화 내용 추출
		let content = '';
		if (currentDetectedLLM === 'ChatGPT') {
			const res = await extractChatGPTConversationFromActiveTab();
			content = buildChatGPTMarkdownFromTurns(res.turns, null, 'temp');
		} else if (currentDetectedLLM === 'Claude') {
			const res = await extractClaudeConversationFromActiveTab();
			content = buildClaudeMarkdownFromTurns(res.turns, null, 'temp');
		} else if (currentDetectedLLM === 'Gemini') {
			const res = await extractGeminiConversationFromActiveTab();
			content = buildGeminiMarkdownFromTurns(res.turns, null, 'temp');
		} else if (currentDetectedLLM === 'Grok') {
			const res = await extractGrokConversationFromActiveTab();
			content = buildGrokMarkdownFromTurns(res.turns, null, 'temp');
		} else {
			if (statusEl) {
				statusEl.textContent = '지원되는 LLM 페이지에서 이용해 주세요';
				statusEl.style.color = '#888';
			}
			return;
		}

		if (!content?.trim()) {
			throw new Error('분석할 대화 내용이 없습니다.');
		}

		currentConversationContent = content;

		// 2. 모달 열기 및 로딩 표시
		openPlanModal();
		showPlanLoading();

		// 3. API Key 확인
		const apiKey = await loadApiKey();
		if (!apiKey?.trim()) {
			throw new Error('API Key가 설정되지 않았습니다.');
		}

		// 4. Planning Agent 호출
		const plan = await planExtraction(content, apiKey);
		currentExtractionPlan = plan;

		// 5. 결과 렌더링
		renderPlanResult(plan);

	} catch (error) {
		console.error('추출 파이프라인 시작 실패:', error);
		showPlanError(error.message);
	}
}

// 파일 시스템에 클립 저장
async function saveClipToFileSystem(clip) {
	if (!currentDirHandle) {
		console.log('디렉토리가 선택되지 않아 파일 시스템 저장 건너뜀');
		return false;
	}

	try {

		// 기본 태그 로드 (UI 입력창에서)
		// 사용자가 AI로 생성했거나 직접 입력한 내용을 그대로 사용
		let defaultTagsRaw = '';
		const tagsInput = document.getElementById('default-tags');
		if (tagsInput) {
			defaultTagsRaw = tagsInput.value;
		}

		const tags = String(defaultTagsRaw || '')
			.split(',')
			.map(t => t.trim())
			.filter(Boolean);

		// 저장 위치 결정: 트리에서 선택한 폴더가 있으면 그쪽, 아니면 [folderId]
		let folderHandle = null;
		let folderPathLabel = '';
		if (Array.isArray(selectedFolderPath) && selectedFolderPath.length > 0) {
			folderHandle = await getOrCreateNestedSubfolder(currentDirHandle, selectedFolderPath);
			folderPathLabel = `/${selectedFolderPath.join('/')}`;
		} else {
			// 기본 저장 위치는 00. Inbox
			// (이전에 만들어진 pending 데이터가 folderId 01~99 등을 갖고 있으면 기존 규칙 유지)
			const folderName = (String(clip.folderId) === '00') ? '00. Inbox' : `${clip.folderId}.`;
			folderHandle = await getOrCreateSubfolder(currentDirHandle, folderName);
			folderPathLabel = `/${folderName}`;
		}

		// 파일명 생성: 제목 있으면 제목만, 없으면 YYYYMMDD_HHMM 형식
		const safeTitle = sanitizeFileName(clip.title);
		const hasManualTitle = safeTitle && safeTitle !== 'untitled';
		let fileName;
		if (hasManualTitle) {
			// 제목이 있으면 제목만 사용
			fileName = `${safeTitle}.md`;
		} else {
			// 제목이 없으면 날짜시간 형식
			const d = new Date();
			const pad = (n) => String(n).padStart(2, '0');
			const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
			fileName = `${timestamp}.md`;
		}

		// 메타데이터 + 본문(Markdown) 생성
		const content = createMarkdownContent(clip, tags, folderPathLabel, safeTitle);

		// 파일 저장
		const uniqueFileName = await ensureUniqueFileName(folderHandle, fileName);
		await saveFileToDirectory(folderHandle, uniqueFileName, content);
		console.log(`파일 시스템에 저장 완료: ${folderPathLabel}/${uniqueFileName}`);
		return true;
	} catch (error) {
		console.error('파일 시스템 저장 실패:', error);
		return false;
	}
}

// background script로부터 메시지 수신 (실시간 저장 요청)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'SAVE_TO_FILE_SYSTEM') {
		if (currentDirHandle) {
			saveClipToFileSystem(message.clip).then(success => {
				sendResponse({ success });
			});
			// 비동기 응답을 위해 true 반환
			return true;
		} else {
			sendResponse({ success: false, reason: 'No directory selected' });
		}
	}
});

// 이벤트 리스너 등록
document.addEventListener('DOMContentLoaded', () => {
	const storageQuickInfo = document.getElementById('storage-quick-info');
	if (storageQuickInfo) {
		storageQuickInfo.addEventListener('click', handleSelectDirectory);
	}

	// AI 자동 생성 버튼 - 제목/태그 자동 생성
	const aiGenBtn = document.getElementById('ai-gen-btn');
	if (aiGenBtn) {
		aiGenBtn.addEventListener('click', handleAIGenerate);
	}

	// 모달 버튼 이벤트
	const planModalClose = document.getElementById('plan-modal-close');
	const planCancelBtn = document.getElementById('plan-cancel-btn');
	const planConfirmBtn = document.getElementById('plan-confirm-btn');
	const planModal = document.getElementById('plan-modal');

	if (planModalClose) {
		planModalClose.addEventListener('click', closePlanModal);
	}
	if (planCancelBtn) {
		planCancelBtn.addEventListener('click', closePlanModal);
	}
	if (planConfirmBtn) {
		planConfirmBtn.addEventListener('click', executeExtraction);
	}
	// 모달 외부 클릭 시 닫기
	if (planModal) {
		planModal.addEventListener('click', (e) => {
			if (e.target === planModal) closePlanModal();
		});
	}
	const clearFolderBtn = document.getElementById('clear-folder-btn');
	if (clearFolderBtn) {
		clearFolderBtn.addEventListener('click', () => setSelectedFolderPath([]));
	}

	const saveClipboardBtn = document.getElementById('save-clipboard-btn');
	if (saveClipboardBtn) {
		saveClipboardBtn.addEventListener('click', saveClipboardMarkdown);
	}

	// 통합 대화 저장 버튼
	const saveConversationBtn = document.getElementById('save-conversation-btn');
	if (saveConversationBtn) {
		saveConversationBtn.addEventListener('click', saveConversationUnified);
	}

	// LLM 감지 새로고침 버튼
	const refreshBtn = document.getElementById('refresh-detection-btn');
	if (refreshBtn) {
		refreshBtn.addEventListener('click', detectAndUpdateLLM);
	}

	// 내용정리 모드 토글 스토리지 저장
	const multiFileModeSwitch = document.getElementById('multi-file-mode');
	if (multiFileModeSwitch) {
		chrome.storage.local.get('multiFileMode', (result) => {
			// 기본값을 false로 설정 (undefined인 경우 false)
			multiFileModeSwitch.checked = result.multiFileMode === true;
		});
		multiFileModeSwitch.addEventListener('change', (e) => {
			chrome.storage.local.set({ multiFileMode: e.target.checked });
		});
	}

	// API Key 저장 버튼
	const saveApiKeyBtn = document.getElementById('save-api-key-btn');
	if (saveApiKeyBtn) {
		saveApiKeyBtn.addEventListener('click', async () => {
			const inputEl = document.getElementById('openai-api-key');
			const statusEl = document.getElementById('api-key-status');
			if (!inputEl) return;

			const key = inputEl.value.trim();
			if (!key) {
				alert('API Key를 입력해주세요.');
				return;
			}

			const ok = await saveApiKey(key);
			if (ok) {
				await updateApiKeyStatus();
				alert('API Key가 저장되었습니다.');
			} else {
				alert('API Key 저장에 실패했습니다.');
			}
		});
	}

	loadSelectedFolderPath();
	loadPinnedPaths(); // 핀 목록 로드
	updateApiKeyStatus(); // API Key 상태 초기화

	// 설정 패널 토글 버튼
	const settingsToggleBtn = document.getElementById('settings-toggle-btn');
	const settingsPanel = document.getElementById('settings-panel');
	if (settingsToggleBtn && settingsPanel) {
		settingsToggleBtn.addEventListener('click', () => {
			const isOpen = settingsPanel.classList.toggle('open');
			settingsToggleBtn.classList.toggle('active', isOpen);
		});
	}

	// 초기화
	initDirectory();

	// LLM 감지 초기 실행
	detectAndUpdateLLM();

	// 탭 변경 시 LLM 재감지
	chrome.tabs.onActivated.addListener(detectAndUpdateLLM);
	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		if (changeInfo.url) {
			detectAndUpdateLLM();
		}
	});
});

// 현재 디렉토리 핸들 반환 (다른 모듈에서 사용)
export function getCurrentDirHandle() {
	return currentDirHandle;
}

function createMarkdownContent(clip, tags, folderPathLabel, safeTitle) {
	const llm = detectLLMFromUrl(clip.sourceUrl);
	// 로컬 시간 형식으로 변환 (예: 2025-12-23T01:13:31+09:00)
	const now = new Date();
	const tzOffset = -now.getTimezoneOffset();
	const tzSign = tzOffset >= 0 ? '+' : '-';
	const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
	const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
	const localISOTime = now.getFullYear() + '-' +
		String(now.getMonth() + 1).padStart(2, '0') + '-' +
		String(now.getDate()).padStart(2, '0') + 'T' +
		String(now.getHours()).padStart(2, '0') + ':' +
		String(now.getMinutes()).padStart(2, '0') + ':' +
		String(now.getSeconds()).padStart(2, '0') +
		tzSign + tzHours + ':' + tzMins;
	const savedAt = localISOTime;
	const title = String(clip.title || '').trim() || safeTitle;
	const body = String(clip.content || '');
	const yamlTags = tags.length ? `\ntags:\n${formatTags(tags)}` : '\ntags: []';
	const yamlSummary = clip.summary ? `\nsummary: ${yamlQuote(clip.summary)}` : '';
	// YAML frontmatter 생성
	const yamlFrontmatter = `---\nsavedAt: ${yamlQuote(savedAt)}\ncreatedAt: ${yamlQuote(clip.createdAt)}\nsourceUrl: ${yamlQuote(clip.sourceUrl)}\nllm: ${yamlQuote(llm)}\nfolder: ${yamlQuote(folderPathLabel)}\nfolderId: ${yamlQuote(clip.folderId)}\ntitle: ${yamlQuote(title)}${yamlTags}${yamlSummary}\n---`;

	// 파일 내용 조합 (YAML을 맨 위로)
	return `${yamlFrontmatter}\n\n# ${title}\n\n${body}\n`;
}

