// =================================================================================
// グローバル定数・変数
// =================================================================================
const API_BASE_URL = 'http://localhost:3000';

let parkingData = [];
let currentUser = null;
let myParkingInfo = null;


// =================================================================================
// 画面要素の取得
// =================================================================================
const loginScreen = document.getElementById('loginScreen');
const mainSystem = document.getElementById('mainSystem');
const loginMode = document.getElementById('loginMode');
const registerMode = document.getElementById('registerMode');
const errorMessage = document.getElementById('errorMessage');


// =================================================================================
// API通信
// =================================================================================
async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(API_BASE_URL + url, options);
        const resJson = await response.json();
        if (!response.ok) {
            throw new Error(resJson.message || `HTTP error! status: ${response.status}`);
        }
        return resJson;
    } catch (error) {
        console.error('API Request Error:', error);
        showError(error.message);
        throw error;
    }
}


// =================================================================================
// ログイン・新規登録・ログアウト関連の処理
// =================================================================================
function switchAuthMode(mode) {
    if (mode === 'login') {
        loginMode.classList.remove('hidden');
        registerMode.classList.add('hidden');
    } else {
        loginMode.classList.add('hidden');
        registerMode.classList.remove('hidden');
    }
    hideError();
}

const switchToLogin = () => switchAuthMode('login');
const switchToRegister = () => switchAuthMode('register');

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

async function handleRegister(event) {
    event.preventDefault(); // ページの再読み込みを防ぐ

    const studentId = document.getElementById('registerStudentId').value.trim();
    const name = document.getElementById('registerName').value.trim();
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

    // ----- ↓↓↓ ここから新しいバリデーションルールを追加 ↓↓↓ -----

    // 学籍番号のルール: 数字2桁 + 英字2文字 + 数字3桁
    const studentIdRegex = /^\d{2}[a-z]{2}\d{3}$/i;
    if (!studentIdRegex.test(studentId)) {
        return showError('学籍番号は「数字2桁 + 英字2文字 + 数字3桁」の形式で入力してください。(例: 23db123)');
    }

    // パスワードのルール: 8文字以上で、英字と数字の両方を含む
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!passwordRegex.test(password)) {
        return showError('パスワードは8文字以上の英数字の両方を含めてください。');
    }

    // ----- ↑↑↑ バリデーションルールはここまで ↑↑↑ -----

    if (password !== passwordConfirm) {
        return showError('パスワードが一致しません。');
    }

    if (!name) { // 氏名のチェックも追加しておくと親切です
        return showError('氏名を入力してください。');
    }

    // APIリクエスト部分は変更なし
    try {
        await apiRequest('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId, name, password })
        });
        showNotification('新規登録が完了しました。ログインしてください。', 'success');
        switchToLogin();
    } catch (error) {
        // apiRequest関数内でshowErrorが呼ばれるので、ここでは何もしない
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const studentId = document.getElementById('loginStudentId').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!studentId || !password) return showError('学籍番号とパスワードを入力してください。');
    
    try {
        const data = await apiRequest('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId, password })
        });
        currentUser = data.user;
        myParkingInfo = data.myParkingInfo;
        showMainSystem();
    } catch (error) {}
}

function handleLogout() {
    if (confirm('ログアウトしますか？')) {
        currentUser = null;
        myParkingInfo = null;
        showLoginScreen();
    }
}


// =================================================================================
// 画面表示の制御
// =================================================================================
function showLoginScreen() {
    loginScreen.classList.remove('hidden');
    mainSystem.classList.add('hidden');
}

function showMainSystem() {
    loginScreen.classList.add('hidden');
    mainSystem.classList.remove('hidden');
    initializeSystem();
}

async function initializeSystem() {
    if (!currentUser) return;

    document.getElementById('userInfo').textContent = `ようこそ、${currentUser.name} さん`;
    
    try {
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();
    } catch (error) {
        showError('駐車データの取得に失敗しました。');
    }
}


// =================================================================================
// 駐車場関連の処理
// =================================================================================
function renderParkingLots() {
    const container = document.getElementById('parkingLots');
    if(!container) return;
    container.innerHTML = '';
    parkingData.forEach(lot => {
        const availableCount = lot.available;
        const statusClass = getStatusClass(availableCount, lot.capacity);
        const statusText = getStatusText(availableCount, lot.capacity);
        const lotElement = document.createElement('div');
        lotElement.className = 'parking-lot';
        lotElement.onclick = () => showLotDetail(lot.id);
        lotElement.innerHTML = `
            <div class="lot-header ${statusClass}">
                <span>${lot.name}</span>
                <span>${statusText}</span>
            </div>
            <div class="lot-info">
                <div class="capacity-text">
                    空き: <span style="font-size: 1.5em;">${availableCount}</span> / ${lot.capacity}台
                </div>
                <div class="lot-actions">
                    <button class="detail-btn">詳細を見る</button>
                </div>
            </div>
        `;
        container.appendChild(lotElement);
    });
}

function showLotDetail(lotId) {
    const lot = parkingData.find(l => l.id === lotId);
    if (!lot) return;

    const modal = document.getElementById('lotDetailModal');
    const modalTitle = document.getElementById('lotDetailTitle');
    const parkingMap = document.getElementById('parkingMap');
    const lotImage = document.getElementById('lotDetailImage'); // ★ 画像要素を取得

    modalTitle.textContent = `${lot.name} の状況`;
    parkingMap.innerHTML = '';

    // ★★★ 画像URLを設定する処理を追加 ★★★
    if (lot.imageUrl) {
        lotImage.src = lot.imageUrl;
        lotImage.alt = `${lot.name} の画像`;
        lotImage.parentElement.style.display = 'flex'; // 画像コンテナを表示
        lotImage.onclick = () => openImageZoomModal(lot.imageUrl);
    } else {
        lotImage.parentElement.style.display = 'none'; // 画像URLがなければ非表示
        lotImage.onclick = null;
    }
    // ★★★ 画像処理ここまで ★★★

    lot.spaces.forEach(space => {
        const spaceElement = document.createElement('div');
        spaceElement.className = 'parking-space';
        
        const isMyCar = myParkingInfo && myParkingInfo.lot_id === lotId && myParkingInfo.space_id === space.id;

        if (isMyCar) {
            // --- 自分の車 ---
            spaceElement.classList.add('space-my-car');
            const endTime = myParkingInfo.estimated_end_time; // 自分の時刻情報を取得
            // innerHTMLを使って2行表示に変更
            spaceElement.innerHTML = `<span>${space.id}</span><span class="space-time">${endTime ? endTime : 'My Car'}</span>`;
            spaceElement.onclick = () => processSpaceCheckout();

        } else if (space.isParked) {
            // --- 他人の車 ---
            spaceElement.classList.add('space-occupied');
            const endTime = space.endTime; // バックエンドから受け取った時刻
            if (endTime) {
                // 時刻があれば、innerHTMLで2行表示に変更
                spaceElement.innerHTML = `<span>${space.id}</span><span class="space-time">${endTime}</span>`;
            } else {
                // 時刻がなければ(例: "未定"でもない場合)、番号だけ表示
                spaceElement.textContent = space.id;
            }

        } else {
            // --- 空きスペース --- (変更なし)
            spaceElement.classList.add('space-available');
            spaceElement.textContent = space.id;
            spaceElement.onclick = () => {
                if (myParkingInfo) {
                    showNotification('既に駐車済みです。出庫してから再度お試しください。', 'error');
                } else {
                    openEndTimeModal(lot.id, space.id);
                }
            };
        }
        parkingMap.appendChild(spaceElement);
    });

    modal.style.display = 'block';
}function updateStats() {
    const totals = parkingData.reduce((acc, lot) => {
        acc.capacity += lot.capacity;
        acc.available += lot.available;
        return acc;
    }, { capacity: 0, available: 0 });

    const occupancyRate = totals.capacity > 0 ? Math.round(((totals.capacity - totals.available) / totals.capacity) * 100) : 0;
    document.getElementById('totalSpaces').textContent = totals.capacity;
    document.getElementById('availableSpaces').textContent = totals.available;
    document.getElementById('occupancyRate').textContent = `${occupancyRate}%`;
    document.getElementById('lastUpdated').textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP')}`;
}

function displayMyParkingStatus() {
    const statusDiv = document.getElementById('myParkingStatus');
    if (myParkingInfo) {
        const parkedLot = parkingData.find(l => l.id === myParkingInfo.lot_id);
        if (parkedLot) {
            const elapsedTime = getElapsedTime(myParkingInfo.start_time);
// 1. データベースから来た時刻情報(estimated_end_time)をチェック
        const endTimeDisplay = myParkingInfo.estimated_end_time 
            ? `<p><strong>退庫予定:</strong> ${myParkingInfo.estimated_end_time}</p>` 
            : ''; // 時刻がなければ(または"未定"でも)そのまま表示、nullなら何も表示しない

        statusDiv.innerHTML = `
            <div class="my-status-card">
                <h4>現在の駐車状況</h4>
                <p><strong>場所:</strong> ${parkedLot.name} (${myParkingInfo.space_id})</p>
                
                ${endTimeDisplay} <p><strong>経過時間:</strong> ${elapsedTime}</p> <button class="checkout-btn" onclick="processSpaceCheckout()">ここから出庫</button>
            </div>
        `;
            statusDiv.classList.remove('hidden');
        }
    } else {
        statusDiv.classList.add('hidden');
    }
}

async function processSpaceCheckin(lotId, spaceId, endTimeToSend) {
    if (!currentUser) return showNotification('ログイン情報が見つかりません。', 'error');
    if (myParkingInfo) {
        return showNotification('既に駐車済みです。出庫してから再度お試しください。', 'error');
    }

    // ★ promptのロジックはここから削除されました ★

    try {
        const newParkingInfo = await apiRequest('/api/parking/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.studentId,
                lotId: lotId,
                spaceId: spaceId,
                endTime: endTimeToSend // ★ 引数で受け取った時刻/未定を送信
            })
        });

        myParkingInfo = newParkingInfo;
        showNotification(`${lotId}の${spaceId}に駐車登録しました。`, 'success');

        // データを再取得してUIを更新
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();
        closeDetailModal(); // 詳細モーダルも閉じる
        closeEndTimeModal(); // ★ 新しい時刻モーダルも閉じる

    } catch (error) {
        // apiRequest関数でエラーが表示されるので、ここでは何もしない
    }
}

async function processSpaceCheckout() {
    if (!confirm('本当に退庫しますか？')) return;

    try {
        await apiRequest('/api/parking/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.studentId })
        });
        showNotification('出庫しました。', 'success');
        myParkingInfo = null;
        
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();
        closeDetailModal();
    } catch (error) {}
}


// =================================================================================
// ヘルパー関数
// =================================================================================
function getStatusClass(available, capacity) { if (available === 0) return 'full'; const rate = available / capacity; if (rate > 0.3) return 'available'; return 'limited'; }
function getStatusText(available, capacity) { if (available === 0) return '満車'; const rate = available / capacity; if (rate > 0.3) return '空きあり'; return '残りわずか'; }
function closeDetailModal() { const modal = document.getElementById('lotDetailModal'); if (modal) modal.style.display = 'none'; }
function getElapsedTime(startTime) { const diffMinutes = Math.floor((new Date() - new Date(startTime)) / 60000); const hours = Math.floor(diffMinutes / 60); const minutes = diffMinutes % 60; return `${hours > 0 ? hours + '時間' : ''} ${minutes}分`; }

function showNotification(message, type = 'success') {
    const oldNotification = document.querySelector('.notification');
    if (oldNotification) oldNotification.remove();

    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.textContent = message;
    document.body.appendChild(div);

    setTimeout(() => div.classList.add('show'), 10);
    setTimeout(() => {
        div.classList.remove('show');
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

function refreshUI() { renderParkingLots(); updateStats(); displayMyParkingStatus(); }


// =================================================================================
// 退庫予定時刻モーダル関連の関数
// =================================================================================

// 時刻モーダルを開く
function openEndTimeModal(lotId, spaceId) {
    const modal = document.getElementById('endTimeModal');
    const title = document.getElementById('endTimeModalTitle');
    const timeInput = document.getElementById('endTimeInput');

    // 現在時刻をデフォルト値として設定
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    timeInput.value = `${hours}:${minutes}`;

    title.textContent = `${lotId} の ${spaceId}番 に駐車`;

    // ★ OKボタンに、クリックされた場所の情報を一時的に保存
    const submitBtn = document.getElementById('endTimeSubmitBtn');
    submitBtn.dataset.lotId = lotId;
    submitBtn.dataset.spaceId = spaceId;

    modal.style.display = 'block';
}

// 時刻モーダルを閉じる
function closeEndTimeModal() {
    const modal = document.getElementById('endTimeModal');
    modal.style.display = 'none';
}

// 時刻モーダルの「OK」または「未定」が押されたときの処理
function handleEndTimeSubmit(isUncertain = false) {
    const submitBtn = document.getElementById('endTimeSubmitBtn');
    const lotId = submitBtn.dataset.lotId;
    const spaceId = submitBtn.dataset.spaceId;

    let endTimeToSend;
    if (isUncertain) {
        endTimeToSend = "未定";
    } else {
        const timeInput = document.getElementById('endTimeInput');
        if (timeInput.value === "") {
            showNotification('時刻が入力されていません。「予定は未定」を押してください。', 'error');
            return;
        }
        endTimeToSend = timeInput.value;
    }

    // サーバーに送信する処理を呼び出す
    processSpaceCheckin(lotId, spaceId, endTimeToSend);
}

// =================================================================================
// アプリケーション起動時の処理
// =================================================================================
document.addEventListener('DOMContentLoaded', () => {
    // ログイン画面を初期表示
    showLoginScreen();

    // ----- ここからが新しいイベントリスナーの設定 -----

    // ★ フォーム要素を取得
    const loginForm = document.getElementById('loginMode');
    const registerForm = document.getElementById('registerMode');

    // ★ リンク要素を取得
    const switchToRegisterLink = document.getElementById('switchToRegisterLink');
    const switchToLoginLink = document.getElementById('switchToLoginLink');
    
    // ★ ログアウトボタンとモーダルクローズボタンを取得
    const logoutButton = document.querySelector('.logout-btn');
    const closeModalButton = document.querySelector('.close');

    const closeEndTimeModalBtn = document.getElementById('closeEndTimeModal');
    const endTimeSubmitBtn = document.getElementById('endTimeSubmitBtn');
    const endTimeUncertainBtn = document.getElementById('endTimeUncertainBtn');


    // ★ イベントリスナーを設定
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    if (switchToRegisterLink) {
        switchToRegisterLink.addEventListener('click', (event) => {
            event.preventDefault(); // リンクの標準動作を止める
            switchToRegister();
        });
    }
    if (switchToLoginLink) {
        switchToLoginLink.addEventListener('click', (event) => {
            event.preventDefault(); // リンクの標準動作を止める
            switchToLogin();
        });
    }
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
    if (closeModalButton) {
        closeModalButton.addEventListener('click', closeDetailModal);
    }
    if (closeEndTimeModalBtn) {
        closeEndTimeModalBtn.addEventListener('click', closeEndTimeModal);
    }
    if (endTimeSubmitBtn) {
        endTimeSubmitBtn.addEventListener('click', () => handleEndTimeSubmit(false)); // OKボタン
    }
    if (endTimeUncertainBtn) {
        endTimeUncertainBtn.addEventListener('click', () => handleEndTimeSubmit(true)); // 未定ボタン
    }
});
// --- 画像拡大モーダル関連関数 ---
function openImageZoomModal(imageUrl) {
    const imageZoomModal = document.getElementById('imageZoomModal');
    const zoomedImage = document.getElementById('zoomedImage');

    zoomedImage.src = imageUrl;
    imageZoomModal.style.display = 'block'; // 拡大モーダルを表示
}

function closeImageZoomModal() {
    const imageZoomModal = document.getElementById('imageZoomModal');
    imageZoomModal.style.display = 'none'; // 拡大モーダルを非表示
    // zoomedImage.src = ''; // メモリ節約のため画像をリセット (任意)
}

// --- DOMContentLoaded内のイベントリスナーに閉じるボタンを追加 ---
document.addEventListener('DOMContentLoaded', () => {
    // ... 既存のイベントリスナー ...

    // ★★★ この行を追加: 拡大モーダルの閉じるボタンのイベントリスナー ★★★
    const closeZoomModalButton = document.querySelector('.close-zoom-modal');
    if (closeZoomModalButton) {
        closeZoomModalButton.addEventListener('click', closeImageZoomModal);
    }

    const closeEndTimeModalBtn = document.getElementById('closeEndTimeModal');
    if (closeEndTimeModalBtn) {
        closeEndTimeModalBtn.addEventListener('click', closeEndTimeModal);
    }

    const endTimeSubmitBtn = document.getElementById('endTimeSubmitBtn');
    if (endTimeSubmitBtn) {
        endTimeSubmitBtn.addEventListener('click', () => handleEndTimeSubmit(false));
    }

    const endTimeUncertainBtn = document.getElementById('endTimeUncertainBtn');
    if (endTimeUncertainBtn) {
        endTimeUncertainBtn.addEventListener('click', () => handleEndTimeSubmit(true));
    }
});
