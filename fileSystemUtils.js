// fileSystemUtils.js
// File System Access API를 사용한 디렉토리 핸들 관리

// IndexedDB 열기 (네이티브 API 사용)
async function getDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('llmArchiveDB', 1);

		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);

		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			if (!db.objectStoreNames.contains('fileHandles')) {
				db.createObjectStore('fileHandles');
			}
		};
	});
}

// 디렉토리 선택 및 저장
async function chooseAndStoreDirectory() {
	try {
		if (typeof window.showDirectoryPicker !== 'function') {
			throw new Error('이 브라우저는 Directory System API를 지원하지 않습니다.');
		}
		// 사용자 제스처로 디렉토리 선택 (readwrite 권한 함께 요청)
		const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

		// 권한 확인 (이미 위에서 readwrite로 요청했으므로 granted일 가능성 높음)
		// 일부 브라우저에서는 명시적 확인이 필요할 수 있음
		const permission = await dirHandle.queryPermission({ mode: 'readwrite' });

		if (permission !== 'granted') {
			// 혹시라도 권한이 없다면 요청 (이 시점에서 user activation이 만료되었을 수 있으므로 주의)
			const requestResult = await dirHandle.requestPermission({ mode: 'readwrite' });
			if (requestResult !== 'granted') {
				throw new Error('Permission denied');
			}
		}

		// IndexedDB에 핸들 저장
		const db = await getDB();
		const transaction = db.transaction('fileHandles', 'readwrite');
		await transaction.objectStore('fileHandles').put(dirHandle, 'archiveDir');

		return dirHandle;
	} catch (error) {
		console.error('디렉토리 선택 에러 상세:', {
			name: error.name,
			message: error.message,
			code: error.code,
			raw: error
		});
		console.error(`[Error String]: ${String(error)} name=${error.name} msg=${error.message}`);
		throw error;
	}
}

// 재시작 후 불러와 확인 (UI 렌더링 전에 호출)
async function loadAndVerifyDirectory() {
	try {
		const db = await getDB();
		const transaction = db.transaction('fileHandles', 'readonly');
		const dirHandle = await new Promise((resolve, reject) => {
			const request = transaction.objectStore('fileHandles').get('archiveDir');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		if (!dirHandle) {
			return null;
		}

		// 권한 상태 확인
		const permission = await dirHandle.queryPermission({ mode: 'readwrite' });

		if (permission === 'prompt') {
			// 사용자 제스처 필요 (e.g., 버튼 클릭 후)
			// 이 함수는 사용자 제스처 컨텍스트에서 호출되어야 함
			const status = await dirHandle.requestPermission({ mode: 'readwrite' });
			if (status !== 'granted') {
				console.error('Permission denied');
				return null;
			}
		} else if (permission === 'denied') {
			console.error('Permission denied');
			return null;
		}

		// 권한 OK면 디렉토리 핸들 반환
		return dirHandle;
	} catch (error) {
		console.error('디렉토리 로드 실패:', error);
		return null;
	}
}

// 권한만 확인 (prompt 없이)
async function checkDirectoryPermission() {
	try {
		const db = await getDB();
		const transaction = db.transaction('fileHandles', 'readonly');
		const dirHandle = await new Promise((resolve, reject) => {
			const request = transaction.objectStore('fileHandles').get('archiveDir');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		if (!dirHandle) {
			return { exists: false, permission: null };
		}

		const permission = await dirHandle.queryPermission({ mode: 'readwrite' });
		return { exists: true, permission, dirHandle };
	} catch (error) {
		console.error('권한 확인 실패:', error);
		return { exists: false, permission: null };
	}
}

// 파일 저장 (디렉토리 핸들 사용)
async function saveFileToDirectory(dirHandle, fileName, content) {
	try {
		const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
		const writable = await fileHandle.createWritable();
		await writable.write(content);
		await writable.close();
		return true;
	} catch (error) {
		console.error('파일 저장 실패:', error);
		throw error;
	}
}

// 폴더 내에 하위 폴더 생성 또는 가져오기
async function getOrCreateSubfolder(dirHandle, folderName) {
	try {
		return await dirHandle.getDirectoryHandle(folderName, { create: true });
	} catch (error) {
		console.error('하위 폴더 생성 실패:', error);
		throw error;
	}
}

// 중첩 폴더 생성 또는 가져오기 (예: ["Projects","LLM"])
async function getOrCreateNestedSubfolder(rootDirHandle, pathSegments) {
	try {
		let current = rootDirHandle;
		for (const segment of pathSegments) {
			if (!segment || typeof segment !== 'string') {
				continue;
			}
			const name = segment.trim();
			if (!name) {
				continue;
			}
			current = await current.getDirectoryHandle(name, { create: true });
		}
		return current;
	} catch (error) {
		console.error('중첩 폴더 생성 실패:', error);
		throw error;
	}
}

// 파일명 중복 방지 (같은 이름이 있으면 (1), (2) 붙임)
async function ensureUniqueFileName(dirHandle, fileName) {
	try {
		// 확장자 분리
		const dotIndex = fileName.lastIndexOf('.');
		let name = fileName;
		let ext = '';
		if (dotIndex !== -1) {
			name = fileName.substring(0, dotIndex);
			ext = fileName.substring(dotIndex);
		}

		let finalName = fileName;
		let counter = 1;

		while (true) {
			try {
				// 파일이 존재하는지 확인 (없으면 에러 발생하므로 catch로 이동)
				await dirHandle.getFileHandle(finalName);
				// 파일이 존재함 -> 이름 변경 후 재시도
				finalName = `${name} (${counter})${ext}`;
				counter++;
			} catch (error) {
				if (error.name === 'NotFoundError') {
					// 파일이 없음 -> 사용 가능
					return finalName;
				}
				throw error; // 다른 에러는 throw
			}
		}
	} catch (error) {
		console.error('파일명 중복 확인 실패:', error);
		// 실패 시 원래 이름 반환 (덮어쓰기 위험 감수)
		return fileName;
	}
}

export {
	chooseAndStoreDirectory,
	loadAndVerifyDirectory,
	checkDirectoryPermission,
	saveFileToDirectory,
	getOrCreateSubfolder,
	getOrCreateNestedSubfolder,
	ensureUniqueFileName
};

