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
		// 사용자 제스처로 디렉토리 선택
		const dirHandle = await window.showDirectoryPicker();

		// 권한 요청 (처음에 3-way prompt 나타남)
		const permission = await dirHandle.requestPermission({ mode: 'readwrite' });

		if (permission !== 'granted') {
			throw new Error('Permission denied');
		}

		// IndexedDB에 핸들 저장
		const db = await getDB();
		const transaction = db.transaction('fileHandles', 'readwrite');
		await transaction.objectStore('fileHandles').put(dirHandle, 'archiveDir');

		return dirHandle;
	} catch (error) {
		console.error('디렉토리 선택 실패:', error);
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

export {
	chooseAndStoreDirectory,
	loadAndVerifyDirectory,
	checkDirectoryPermission,
	saveFileToDirectory,
	getOrCreateSubfolder,
	getOrCreateNestedSubfolder
};

