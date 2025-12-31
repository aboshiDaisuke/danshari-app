/**
 * Danshari App Logic
 * Uses IndexedDB for storage and Vanilla JS for UI
 */

const DB_NAME = 'DanshariDB';
const STORE_NAME = 'items';
const DB_VERSION = 1;

// --- User Management (LocalStorage) ---
const USERS_KEY = 'danshari_users';
const CURRENT_USER_KEY = 'danshari_current_user';

let users = JSON.parse(localStorage.getItem(USERS_KEY)) || ['わたし'];
let currentUser = localStorage.getItem(CURRENT_USER_KEY) || users[0];

function saveUsers() {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function setCurrentUser(name) {
    currentUser = name;
    localStorage.setItem(CURRENT_USER_KEY, name);
    updateHeaderUser();
    renderList(); // Re-render to potentially show/hide items if we filter later (currently just updates badges)
}

function addUser(name) {
    if (!name) return;
    if (!users.includes(name)) {
        users.push(name);
        saveUsers();
        renderUserList();
    }
    setCurrentUser(name);
    userModal.classList.add('hidden');
}

// --- IndexedDB Helper ---
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

async function saveItem(item) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(item);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAllItems() {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll(); // Get all items
        request.onsuccess = () => {
            // Sort by date desc in JS (easier than IDBCursor for simple arrays)
            const items = request.result;
            items.sort((a, b) => new Date(b.date) - new Date(a.date));
            resolve(items);
        };
        request.onerror = () => reject(request.error);
    });
}

async function updateItem(item) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(item);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function deleteItem(id) {
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
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('date');

        let deletedCount = 0;
        const request = store.openCursor();

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const item = cursor.value;
                if (item.owner === username) {
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

// User UI Elements
const userSwitchBtn = document.getElementById('user-switch-btn');
const currentUserLabel = document.getElementById('current-user-name');
const userModal = document.getElementById('user-modal');
const userModalClose = document.getElementById('user-modal-close');
const userListEl = document.getElementById('user-list');
const addUserBtn = document.getElementById('add-user-btn');
const newUserNameInput = document.getElementById('new-user-name');
const manageUsersBtn = document.createElement('button');

let isUserManageMode = false;

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
        return null; // Don't alert aggressively to avoid disturbing UX, just log.
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

        // Delete processed if exists (legacy support or if re-enabled later)
        const processedFilename = item.filename.replace('.jpg', '_processed.jpg');
        await userDirHandle.removeEntry(processedFilename).catch(() => { });

    } catch (err) {
        console.warn('Could not delete local file (may not exist or permission denied):', err);
    }
}

const modalClose = document.getElementById('modal-close');
const modalContentArea = document.getElementById('modal-detail-content');

// State
let currentImageData = null;
let editingItemId = null; // Track if we are editing

// Navigation
function showList() {
    viewAdd.classList.remove('active');
    viewList.style.display = ''; // Clear any inline styles
    viewList.classList.add('active');
    fabAdd.style.display = 'flex';
    updateHeaderUser(); // Ensure header is correct
    renderList();
    editingItemId = null; // Reset editing state
}

function updateHeaderUser() {
    currentUserLabel.textContent = currentUser;
}

// User Modal Logic
userSwitchBtn.addEventListener('click', () => {
    isUserManageMode = false; // Reset mode
    renderUserList();
    userModal.classList.remove('hidden');
});

// Helper for user modal header
function updateUserModalHeader() {
    let simpleClose = document.getElementById('user-modal-close');
    let header = userModal.querySelector('.modal-header');

    let manageBtn = document.getElementById('user-manage-toggle');
    if (!manageBtn) {
        manageBtn = document.createElement('button');
        manageBtn.id = 'user-manage-toggle';
        manageBtn.style.cssText = 'background:none; border:none; color:var(--primary-color); font-size:13px; font-weight:600; cursor:pointer; margin-right:auto; margin-left:12px;';
        header.insertBefore(manageBtn, simpleClose);
    }

    manageBtn.textContent = isUserManageMode ? '完了' : '編集';
    manageBtn.onclick = () => {
        isUserManageMode = !isUserManageMode;
        renderUserList();
        updateUserModalHeader();
        document.querySelector('.add-user-form').style.display = isUserManageMode ? 'none' : 'flex';
    };
}


userModalClose.addEventListener('click', () => {
    userModal.classList.add('hidden');
    isUserManageMode = false;
});

addUserBtn.addEventListener('click', () => {
    const name = newUserNameInput.value.trim();
    if (name) {
        addUser(name);
        newUserNameInput.value = '';
    }
});

function renderUserList() {
    updateUserModalHeader(); // Ensure button state
    userListEl.innerHTML = '';

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = `user-item ${user === currentUser ? 'active' : ''}`;

        // Mode dependent content
        if (isUserManageMode) {
            div.style.position = 'relative';
            div.innerHTML = `
                <span class="name">${user}</span>
                <span style="font-size:10px; color:#999;">${user === currentUser ? '(選択中)' : ''}</span>
                ${user !== currentUser ? `<button class="btn-delete-user" style="margin-top:4px; font-size:10px; padding:2px 8px; background:#fee2e2; color:#b91c1c; border:none; border-radius:4px; cursor:pointer;">削除</button>` : ''}
            `;

            const delBtn = div.querySelector('.btn-delete-user');
            if (delBtn) {
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`${user} を削除しますか？\n記録もすべて削除されます。`)) {
                        await deleteUser(user);
                    }
                };
            }
        } else {
            div.innerHTML = `
                <span class="name">${user}</span>
                <span class="count" id="count-${user}">...</span> 
            `;
            div.onclick = () => {
                setCurrentUser(user);
                userModal.classList.add('hidden');
            };
        }

        userListEl.appendChild(div);
    });
}

async function deleteUser(username) {
    if (username === currentUser) {
        alert('現在選択中のユーザーは削除できません。');
        return;
    }

    // Delete data
    await deleteItemsByUser(username);

    // Remove from list
    users = users.filter(u => u !== username);
    saveUsers();
    renderUserList();
}


// Settings Logic
settingsBtn.addEventListener('click', () => {
    settingsUserNameLabel.textContent = currentUser;
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
        const items = await getAllItems();

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

            const imgData = item.image.split(',')[1];

            zip.folder(ownerFolder).file(filename, imgData, { base64: true });
        }

        exportProgress.textContent = 'ZIPファイルを作成中...';

        const content = await zip.generateAsync({ type: "blob" });

        // Trigger download
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
        alert('エクスポートに失敗しました。');
        exportDataBtn.disabled = false;
        exportProgress.style.display = 'none';
    }
});

resetUserDataBtn.addEventListener('click', async () => {
    if (confirm(`本当に ${currentUser} のデータをすべて削除しますか？\nこの操作は取り消せません。`)) {
        // Second confirmation
        const input = prompt(`削除を実行するには、以下に「削除」と入力してください。`);
        if (input === '削除') {
            try {
                // Delete local files for all user items if connected
                if (rootDirectoryHandle) {
                    const allItems = await getAllItems();
                    const userItems = allItems.filter(i => i.owner === currentUser);
                    for (const item of userItems) {
                        await deleteFromLocalFile(item);
                    }
                }

                const count = await deleteItemsByUser(currentUser);
                alert(`${count}件のデータを削除しました。`);
                settingsModal.classList.add('hidden');
                renderList();
            } catch (err) {
                console.error(err);
                alert('削除中にエラーが発生しました。');
            }
        } else {
            alert('入力が正しくないためキャンセルしました。');
        }
    }
});


function showAdd(itemToEdit = null) {
    viewList.classList.remove('active');
    viewList.style.display = 'none';
    setTimeout(() => viewList.style.display = '', 0);
    viewAdd.classList.add('active');
    fabAdd.style.display = 'none';

    // Check if editing
    if (itemToEdit) {
        editingItemId = itemToEdit.id;
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

// Event Listeners
fabAdd.addEventListener('click', () => showAdd(null));
cancelAddBtn.addEventListener('click', () => {
    resetForm();
    showList();
});

// Image Handling

// Unified file handler
function handleImageFile(file) {
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentImageData = event.target.result; // Base64 string
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

// Drag & Drop Support
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    imagePreviewArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    imagePreviewArea.addEventListener(eventName, () => {
        imagePreviewArea.style.borderColor = 'var(--primary-color)';
        imagePreviewArea.style.backgroundColor = '#eef2f2';
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    imagePreviewArea.addEventListener(eventName, () => {
        imagePreviewArea.style.borderColor = '';
        imagePreviewArea.style.backgroundColor = '';
    }, false);
});

imagePreviewArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleImageFile(files[0]);
}, false);


// Form Submission
addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentImageData) {
        alert('恐れ入りますが、写真を選択してください。');
        return;
    }

    const reason = document.getElementById('reason').value;
    const comment = document.getElementById('comment').value;

    // If editing, keep original date, else use now
    let date = new Date().toISOString();
    let id = undefined;

    if (editingItemId) {
        try {
            const allItems = await getAllItems();
            const originalItem = allItems.find(i => i.id === editingItemId);
            if (originalItem) {
                date = originalItem.date;
                id = editingItemId;
            }
        } catch (e) {
            console.error(e);
        }
    }

    const itemData = {
        image: currentImageData,
        reason,
        comment,
        date,
        owner: currentUser
    };

    if (id) itemData.id = id;

    try {
        if (editingItemId) {
            await updateItem(itemData);
        } else {
            // Attempt to save to local file system first to get filename
            let savedFilename = null;
            if (rootDirectoryHandle) {
                savedFilename = await saveToLocalFile(itemData);
            }

            if (savedFilename) {
                itemData.filename = savedFilename;
            }

            await saveItem(itemData);
        }
        showList();
    } catch (err) {
        console.error('Error saving item:', err);
        alert('保存に失敗しました。');
    }
});

function resetForm() {
    addForm.reset();
    currentImageData = null;
    editingItemId = null;
    previewImg.src = '';
    previewImg.style.display = 'none';
    placeholder.style.display = 'block';
    submitBtn.textContent = '手放す';
}

// Rendering
async function renderList() {
    itemGrid.innerHTML = '';
    const allItems = await getAllItems();

    // Filter by current user
    const items = allItems.filter(item => item.owner === currentUser);

    // Update stats
    statsEl.textContent = `${items.length} items`;

    if (items.length === 0) {
        emptyState.style.display = 'flex';
        return;
    } else {
        emptyState.style.display = 'none';
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card';

        const dateStr = new Date(item.date).toLocaleDateString('ja-JP', {
            year: 'numeric', month: 'short', day: 'numeric'
        });

        card.innerHTML = `
            <img src="${item.image}" class="item-img-thumb" loading="lazy" alt="Item">
            ${item.owner ? `<div class="item-owner">${item.owner}</div>` : ''}
            <div class="item-info">
                <span class="item-date">${dateStr}</span>
                <div class="item-reason">${item.reason}</div>
            </div>
        `;

        card.addEventListener('click', () => showDetail(item));
        itemGrid.appendChild(card);
    });
}

// Modal Logic
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

    // Attach event listeners for new buttons
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
                    // Try to delete from local file system if connected
                    await deleteFromLocalFile(item);

                    await deleteItem(item.id);
                    modalWrapper.classList.add('hidden');
                    renderList();
                }
            };
        }
    }, 0);

    modalWrapper.classList.remove('hidden');
}

modalClose.addEventListener('click', () => {
    modalWrapper.classList.add('hidden');
});

modalWrapper.addEventListener('click', (e) => {
    if (e.target === modalWrapper) {
        modalWrapper.classList.add('hidden');
    }
});

// Initial Render
updateHeaderUser();
showList();

// --- Pull to Refresh Logic ---
const mainContent = document.querySelector('main');
let ptrStartY = 0;
let ptrDistance = 0;
const PTR_THRESHOLD = 80;

// Create Refresh Indicator
const ptrIndicator = document.createElement('div');
ptrIndicator.style.cssText = `
    position: absolute;
    top: 60px; /* Below header */
    left: 0; 
    width: 100%;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
    opacity: 0;
    transition: opacity 0.2s;
`;
ptrIndicator.innerHTML = '<span style="font-size:24px; color:var(--primary-color); background:rgba(255,255,255,0.8); border-radius:50%; padding:4px 10px; box-shadow:0 2px 5px rgba(0,0,0,0.1);">↻</span>';
document.body.appendChild(ptrIndicator);

mainContent.addEventListener('touchstart', (e) => {
    // Only enable if scrolled to top
    if (mainContent.scrollTop <= 0) {
        ptrStartY = e.touches[0].clientY;
        ptrDistance = 0;
    } else {
        ptrStartY = 0; // Disable
    }
}, { passive: true });

mainContent.addEventListener('touchmove', (e) => {
    if (ptrStartY === 0) return;

    // Only handle single touch
    if (e.touches.length > 1) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - ptrStartY;

    if (diff > 0 && mainContent.scrollTop <= 0) {
        ptrDistance = diff;

        // Show indicator if pulling
        if (ptrDistance > 20) {
            ptrIndicator.style.opacity = Math.min((ptrDistance - 20) / 50, 1);
            const rotation = Math.min(ptrDistance * 3, 360);
            ptrIndicator.querySelector('span').style.transform = `rotate(${rotation}deg)`;
        }
    }
}, { passive: true });

mainContent.addEventListener('touchend', (e) => {
    if (ptrStartY === 0) return;

    if (ptrDistance > PTR_THRESHOLD) {
        // Trigger Refresh
        ptrIndicator.style.opacity = '1';
        ptrIndicator.innerHTML = '<span style="font-size:12px; color:var(--text-main); background:rgba(255,255,255,0.9); padding:4px 12px; border-radius:12px;">更新中...</span>';
        setTimeout(() => location.reload(), 300);
    } else {
        // Reset
        ptrIndicator.style.opacity = '0';
    }
    ptrStartY = 0;
    ptrDistance = 0;
});
