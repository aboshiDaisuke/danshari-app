/**
 * Danshari App Logic
 * Google Drive integrated app with multi-user support
 */

const DB_NAME = 'DanshariDB';
const STORE_NAME = 'items';
const DB_VERSION = 1;

// --- Google OAuth & Drive API ---
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let CLIENT_ID = localStorage.getItem('gdrive_client_id') || '';
let tokenClient;
let gapiInited = false;
let gisInited = false;
let accessToken = null;
let currentGoogleUser = null;

// App folder in Google Drive
let APP_FOLDER_ID = null;
const APP_FOLDER_NAME = 'Danshari_App';

// --- Google API Initialization ---
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({
        discoveryDocs: [DISCOVERY_DOC],
    });
    gapiInited = true;
    maybeEnableButtons();
}

function gisLoaded() {
    if (!CLIENT_ID) {
        console.log('No CLIENT_ID configured');
        updateUI();
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
            if (resp.error !== undefined) {
                throw (resp);
            }
            accessToken = gapi.client.getToken().access_token;
            await handleAuthSuccess();
        },
    });
    gisInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        updateUI();
    }
}

async function handleAuthSuccess() {
    // Get user info
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        currentGoogleUser = await response.json();

        // Find or create app folder
        await ensureAppFolder();

        // Load items from Google Drive
        await loadItemsFromDrive();

        updateUI();
        renderList();
    } catch (err) {
        console.error('Auth success handler error:', err);
    }
}

async function handleSignIn() {
    if (!gapi.client.getToken()) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

function handleSignOut() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
    }
    currentGoogleUser = null;
    accessToken = null;
    APP_FOLDER_ID = null;
    updateUI();
    renderList();
}

// --- Google Drive Operations ---

// Ensure app folder exists
async function ensureAppFolder() {
    try {
        // Search for existing folder
        const response = await gapi.client.drive.files.list({
            q: `name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        if (response.result.files && response.result.files.length > 0) {
            APP_FOLDER_ID = response.result.files[0].id;
        } else {
            // Create folder
            const folderMetadata = {
                name: APP_FOLDER_NAME,
                mimeType: 'application/vnd.google-apps.folder'
            };
            const folder = await gapi.client.drive.files.create({
                resource: folderMetadata,
                fields: 'id'
            });
            APP_FOLDER_ID = folder.result.id;
        }
        console.log('App folder ID:', APP_FOLDER_ID);
    } catch (err) {
        console.error('Error ensuring app folder:', err);
    }
}

// Upload file to Google Drive
async function uploadToDrive(item) {
    if (!accessToken || !APP_FOLDER_ID) {
        console.log('Not authenticated or no folder');
        return null;
    }

    try {
        // Convert base64 to blob
        const base64Data = item.image.split(',')[1];
        const mimeType = item.image.split(',')[0].split(':')[1].split(';')[0];
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mimeType });

        // Create filename
        const d = new Date(item.date);
        const dateStr = d.getFullYear() +
            ('0' + (d.getMonth() + 1)).slice(-2) +
            ('0' + d.getDate()).slice(-2) + '_' +
            ('0' + d.getHours()).slice(-2) +
            ('0' + d.getMinutes()).slice(-2) +
            ('0' + d.getSeconds()).slice(-2);
        const cleanReason = (item.reason || 'item').replace(/[\/\\:*?"<>|]/g, '_');
        const filename = `${currentGoogleUser.email}_${dateStr}_${cleanReason}.jpg`;

        // Upload using multipart
        const metadata = {
            name: filename,
            mimeType: mimeType,
            parents: [APP_FOLDER_ID]
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob);

        const response = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                body: form
            }
        );

        if (!response.ok) {
            throw new Error('Upload failed');
        }

        const fileData = await response.json();
        console.log('Uploaded to Drive:', fileData.id);
        return fileData.id;
    } catch (err) {
        console.error('Error uploading to Drive:', err);
        return null;
    }
}

// Load items metadata from Google Drive (we store metadata in file description)
async function loadItemsFromDrive() {
    if (!accessToken || !APP_FOLDER_ID) return;

    try {
        const response = await gapi.client.drive.files.list({
            q: `'${APP_FOLDER_ID}' in parents and trashed=false`,
            fields: 'files(id, name, description, webViewLink, thumbnailLink)',
            orderBy: 'createdTime desc',
            pageSize: 100
        });

        // For now, just log. We'll implement full sync later
        console.log('Files in Drive:', response.result.files);
    } catch (err) {
        console.error('Error loading from Drive:', err);
    }
}

// Delete file from Google Drive
async function deleteFromDrive(driveFileId) {
    if (!accessToken || !driveFileId) return;

    try {
        await gapi.client.drive.files.delete({
            fileId: driveFileId
        });
        console.log('Deleted from Drive:', driveFileId);
    } catch (err) {
        console.error('Error deleting from Drive:', err);
    }
}



// --- IndexedDB Helper (Fallback) ---
const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            store.createIndex('date', 'date', { unique: false });
        }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
});

// --- Data Access Layer (Hybrid) ---

async function saveItem(item) {
    // Determine ID early if not present, useful for filenames
    if (!item.id) {
        item.id = 'loc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Set owner to current Google user if logged in
    if (currentGoogleUser) {
        item.owner = currentGoogleUser.email;
    }

    // 1. Upload to Google Drive (if authenticated)
    if (accessToken && APP_FOLDER_ID && item.image.startsWith('data:')) {
        const driveFileId = await uploadToDrive(item);
        if (driveFileId) {
            item.driveFileId = driveFileId;
            item.syncedToDrive = true;
        }
    }

    // 2. Save to Local File (if enabled)
    if (rootDirectoryHandle) {
        const savedFilename = await saveToLocalFile(item);
        if (savedFilename) item.filename = savedFilename;
    }

    // 3. Save to IndexedDB
    return saveItemToIndexedDB(item);
}

async function saveItemToIndexedDB(item) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(item); // use put to allow custom IDs or updates
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}


async function getAllItems() {
    // Get from IndexedDB
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            const items = request.result;
            items.sort((a, b) => new Date(b.date) - new Date(a.date));
            resolve(items);
        };
        request.onerror = () => reject(request.error);
    });
}

async function updateItem(item) {
    return saveItem(item); // Re-use save logic which handles updates
}

async function deleteItem(id, item) {
    // Delete from Google Drive if synced
    if (item.driveFileId) {
        await deleteFromDrive(item.driveFileId);
    }

    // Delete from IndexedDB
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteItemsByUser(username) {
    const db = await dbPromise;

    // Collect items to delete
    const itemsToDelete = [];
    const getAllRequest = await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    for (const item of getAllRequest) {
        if (item.owner === username) {
            itemsToDelete.push(item);
        }
    }

    // Delete from Google Drive
    for (const item of itemsToDelete) {
        if (item.driveFileId) {
            await deleteFromDrive(item.driveFileId);
        }
    }

    // Delete from IndexedDB
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        let deletedCount = 0;
        const request = store.openCursor();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                if (cursor.value.owner === username) {
                    cursor.delete();
                    deletedCount++;
                }
                cursor.continue();
            } else {
                resolve(deletedCount);
            }
        };
        request.onerror = () => reject(request.error);
    });
}


// --- UI Logic ---

// Elements
const viewList = document.getElementById('view-list');
const viewAdd = document.getElementById('view-add');
const fabAdd = document.getElementById('fab-add');
const cancelAddBtn = document.getElementById('cancel-add');
const addForm = document.getElementById('add-form');
const cameraInput = document.getElementById('camera-input');
const previewImg = document.getElementById('preview-img');
const placeholder = document.querySelector('.placeholder');
const imagePreviewArea = document.getElementById('image-upload-trigger'); // DnD target
const itemGrid = document.getElementById('item-grid');
const emptyState = document.getElementById('empty-state');
const statsEl = document.getElementById('stats');
const submitBtn = addForm.querySelector('button[type="submit"]');

// Old user UI elements removed (now using Google login)

// Settings UI
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsModalClose = document.getElementById('settings-modal-close');
const resetUserDataBtn = document.getElementById('reset-user-data-btn');
const settingsUserNameLabel = document.getElementById('settings-user-name');
const exportDataBtn = document.getElementById('export-data-btn');
const exportProgress = document.getElementById('export-progress');
const setupFolderBtn = document.getElementById('setup-folder-btn');
const folderStatus = document.getElementById('folder-status');

const modalWrapper = document.getElementById('modal-wrapper');

// File System Handle (Ephemeral)
let rootDirectoryHandle = null;

// File System Logic
setupFolderBtn.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
        alert('お使いのブラウザはこの機能に対応していません。\nGoogle Chrome または Edge をご利用ください。');
        return;
    }
    try {
        rootDirectoryHandle = await window.showDirectoryPicker();
        folderStatus.style.display = 'block';
        alert('保存先フォルダを設定しました。\n今後撮影する写真は、このフォルダ内のユーザー名フォルダに自動保存されます。');
    } catch (err) {
        console.error(err);
        if (err.name === 'AbortError') {
            alert('フォルダ選択がキャンセルされました。');
        } else {
            alert('エラーが発生しました:\n' + err.name + ': ' + err.message + '\n\n※Safariなどは非対応です。Chromeをご利用ください。');
        }
    }
});

async function saveToLocalFile(itemData) {
    if (!rootDirectoryHandle) return;

    try {
        const ownerName = itemData.owner || 'ゲスト';
        // Get or create user directory
        const userDirHandle = await rootDirectoryHandle.getDirectoryHandle(ownerName, { create: true });

        // Create filename
        const d = new Date(itemData.date);
        const dateStr = d.getFullYear() +
            ('0' + (d.getMonth() + 1)).slice(-2) +
            ('0' + d.getDate()).slice(-2) + '_' +
            ('0' + d.getHours()).slice(-2) +
            ('0' + d.getMinutes()).slice(-2) +
            ('0' + d.getSeconds()).slice(-2);

        const cleanReason = (itemData.reason || 'item').replace(/[\/\\:*?"<>|]/g, '_');
        const filename = `${dateStr}_${cleanReason}.jpg`;

        // Write file
        const fileHandle = await userDirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();

        // Convert base64 to blob
        const byteString = atob(itemData.image.split(',')[1]);
        const mimeString = itemData.image.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: mimeString });

        await writable.write(blob);
        await writable.close();

        console.log('Saved to local file:', filename);
        return filename;
    } catch (err) {
        console.error('Error saving to local file:', err);
        return null;
    }
}

async function deleteFromLocalFile(item) {
    if (!rootDirectoryHandle || !item.filename) return;

    try {
        const ownerName = item.owner || 'ゲスト';
        const userDirHandle = await rootDirectoryHandle.getDirectoryHandle(ownerName, { create: false });

        // Delete original
        await userDirHandle.removeEntry(item.filename).catch(e => console.warn(e));
        console.log('Deleted local file:', item.filename);

    } catch (err) {
        console.warn('Could not delete local file:', err);
    }
}

const modalClose = document.getElementById('modal-close');
const modalContentArea = document.getElementById('modal-detail-content');

// State
let currentImageData = null;
let editingItem = null; // Track full item object if editing

// Navigation
function showList() {
    viewAdd.classList.remove('active');
    viewList.style.display = '';
    viewList.classList.add('active');
    fabAdd.style.display = 'flex';
    renderList();
    editingItem = null;
}

// Old user management code removed (now using Google accounts)


// Settings Logic
settingsBtn.addEventListener('click', () => {
    if (settingsUserNameLabel && currentGoogleUser) {
        settingsUserNameLabel.textContent = currentGoogleUser.email;
    }
    settingsModal.classList.remove('hidden');
});

settingsModalClose.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

exportDataBtn.addEventListener('click', async () => {
    if (!window.JSZip) {
        alert('エラー: JSZipライブラリがロードされていません。インターネット接続を確認してリロードしてください。');
        return;
    }

    try {
        exportDataBtn.disabled = true;
        exportProgress.style.display = 'block';
        exportProgress.textContent = 'データを準備中...';

        const zip = new JSZip();
        const items = await getAllItems(); // Will get from Cloud if connected

        if (items.length === 0) {
            alert('保存する写真がありません。');
            exportDataBtn.disabled = false;
            exportProgress.style.display = 'none';
            return;
        }

        // Process items
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const ownerFolder = item.owner || 'ゲスト';

            const d = new Date(item.date);
            const dateStr = d.getFullYear() +
                ('0' + (d.getMonth() + 1)).slice(-2) +
                ('0' + d.getDate()).slice(-2) + '_' +
                ('0' + d.getHours()).slice(-2) +
                ('0' + d.getMinutes()).slice(-2) +
                ('0' + d.getSeconds()).slice(-2);

            const cleanReason = (item.reason || 'item').replace(/[\/\\:*?"<>|]/g, '_');
            const filename = `${dateStr}_${cleanReason}.jpg`;

            // If Firebase, we might have URL, not Base64.
            // Converting URL to Base64 for Zip is tricky due to CORS.
            // Currently getAllItems returns URL in 'image' prop if Firebase.
            let imgData = null;
            if (item.image.startsWith('data:')) {
                imgData = item.image.split(',')[1];
            } else if (item.image.startsWith('http')) {
                // Fetch blob from URL (CORS might fail depending on Config)
                try {
                    const resp = await fetch(item.image);
                    const blob = await resp.blob();
                    imgData = await new Promise(r => {
                        const reader = new FileReader();
                        reader.onload = () => r(reader.result.split(',')[1]);
                        reader.readAsDataURL(blob);
                    });
                } catch (e) {
                    console.warn("Skipping export for cloud image due to CORS/Network", item.image);
                    continue; // Skip this one
                }
            }

            if (imgData) {
                zip.folder(ownerFolder).file(filename, imgData, { base64: true });
            }
        }

        exportProgress.textContent = 'ZIPファイルを作成中...';
        const content = await zip.generateAsync({ type: "blob" });

        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `断捨離バックアップ_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        exportProgress.textContent = 'ダウンロードを開始しました。';
        setTimeout(() => {
            exportProgress.style.display = 'none';
            exportDataBtn.disabled = false;
        }, 3000);

    } catch (err) {
        console.error(err);
        alert('エクスポートに失敗しました。(CORS制限などでクラウド上の画像を取得できない場合があります)');
        exportDataBtn.disabled = false;
        exportProgress.style.display = 'none';
    }
});

resetUserDataBtn.addEventListener('click', async () => {
    if (!currentGoogleUser) {
        alert('ログインしてください。');
        return;
    }
    if (confirm(`本当に ${currentGoogleUser.email} のデータを削除しますか？`)) {
        await deleteItemsByUser(currentGoogleUser.email);
        alert('削除しました。');
        settingsModal.classList.add('hidden');
        renderList();
    }
});


function showAdd(itemToEdit = null) {
    viewList.classList.remove('active');
    viewList.style.display = 'none';
    setTimeout(() => viewList.style.display = '', 0);
    viewAdd.classList.add('active');
    fabAdd.style.display = 'none';

    if (itemToEdit) {
        editingItem = itemToEdit;
        document.getElementById('reason').value = itemToEdit.reason;
        document.getElementById('comment').value = itemToEdit.comment;
        currentImageData = itemToEdit.image;
        previewImg.src = currentImageData;
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
        submitBtn.textContent = '更新する';
    } else {
        resetForm();
    }
}

fabAdd.addEventListener('click', () => showAdd(null));
cancelAddBtn.addEventListener('click', () => {
    resetForm();
    showList();
});

// Image Logic
function handleImageFile(file) {
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentImageData = event.target.result;
            previewImg.src = currentImageData;
            previewImg.style.display = 'block';
            placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }
}

cameraInput.addEventListener('change', (e) => {
    handleImageFile(e.target.files[0]);
});

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    imagePreviewArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

imagePreviewArea.addEventListener('drop', (e) => {
    handleImageFile(e.dataTransfer.files[0]);
}, false);


// Submit
addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentImageData) {
        alert('恐れ入りますが、写真を選択してください。');
        return;
    }

    const reason = document.getElementById('reason').value;
    const comment = document.getElementById('comment').value;

    let date = new Date().toISOString();
    let docId = null;

    if (editingItem) {
        date = editingItem.date;
        docId = editingItem.docId || null; // Firestore Doc ID
    }

    // Prepare Base Item
    const itemData = {
        id: editingItem ? editingItem.id : undefined,
        docId: docId,
        image: currentImageData,
        reason,
        comment,
        date,
        owner: currentUser
    };

    // Show Loading
    submitBtn.disabled = true;
    submitBtn.textContent = '保存中...';

    try {
        await saveItem(itemData);
        showList();
    } catch (err) {
        console.error('Error saving item:', err);
        alert('保存に失敗しました。');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingItem ? '更新する' : '手放す';
    }
});

function resetForm() {
    addForm.reset();
    currentImageData = null;
    editingItem = null;
    previewImg.src = '';
    previewImg.style.display = 'none';
    placeholder.style.display = 'block';
    submitBtn.textContent = '手放す';
}

async function renderList() {
    itemGrid.innerHTML = '';

    const allItems = await getAllItems();

    // Filter by current Google user if logged in
    let items = allItems;
    if (currentGoogleUser) {
        items = allItems.filter(item => item.owner === currentGoogleUser.email);
    }

    statsEl.textContent = `${items.length} items`;

    if (items.length === 0) {
        emptyState.style.display = 'flex';
    } else {
        emptyState.style.display = 'none';
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card';

        const dateStr = new Date(item.date).toLocaleDateString('ja-JP', {
            year: 'numeric', month: 'short', day: 'numeric'
        });

        // Show sync status
        const syncBadge = item.syncedToDrive ? '<span style="position:absolute;top:8px;right:8px;background:#16a34a;color:white;font-size:10px;padding:2px 6px;border-radius:4px;">☁️</span>' : '';

        card.innerHTML = `
            <img src="${item.image}" class="item-img-thumb" loading="lazy" alt="Item">
            ${syncBadge}
            <div class="item-info">
                <span class="item-date">${dateStr}</span>
                <div class="item-reason">${item.reason}</div>
            </div>
        `;

        card.addEventListener('click', () => showDetail(item));
        itemGrid.appendChild(card);
    });
}

function showDetail(item) {
    const dateStr = new Date(item.date).toLocaleString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    modalContentArea.innerHTML = `
        <img src="${item.image}" class="modal-img" alt="Detail">
        <div class="modal-info">
            <h2>${item.reason}</h2>
            <div class="meta">
                <span>📅 ${dateStr}</span>
                ${item.owner ? `<span style="margin-left:12px;">👤 ${item.owner}</span>` : ''}
            </div>
            <p>${item.comment ? item.comment.replace(/\n/g, '<br>') : 'コメントなし'}</p>
            
            <div class="modal-actions" style="margin-top: 24px; display: flex; gap: 12px;">
                <button id="btn-edit" class="btn-secondary">編集</button>
                <button id="btn-delete" class="btn-danger">削除</button>
            </div>
        </div>
    `;

    setTimeout(() => {
        const btnEdit = document.getElementById('btn-edit');
        const btnDelete = document.getElementById('btn-delete');

        if (btnEdit) {
            btnEdit.onclick = () => {
                modalWrapper.classList.add('hidden');
                showAdd(item);
            };
        }

        if (btnDelete) {
            btnDelete.onclick = async () => {
                if (confirm('この記録を削除しますか？\n（写真は元のアルバムからは削除されません）')) {
                    if (item.filename) await deleteFromLocalFile(item);
                    await deleteItem(item.id, item); // Pass item object for Firestore Doc ID
                    modalWrapper.classList.add('hidden');
                    renderList();
                }
            };
        }
    }, 0);

    modalWrapper.classList.remove('hidden');
}

modalWrapper.addEventListener('click', (e) => {
    if (e.target === modalWrapper) modalWrapper.classList.add('hidden');
});

// --- UI Update Functions ---
function updateUI() {
    const googleSigninBtn = document.getElementById('google-signin-btn');
    const userInfoBtn = document.getElementById('user-info-btn');
    const userAvatar = document.getElementById('user-avatar');
    const userDisplayName = document.getElementById('user-display-name');

    const gdriveNotSetup = document.getElementById('gdrive-not-setup');
    const gdriveSetupDone = document.getElementById('gdrive-setup-done');
    const clientIdInput = document.getElementById('client-id-input');

    if (!CLIENT_ID) {
        // No client ID configured
        if (googleSigninBtn) googleSigninBtn.style.display = 'none';
        if (userInfoBtn) userInfoBtn.style.display = 'none';
        if (gdriveNotSetup) gdriveNotSetup.style.display = 'block';
        if (gdriveSetupDone) gdriveSetupDone.style.display = 'none';
        if (clientIdInput) clientIdInput.value = '';
        return;
    }

    if (currentGoogleUser) {
        // Logged in
        if (googleSigninBtn) googleSigninBtn.style.display = 'none';
        if (userInfoBtn) userInfoBtn.style.display = 'flex';
        if (userAvatar) userAvatar.src = currentGoogleUser.picture || '';
        if (userDisplayName) userDisplayName.textContent = currentGoogleUser.name || currentGoogleUser.email;
        if (gdriveNotSetup) gdriveNotSetup.style.display = 'none';
        if (gdriveSetupDone) gdriveSetupDone.style.display = 'block';

        // Also update menu modal
        const menuUserAvatar = document.getElementById('menu-user-avatar');
        const menuUserName = document.getElementById('menu-user-name');
        const menuUserEmail = document.getElementById('menu-user-email');
        if (menuUserAvatar) menuUserAvatar.src = currentGoogleUser.picture || '';
        if (menuUserName) menuUserName.textContent = currentGoogleUser.name || 'User';
        if (menuUserEmail) menuUserEmail.textContent = currentGoogleUser.email || '';
    } else {
        // Not logged in
        if (googleSigninBtn) googleSigninBtn.style.display = 'flex';
        if (userInfoBtn) userInfoBtn.style.display = 'none';
        if (gdriveNotSetup) gdriveNotSetup.style.display = 'block';
        if (gdriveSetupDone) gdriveSetupDone.style.display = 'none';
        if (clientIdInput) clientIdInput.value = CLIENT_ID;
    }
}

// --- Event Listeners ---

// Google sign-in button
const googleSigninBtn = document.getElementById('google-signin-btn');
if (googleSigninBtn) {
    googleSigninBtn.addEventListener('click', handleSignIn);
}

// User info button (shows menu)
const userInfoBtn = document.getElementById('user-info-btn');
const userMenuModal = document.getElementById('user-menu-modal');
if (userInfoBtn) {
    userInfoBtn.addEventListener('click', () => {
        if (userMenuModal) userMenuModal.classList.remove('hidden');
    });
}

// Close user menu modal
if (userMenuModal) {
    userMenuModal.addEventListener('click', (e) => {
        if (e.target === userMenuModal) userMenuModal.classList.add('hidden');
    });
}

// Logout button
const menuLogoutBtn = document.getElementById('menu-logout-btn');
if (menuLogoutBtn) {
    menuLogoutBtn.addEventListener('click', () => {
        handleSignOut();
        if (userMenuModal) userMenuModal.classList.add('hidden');
    });
}

// Save client ID button
const saveClientIdBtn = document.getElementById('save-client-id-btn');
const clientIdInput = document.getElementById('client-id-input');
if (saveClientIdBtn && clientIdInput) {
    saveClientIdBtn.addEventListener('click', () => {
        const clientId = clientIdInput.value.trim();
        if (!clientId) {
            alert('クライアントIDを入力してください');
            return;
        }
        CLIENT_ID = clientId;
        localStorage.setItem('gdrive_client_id', clientId);
        alert('設定を保存しました。ページをリロードします。');
        location.reload();
    });
}

// Reset Google Drive settings
const resetGdriveBtn = document.getElementById('reset-gdrive-btn');
if (resetGdriveBtn) {
    resetGdriveBtn.addEventListener('click', () => {
        if (confirm('Google Drive設定をリセットしますか？\n再度クライアントIDの入力が必要になります。')) {
            localStorage.removeItem('gdrive_client_id');
            handleSignOut();
            location.reload();
        }
    });
}

// Setup guide link
const setupGuideLink = document.getElementById('setup-guide-link');
if (setupGuideLink) {
    setupGuideLink.addEventListener('click', (e) => {
        e.preventDefault();
        alert('セットアップガイド:\n\n1. Google Cloud Console (console.cloud.google.com) にアクセス\n2. 新しいプロジェクトを作成\n3. Google Drive APIを有効化\n4. 認証情報 → OAuth 2.0クライアントID を作成\n5. アプリケーションの種類: ウェブアプリケーション\n6. 承認済みのJavaScript生成元に現在のURLを追加\n7. クライアントIDをコピーして、ここに貼り付け\n\n詳細は SETUP_GUIDE.md をご覧ください。');
    });
}

// App Start
window.addEventListener('load', () => {
    gapiLoaded();
    gisLoaded();
    updateUI();
    showList();
});

// Ptr
const mainContent = document.querySelector('main');
let ptrStartY = 0;
let ptrDistance = 0;
const PTR_THRESHOLD = 80;
const ptrIndicator = document.createElement('div');
ptrIndicator.style.cssText = `position:absolute;top:60px;left:0;width:100%;height:40px;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:5;opacity:0;transition:opacity 0.2s;`;
ptrIndicator.innerHTML = '<span style="font-size:24px;color:var(--primary-color);background:rgba(255,255,255,0.8);border-radius:50%;padding:4px 10px;box-shadow:0 2px 5px rgba(0,0,0,0.1);">↻</span>';
document.body.appendChild(ptrIndicator);

mainContent.addEventListener('touchstart', (e) => { if (mainContent.scrollTop <= 0) ptrStartY = e.touches[0].clientY; }, { passive: true });
mainContent.addEventListener('touchmove', (e) => {
    if (!ptrStartY) return;
    const diff = e.touches[0].clientY - ptrStartY;
    if (diff > 0 && mainContent.scrollTop <= 0) {
        ptrDistance = diff;
        if (ptrDistance > 20) {
            ptrIndicator.style.opacity = Math.min((ptrDistance - 20) / 50, 1);
            ptrIndicator.querySelector('span').style.transform = `rotate(${ptrDistance * 3}deg)`;
        }
    }
}, { passive: true });
mainContent.addEventListener('touchend', () => {
    if (!ptrStartY) return;
    if (ptrDistance > PTR_THRESHOLD) {
        ptrIndicator.style.opacity = '1';
        ptrIndicator.innerHTML = '<span style="font-size:12px;background:white;padding:4px 12px;border-radius:12px;">読込中...</span>';
        renderList().then(() => {
            ptrIndicator.style.opacity = '0';
        });
    } else {
        ptrIndicator.style.opacity = '0';
    }
    ptrStartY = 0; ptrDistance = 0;
});
