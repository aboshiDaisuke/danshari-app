/**
 * Danshari App Logic
 * Simple local storage with manual backup capability
 */

const DB_NAME = 'DanshariDB';
const STORE_NAME = 'items';
const DB_VERSION = 2;

let db;
let currentUser = localStorage.getItem('currentUser') || 'デフォルトユーザー';
let selectedFolderHandle = null;

// --- IndexedDB Setup ---
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                objectStore.createIndex('user', 'user', { unique: false });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// --- Data Operations ---
async function saveItem(item) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    item.user = currentUser;
    item.timestamp = Date.now();

    return new Promise((resolve, reject) => {
        const request = store.add(item);
        request.onsuccess = async () => {
            // Save to PC folder if configured
            if (selectedFolderHandle) {
                await saveToPCFolder(item, request.result);
            }
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function saveToPCFolder(item, itemId) {
    try {
        // Create user folder
        const userFolderHandle = await selectedFolderHandle.getDirectoryHandle(currentUser, { create: true });

        // Save image
        if (item.image) {
            const timestamp = new Date(item.timestamp).toISOString().replace(/[:.]/g, '-');
            const filename = `${timestamp}_${itemId}.jpg`;
            const fileHandle = await userFolderHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();

            // Convert base64 to blob
            const base64Data = item.image.split(',')[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/jpeg' });

            await writable.write(blob);
            await writable.close();
        }
    } catch (err) {
        console.error('Failed to save to PC folder:', err);
    }
}

async function getAllItems() {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('user');

    return new Promise((resolve, reject) => {
        const request = index.getAll(currentUser);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function updateItem(id, updates) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise(async (resolve, reject) => {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            const item = getRequest.result;
            Object.assign(item, updates);
            const updateRequest = store.put(item);
            updateRequest.onsuccess = () => resolve();
            updateRequest.onerror = () => reject(updateRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function deleteItem(id) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// --- User Management ---
function getUsers() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    if (users.length === 0) {
        users.push('デフォルトユーザー');
        localStorage.setItem('users', JSON.stringify(users));
    }
    return users;
}

function addUser(username) {
    const users = getUsers();
    if (!users.includes(username)) {
        users.push(username);
        localStorage.setItem('users', JSON.stringify(users));
    }
}

function deleteUser(username) {
    if (username === 'デフォルトユーザー') {
        alert('デフォルトユーザーは削除できません');
        return;
    }
    const users = getUsers().filter(u => u !== username);
    localStorage.setItem('users', JSON.stringify(users));

    if (currentUser === username) {
        currentUser = 'デフォルトユーザー';
        localStorage.setItem('currentUser', currentUser);
    }
}

function switchUser(username) {
    currentUser = username;
    localStorage.setItem('currentUser', currentUser);
    updateUI();
    renderList();
}

// --- UI Functions ---
function updateUI() {
    // Update user display
    const userNameEl = document.getElementById('current-user-name');
    if (userNameEl) {
        const span = userNameEl.querySelector('span');
        if (span) {
            span.textContent = currentUser;
        } else {
            userNameEl.innerHTML = `👤 <span>${currentUser}</span>`;
        }
    }

    // Update settings user name
    const settingsUserName = document.getElementById('settings-user-name');
    if (settingsUserName) {
        settingsUserName.textContent = currentUser;
    }
}

async function renderList() {
    const items = await getAllItems();
    const itemGrid = document.getElementById('item-grid');
    const emptyState = document.getElementById('empty-state');
    const stats = document.getElementById('stats');

    if (items.length === 0) {
        emptyState.style.display = 'flex';
        itemGrid.style.display = 'none';
        stats.textContent = '0 items';
    } else {
        emptyState.style.display = 'none';
        itemGrid.style.display = 'grid';
        stats.textContent = `${items.length} items`;

        itemGrid.innerHTML = '';
        items.sort((a, b) => b.timestamp - a.timestamp).forEach(item => {
            const card = createItemCard(item);
            itemGrid.appendChild(card);
        });
    }
}

function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.onclick = () => showDetail(item);

    const img = document.createElement('img');
    img.src = item.image || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23f0f0f0" width="200" height="200"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="16"%3ENo Image%3C/text%3E%3C/svg%3E';
    img.alt = item.reason || 'Item';

    const info = document.createElement('div');
    info.className = 'item-info';

    const reason = document.createElement('div');
    reason.className = 'item-reason';
    reason.textContent = item.reason || '理由なし';

    const date = document.createElement('div');
    date.className = 'item-date';
    date.textContent = new Date(item.timestamp).toLocaleDateString('ja-JP');

    info.appendChild(reason);
    info.appendChild(date);
    card.appendChild(img);
    card.appendChild(info);

    return card;
}

function showDetail(item) {
    const modal = document.getElementById('modal-wrapper');
    const content = document.getElementById('modal-detail-content');

    content.innerHTML = `
        <div class="detail-image">
            <img src="${item.image || ''}" alt="Item image">
        </div>
        <div class="detail-info">
            <div class="detail-reason">
                <strong>手放す理由:</strong> ${item.reason || 'なし'}
            </div>
            <div class="detail-comment">
                <strong>コメント:</strong><br>${item.comment || 'なし'}
            </div>
            <div class="detail-date">
                <strong>日付:</strong> ${new Date(item.timestamp).toLocaleString('ja-JP')}
            </div>
            <div class="detail-user">
                <strong>ユーザー:</strong> ${item.user || 'Unknown'}
            </div>
        </div>
        <div class="detail-actions">
            <button class="btn-danger" onclick="deleteItemConfirm(${item.id})">削除</button>
        </div>
    `;

    modal.classList.remove('hidden');
}

function closeModal() {
    const modal = document.getElementById('modal-wrapper');
    modal.classList.add('hidden');
}

async function deleteItemConfirm(id) {
    if (confirm('本当に削除しますか？')) {
        await deleteItem(id);
        closeModal();
        renderList();
    }
}

// --- Export Functions ---
async function exportAllData() {
    const items = await getAllItems();

    if (items.length === 0) {
        alert('エクスポートするデータがありません');
        return;
    }

    const exportBtn = document.getElementById('export-data-btn');
    const progressEl = document.getElementById('export-progress');

    exportBtn.disabled = true;
    progressEl.style.display = 'block';
    progressEl.textContent = 'ZIPファイルを作成中...';

    try {
        const zip = new JSZip();
        const userFolder = zip.folder(currentUser);

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            progressEl.textContent = `処理中... (${i + 1}/${items.length})`;

            if (item.image) {
                const timestamp = new Date(item.timestamp).toISOString().replace(/[:.]/g, '-');
                const filename = `${timestamp}_${item.id}.jpg`;

                // Convert base64 to blob
                const base64Data = item.image.split(',')[1];
                userFolder.file(filename, base64Data, { base64: true });
            }
        }

        progressEl.textContent = 'ダウンロード準備中...';
        const content = await zip.generateAsync({ type: 'blob' });

        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `danshari_backup_${currentUser}_${new Date().toISOString().split('T')[0]}.zip`;
        a.click();

        URL.revokeObjectURL(url);
        progressEl.textContent = 'ダウンロード完了！';

        setTimeout(() => {
            progressEl.style.display = 'none';
            exportBtn.disabled = false;
        }, 2000);

    } catch (err) {
        console.error('Export failed:', err);
        alert('エクスポートに失敗しました');
        progressEl.style.display = 'none';
        exportBtn.disabled = false;
    }
}

async function resetUserData() {
    if (!confirm(`${currentUser} の記録をすべて削除しますか？この操作は取り消せません。`)) {
        return;
    }

    if (!confirm('本当によろしいですか？すべてのデータが失われます。')) {
        return;
    }

    const items = await getAllItems();
    for (const item of items) {
        await deleteItem(item.id);
    }

    renderList();
    alert('データを削除しました');
}

// --- PC Folder Setup ---
async function setupPCFolder() {
    try {
        const handle = await window.showDirectoryPicker();
        selectedFolderHandle = handle;

        const folderStatus = document.getElementById('folder-status');
        folderStatus.style.display = 'block';

        alert('保存先フォルダを設定しました。\n今後、写真を追加するたびに自動でこのフォルダに保存されます。');
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Folder selection failed:', err);
            alert('フォルダの選択に失敗しました');
        }
    }
}

// --- User Modal Functions ---
function showUserModal() {
    const modal = document.getElementById('user-modal');
    const userList = document.getElementById('user-list');
    const users = getUsers();

    userList.innerHTML = '';
    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item' + (user === currentUser ? ' active' : '');
        item.innerHTML = `
            <span>${user}</span>
            ${user !== 'デフォルトユーザー' ? `<button class="btn-delete" onclick="deleteUserConfirm('${user}')">削除</button>` : ''}
        `;
        item.onclick = (e) => {
            if (!e.target.classList.contains('btn-delete')) {
                switchUser(user);
                closeUserModal();
            }
        };
        userList.appendChild(item);
    });

    modal.classList.remove('hidden');
}

function closeUserModal() {
    const modal = document.getElementById('user-modal');
    modal.classList.add('hidden');
}

function deleteUserConfirm(username) {
    if (confirm(`${username} を削除しますか？`)) {
        deleteUser(username);
        showUserModal();
    }
}

function addNewUser() {
    const input = document.getElementById('new-user-input');
    const username = input.value.trim();

    if (!username) {
        alert('ユーザー名を入力してください');
        return;
    }

    if (getUsers().includes(username)) {
        alert('そのユーザー名は既に存在します');
        return;
    }

    addUser(username);
    input.value = '';
    showUserModal();
}

// --- Settings Modal ---
function showSettings() {
    const modal = document.getElementById('settings-modal');
    updateUI();
    modal.classList.remove('hidden');
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('hidden');
}

// --- Add Item View ---
function showAddView() {
    document.getElementById('view-list').classList.remove('active');
    document.getElementById('view-add').classList.add('active');
    document.getElementById('fab-add').style.display = 'none';
}

function hideAddView() {
    document.getElementById('view-add').classList.remove('active');
    document.getElementById('view-list').classList.add('active');
    document.getElementById('fab-add').style.display = 'flex';

    // Reset form
    document.getElementById('add-form').reset();
    document.getElementById('preview-img').style.display = 'none';
    document.querySelector('.placeholder').style.display = 'flex';
}

// --- Image Handling ---
let currentImageData = null;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 App starting...');

    try {
        // Initialize DB
        console.log('📦 Opening database...');
        db = await openDB();
        console.log('✅ Database opened');

        // Update UI
        console.log('🎨 Updating UI...');
        updateUI();

        console.log('📋 Rendering list...');
        renderList();

        console.log('✅ App initialized successfully');
    } catch (err) {
        console.error('❌ Error during initialization:', err);
        alert('アプリの初期化に失敗しました: ' + err.message);
    }

    // FAB button
    console.log('🔘 Setting up FAB button...');
    const fabBtn = document.getElementById('fab-add');
    if (fabBtn) {
        fabBtn.addEventListener('click', showAddView);
        console.log('✅ FAB button ready');
    } else {
        console.error('❌ FAB button not found!');
    }

    // Cancel button
    console.log('🔘 Setting up Cancel button...');
    const cancelBtn = document.getElementById('cancel-add');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', hideAddView);
        console.log('✅ Cancel button ready');
    } else {
        console.error('❌ Cancel button not found!');
    }

    // Image upload
    const uploadTrigger = document.getElementById('image-upload-trigger');
    const cameraInput = document.getElementById('camera-input');
    const previewImg = document.getElementById('preview-img');

    uploadTrigger.addEventListener('click', () => {
        cameraInput.click();
    });

    cameraInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                currentImageData = event.target.result;
                previewImg.src = currentImageData;
                previewImg.style.display = 'block';
                document.querySelector('.placeholder').style.display = 'none';
            };
            reader.readAsDataURL(file);
        }
    });

    // Form submit
    document.getElementById('add-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const reason = document.getElementById('reason').value;
        const comment = document.getElementById('comment').value;

        if (!currentImageData) {
            alert('写真を選択してください');
            return;
        }

        const item = {
            image: currentImageData,
            reason,
            comment
        };

        await saveItem(item);

        currentImageData = null;
        hideAddView();
        renderList();
    });

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-wrapper').addEventListener('click', (e) => {
        if (e.target.id === 'modal-wrapper') closeModal();
    });

    // Settings
    document.getElementById('settings-btn').addEventListener('click', showSettings);
    document.getElementById('settings-modal-close').addEventListener('click', closeSettings);
    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'settings-modal') closeSettings();
    });

    // User switching
    document.getElementById('current-user-name').addEventListener('click', showUserModal);
    document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
    document.getElementById('add-user-btn').addEventListener('click', addNewUser);
    document.getElementById('new-user-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addNewUser();
    });

    // Export & Reset
    document.getElementById('export-data-btn').addEventListener('click', exportAllData);
    document.getElementById('reset-user-data-btn').addEventListener('click', resetUserData);

    // PC Folder Setup
    if ('showDirectoryPicker' in window) {
        document.getElementById('setup-folder-btn').addEventListener('click', setupPCFolder);
    } else {
        document.getElementById('setup-folder-btn').style.display = 'none';
        const note = document.createElement('p');
        note.style.cssText = 'font-size:12px; color:#999; margin-top:8px;';
        note.textContent = 'この機能はChrome/Edgeでのみ利用できます';
        document.getElementById('setup-folder-btn').parentNode.appendChild(note);
    }
});
