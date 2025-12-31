/**
 * Danshari App Logic
 * Backend: Firebase (Firestore + Storage)
 */

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDXqfNMZwYpQuBiyvx1Q9TFxSkasE32Bcg",
    authDomain: "danshari-app-7d996.firebaseapp.com",
    projectId: "danshari-app-7d996",
    storageBucket: "danshari-app-7d996.firebasestorage.app",
    messagingSenderId: "578784782102",
    appId: "1:578784782102:web:56852077edfc1111591237"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();
const COLLECTION_NAME = 'items';

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
    // Render list will be triggered by update/get
    showList();
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

// --- Firebase Helpers ---

// Convert Base64 URI to Blob for upload
function dataURItoBlob(dataURI) {
    const splitDataURI = dataURI.split(',');
    const byteString = splitDataURI[0].indexOf('base64') >= 0 ? atob(splitDataURI[1]) : decodeURI(splitDataURI[1]);
    const mimeString = splitDataURI[0].split(':')[1].split(';')[0];
    const ia = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ia], { type: mimeString });
}

async function saveItem(item) {
    // 1. Upload image to Firebase Storage
    const timestamp = new Date().getTime();
    const filename = `images/${currentUser}/${timestamp}.jpg`;
    const storageRef = storage.ref().child(filename);

    // item.image is base64 string
    const blob = dataURItoBlob(item.image);
    await storageRef.put(blob);
    const downloadURL = await storageRef.getDownloadURL();

    // 2. Save metadata to Firestore
    // Remove large base64 string from DB object, use URL instead
    const docData = {
        ...item,
        image: downloadURL, // Use cloud URL
        storagePath: filename, // Keep path for deletion
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    // Ensure id is undefined if it exists (Firestore generates it)
    if (docData.id) delete docData.id;

    return db.collection(COLLECTION_NAME).add(docData);
}

async function getAllItems() {
    // Fetch all items (or query by user if data grows large)
    // For simplicity, fetch all and filter client-side for now to match structure
    // In production, should use .where('owner', '==', currentUser)
    const snapshot = await db.collection(COLLECTION_NAME).orderBy('date', 'desc').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateItem(item) {
    // If image changed (base64), upload new one. If it's URL, keep it.
    let imageUrl = item.image;
    let storagePath = item.storagePath;

    if (item.image.startsWith('data:')) {
        // Upload new image
        const timestamp = new Date().getTime();
        const filename = `images/${currentUser}/${timestamp}.jpg`;
        const storageRef = storage.ref().child(filename);
        const blob = dataURItoBlob(item.image);
        await storageRef.put(blob);
        imageUrl = await storageRef.getDownloadURL();
        storagePath = filename;

        // Delete old image if exists
        if (item.storagePath) {
            storage.ref().child(item.storagePath).delete().catch(e => console.warn('Old image delete failed', e));
        }
    }

    const docData = {
        reason: item.reason,
        comment: item.comment,
        date: item.date,
        owner: item.owner,
        image: imageUrl,
        storagePath: storagePath
    };

    return db.collection(COLLECTION_NAME).doc(item.id).update(docData);
}

async function deleteItem(item) {
    // 1. Delete from Firestore
    await db.collection(COLLECTION_NAME).doc(item.id).delete();

    // 2. Delete from Storage if path exists
    if (item.storagePath) {
        await storage.ref().child(item.storagePath).delete().catch(e => console.warn('Image delete failed', e));
    }
}

async function deleteItemsByUser(username) {
    // Batch delete
    const snapshot = await db.collection(COLLECTION_NAME).where('owner', '==', username).get();
    const batch = db.batch();

    // Also delete images
    const deleteImagePromises = [];

    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        const data = doc.data();
        if (data.storagePath) {
            deleteImagePromises.push(storage.ref().child(data.storagePath).delete().catch(() => { }));
        }
    });

    await Promise.all(deleteImagePromises);
    await batch.commit();
    return snapshot.size;
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
let isUserManageMode = false;

// Settings UI
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsModalClose = document.getElementById('settings-modal-close');
const resetUserDataBtn = document.getElementById('reset-user-data-btn');
const settingsUserNameLabel = document.getElementById('settings-user-name');
const setupFolderBtn = document.getElementById('setup-folder-btn');
const folderStatus = document.getElementById('folder-status');
const modalWrapper = document.getElementById('modal-wrapper');

// File System - Cloud mode disables direct FS sync for simplicity unless requested
// But we keep the UI for legacy requests -> Actually let's hide it or warn it works differently?
// User request was "saved to folder". Syncing cloud + local FS is tricky.
// Let's keep the setupFolderBtn logic but it is "addition" to Cloud.
let rootDirectoryHandle = null;

setupFolderBtn.addEventListener('click', async () => {
    try {
        rootDirectoryHandle = await window.showDirectoryPicker();
        folderStatus.style.display = 'block';
        alert('保存先フォルダを設定しました。\nクラウドに保存すると同時に、このローカルフォルダにもバックアップが保存されます。');
    } catch (err) {
        console.error(err);
    }
});

async function saveToLocalFile(itemData) {
    if (!rootDirectoryHandle) return;
    try {
        const ownerName = itemData.owner || 'ゲスト';
        const userDirHandle = await rootDirectoryHandle.getDirectoryHandle(ownerName, { create: true });
        const d = new Date(itemData.date);
        const dateStr = d.getFullYear() +
            ('0' + (d.getMonth() + 1)).slice(-2) +
            ('0' + d.getDate()).slice(-2) + '_' +
            ('0' + d.getHours()).slice(-2) +
            ('0' + d.getMinutes()).slice(-2) +
            ('0' + d.getSeconds()).slice(-2);
        const cleanReason = (itemData.reason || 'item').replace(/[\/\\:*?"<>|]/g, '_');
        const filename = `${dateStr}_${cleanReason}.jpg`;
        const fileHandle = await userDirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();

        // itemData.image is Base64
        if (itemData.image.startsWith('data:')) {
            const blob = dataURItoBlob(itemData.image);
            await writable.write(blob);
            await writable.close();
            console.log('Saved to local file:', filename);
        }
    } catch (err) {
        console.error('Error saving to local file:', err);
    }
}

const modalClose = document.getElementById('modal-close');
const modalContentArea = document.getElementById('modal-detail-content');

// State
let currentImageData = null;
let editingItemId = null;

// Navigation
function showList() {
    viewAdd.classList.remove('active');
    viewList.style.display = '';
    viewList.classList.add('active');
    fabAdd.style.display = 'flex';
    updateHeaderUser();
    renderList();
    editingItemId = null;
}

function updateHeaderUser() {
    currentUserLabel.textContent = currentUser;
}

// User Modal Logic
userSwitchBtn.addEventListener('click', () => {
    isUserManageMode = false;
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
});

addUserBtn.addEventListener('click', () => {
    const name = newUserNameInput.value.trim();
    if (name) {
        addUser(name);
        newUserNameInput.value = '';
    }
});

function renderUserList() {
    updateUserModalHeader();
    userListEl.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = `user-item ${user === currentUser ? 'active' : ''}`;
        if (isUserManageMode) {
            div.innerHTML = `
                <span class="name">${user}</span>
                <span style="font-size:10px; color:#999;">${user === currentUser ? '(選択中)' : ''}</span>
                ${user !== currentUser ? `<button class="btn-delete-user" style="margin-top:4px; font-size:10px; padding:2px 8px; background:#fee2e2; color:#b91c1c; border:none; border-radius:4px; cursor:pointer;">削除</button>` : ''}
            `;
            const delBtn = div.querySelector('.btn-delete-user');
            if (delBtn) {
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (confirm(`${user} を削除しますか？\nクラウド上の記録もすべて削除されます。`)) {
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
    await deleteItemsByUser(username);
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

// Remove Export ZIP logic or keep it? 
// Generating ZIP from Cloud URL is possible but might face CORS issues if not configured.
// Let's keep it simple and comment out export logic for now, OR try to fetch blobs.
// For now, let's just not attach the listener or keep a simple alert.
const exportDataBtn = document.getElementById('export-data-btn');
if (exportDataBtn) {
    exportDataBtn.onclick = () => alert('クラウド版では現在この機能は使えません。\n(ローカルフォルダ保存は「保存先フォルダの設定」から可能です)');
}

resetUserDataBtn.addEventListener('click', async () => {
    if (confirm(`本当に ${currentUser} のデータをすべて削除しますか？\nクラウド上のデータも消えます。`)) {
        const input = prompt(`削除を実行するには、以下に「削除」と入力してください。`);
        if (input === '削除') {
            try {
                const count = await deleteItemsByUser(currentUser);
                alert(`${count}件のデータを削除しました。`);
                settingsModal.classList.add('hidden');
                renderList();
            } catch (err) {
                console.error(err);
                alert('削除中にエラーが発生しました。');
            }
        }
    }
});


function showAdd(itemToEdit = null) {
    viewList.classList.remove('active');
    viewList.style.display = 'none';
    setTimeout(() => viewList.style.display = '', 0);
    viewAdd.classList.add('active');
    fabAdd.style.display = 'none';

    if (itemToEdit) {
        editingItemId = itemToEdit.id;
        document.getElementById('reason').value = itemToEdit.reason;
        document.getElementById('comment').value = itemToEdit.comment;
        // In cloud mode, itemToEdit.image is URL.
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

// Image Handling
function handleImageFile(file) {
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentImageData = event.target.result; // Base64 string for preview & upload
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
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}
imagePreviewArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleImageFile(files[0]);
});

// Form Submission
addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentImageData) {
        alert('写真を選択してください。');
        return;
    }

    const reason = document.getElementById('reason').value;
    const comment = document.getElementById('comment').value;
    let date = new Date().toISOString();
    let id = undefined;

    // Loading State
    submitBtn.disabled = true;
    submitBtn.textContent = editingItemId ? '更新中...' : '送信中...';

    if (editingItemId) {
        // We find original item in list (inefficient but safe)
        // Or we pass full item to edit. For now simple:
        // We trust editingItemId
        id = editingItemId; // Date update: usually preserve original date or update?
        // Let's preserve original date from finding item logic or assume current.
        // Actually, updateItem replaces fields. We should fetch original to get old date?
        // Let's assume passed date is fine or we didn't store it.
        // In renderList we have the date. Let's try to find it again.
    }

    const itemData = {
        image: currentImageData, // This is either URL (if not changed) or Base64 (if changed)
        reason,
        comment,
        date,
        owner: currentUser
    };

    // If editing and image is URL, it means no change. If base64, change.

    // We need original item for ID and existing data
    if (id) {
        itemData.id = id;
        // Try to preserve date from existing item logic if possible, 
        // but here we just use Today for simplicity OR ideally fetch it.
    }

    try {
        if (editingItemId) {
            // Need to pass storagePath if we want to delete old image
            // We can get it from fetching current doc.
            // For simplicity in this rewrite, we might leak old image if we don't fetch first.
            // Let's fetch quickly.
            const doc = await db.collection(COLLECTION_NAME).doc(id).get();
            if (doc.exists) {
                const oldData = doc.data();
                itemData.storagePath = oldData.storagePath;
                itemData.date = oldData.date; // Keep original date
                if (!itemData.image.startsWith('data:')) {
                    itemData.image = oldData.image; // Keep URL
                }
            }
            await updateItem(itemData);
        } else {
            // Save local backup if enabled
            if (rootDirectoryHandle) {
                await saveToLocalFile(itemData);
            }
            await saveItem(itemData);
        }
        showList();
    } catch (err) {
        console.error('Error saving item:', err);
        alert('保存に失敗しました。: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '手放す';
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
    submitBtn.disabled = false;
}

// Rendering
async function renderList() {
    itemGrid.innerHTML = '<div style="width:100%; text-align:center; padding:20px;">読み込み中...</div>';

    try {
        const allItems = await getAllItems();
        const items = allItems.filter(item => item.owner === currentUser);

        statsEl.textContent = `${items.length} items`;
        itemGrid.innerHTML = '';

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
    } catch (e) {
        itemGrid.innerHTML = `<div style="color:red; text-align:center;">エラー: ${e.message}</div>`;
    }
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
                if (confirm('この記録を削除しますか？')) {
                    // Local backup delete attempt
                    if (rootDirectoryHandle) {
                        try {
                            // Re-construct filename logic or save filename in DB (Cloud mode we saved storagePath but not local filename)
                            // Without filename stored, deleting local is hard. Skipping for cloud mode simplicity.
                        } catch (e) { }
                    }

                    await deleteItem(item);
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
