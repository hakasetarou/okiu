// public/script.js

const API_BASE_URL = 'http://localhost:3000';

// =================================================================================
// グローバル変数 (変更なし)
// =================================================================================
let parkingData = [];
let currentUser = null;
let myParkingInfo = null;

// =================================================================================
// 画面要素の取得 (変更なし)
// =================================================================================
const loginScreen = document.getElementById('loginScreen');
const mainSystem = document.getElementById('mainSystem');
let loginForm, registerForm; // DOM読み込み後に取得するため、宣言のみ
const errorMessage = document.getElementById('errorMessage');

// =================================================================================
// API通信関連の関数 (変更なし)
// =================================================================================
async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(API_BASE_URL + url, options);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            return response.json();
        } else {
            return {};
        }
    } catch (error) {
        console.error('API Request Error:', error);
        showError(error.message);
        throw error;
    }
}

// =================================================================================
// ログイン・新規登録・ログアウト関連の処理 (変更なし)
// =================================================================================
function switchAuthMode(mode) {
    hideError();
    if (mode === 'register') {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    } else {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    }
}
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}
function hideError() {
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
}
async function handleRegister(event) {
    event.preventDefault();
    const studentId = document.getElementById('registerStudentId').value.trim();
    const name = document.getElementById('registerName').value.trim();
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
    if (!studentId || !name || !password) return showError('すべての項目を入力してください。');
    if (password !== passwordConfirm) return showError('パスワードが一致しません。');
    try {
        await apiRequest('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId, name, password })
        });
        alert('新規登録が完了しました。ログインしてください。');
        switchAuthMode('login');
    } catch (error) {}
}
async function handleLogin() {
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
        parkingData = [];
        showLoginScreen();
    }
}
// =================================================================================
// 画面表示の制御 (一部変更)
// =================================================================================
function showLoginScreen() {
    mainSystem.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    // フォームが取得済みなら表示をリセット
    if (loginForm && registerForm) {
        switchAuthMode('login');
    }
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
// 駐車場関連の処理 (変更なし)
// =================================================================================
function renderParkingLots() {
    const lotsContainer = document.getElementById('parkingLotList');
    if (!lotsContainer) return; // 要素がなければ処理を中断

    lotsContainer.innerHTML = ''; // 表示エリアを一度空にする

    if (!parkingData || parkingData.length === 0) {
        lotsContainer.innerHTML = '<p>駐車場データがありません。サーバーからデータを取得できませんでした。</p>';
        return;
    }

    // 取得した駐車場データ一つひとつに対してHTML要素を生成する
    parkingData.forEach(lot => {
        const statusClass = getStatusClass(lot.available, lot.capacity);
        const statusText = getStatusText(lot.available, lot.capacity);

        const lotElement = document.createElement('div');
        lotElement.className = `parking-lot-item ${statusClass}`;
        lotElement.innerHTML = `
            <h3>${lot.name}</h3>
            <p>空き状況: <span class="status-text">${statusText}</span></p>
            <p class="lot-stats">(${lot.available} / ${lot.capacity}台)</p>
        `;
        
        // 各駐車場要素にクリックイベントを追加
        lotElement.addEventListener('click', () => showLotDetail(lot.id));
        
        // 生成したHTMLを画面に追加
        lotsContainer.appendChild(lotElement);
    });
}
function showLotDetail(lotId) {
    // クリックされた駐車場の完全なデータをparkingDataの中から探す
    const lot = parkingData.find(p => p.id === lotId);
    if (!lot) {
        console.error('指定された駐車場が見つかりません:', lotId);
        return;
    }

    // モーダルウィンドウのHTML要素を取得
    const modal = document.getElementById('lotDetailModal');
    const modalTitle = document.getElementById('lotDetailTitle');
    const parkingMap = document.getElementById('parkingMap');

    // モーダルのタイトルを更新
    modalTitle.textContent = `${lot.name} の駐車状況`;

    // 古いマップが残っていたら消去する
    parkingMap.innerHTML = '';

    // スペース情報(spaces配列)を元に、駐車スペースのマス目を1つずつ生成
lot.spaces.forEach(space => {
    const spaceElement = document.createElement('div');
    spaceElement.className = 'parking-space';
    spaceElement.textContent = space.id;

    // 駐車中かどうかでスタイルを分ける
    if (space.isParked) {
        spaceElement.classList.add('parked');
    } else {
        // ★★★★★ ここから追加 ★★★★★
        // 空いているスペースの場合のみ、クリックイベントを追加する
        spaceElement.addEventListener('click', () => {
            processSpaceCheckin(lot.id, space.id);
        });
        // ★★★★★ ここまで追加 ★★★★★
    }

    // 生成したマス目をマップに追加
    parkingMap.appendChild(spaceElement);
});    // 全ての準備が整ったら、モーダルを表示する
    modal.style.display = 'block';
}
function updateStats() {
    // HTMLから統計情報を表示するための要素を取得
    const totalSpacesEl = document.getElementById('totalSpaces');
    const availableSpacesEl = document.getElementById('availableSpaces');
    const occupancyRateEl = document.getElementById('occupancyRate');
    const lastUpdatedEl = document.getElementById('lastUpdated');

    // データの準備ができていなければ、何もせずに終了
    if (!parkingData || parkingData.length === 0) return;

    // ----- 統計情報の計算 -----
    // 1. reduceメソッドを使って、全駐車場の総台数と総空き台数を一度に計算する
    const totals = parkingData.reduce((acc, lot) => {
        acc.capacity += lot.capacity;
        acc.available += lot.available;
        return acc;
    }, { capacity: 0, available: 0 }); // 初期値

    const totalCapacity = totals.capacity;
    const totalAvailable = totals.available;

    // 2. 使用率を計算する (0で割らないように注意)
    const occupancyRate = totalCapacity > 0 
        ? Math.round(((totalCapacity - totalAvailable) / totalCapacity) * 100)
        : 0;

    // 3. 最終更新時刻をフォーマットする
    const now = new Date();
    const lastUpdatedText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // ----- 計算結果を画面に反映 -----
    totalSpacesEl.textContent = totalCapacity;
    availableSpacesEl.textContent = totalAvailable;
    occupancyRateEl.textContent = `${occupancyRate}%`;
    lastUpdatedEl.textContent = `最終更新: ${lastUpdatedText}`;
}
function displayMyParkingStatus() {
    const statusContainer = document.getElementById('myParkingStatus');
    if (!statusContainer) return;

    if (myParkingInfo) {
        // 駐車している場合
        const lot = parkingData.find(p => p.id === myParkingInfo.lot_id);
        const lotName = lot ? lot.name : '不明';
        const elapsedTime = getElapsedTime(myParkingInfo.start_time);

        statusContainer.innerHTML = `
            <div class="my-status-card">
                <h4>現在の駐車状況</h4>
                <p><strong>場所:</strong> ${lotName} - ${myParkingInfo.space_id}番</p>
                <p><strong>経過時間:</strong> ${elapsedTime}</p>
                <button id="checkoutButton" class="checkout-btn">退庫する</button>
            </div>
        `;
        statusContainer.classList.remove('hidden');

        // 今生成した「退庫する」ボタンにイベントを設定
        document.getElementById('checkoutButton').addEventListener('click', processSpaceCheckout);
    } else {
        // 駐車していない場合
        statusContainer.innerHTML = '';
        statusContainer.classList.add('hidden');
    }
}
async function processSpaceCheckin(lotId, spaceId) {
    if (!currentUser) return alert('ログイン情報が見つかりません。');

    // 自分が既に駐車しているか確認
    if (myParkingInfo) {
        return alert(`既に ${myParkingInfo.lotId} の ${myParkingInfo.spaceId}番 に駐車済みです。`);
    }

    if (!confirm(`${lotId} の ${spaceId}番 に駐車しますか？`)) {
        return; // キャンセルされたら何もしない
    }

    try {
        // STEP 1で作ったAPIを呼び出す
        const newParkingInfo = await apiRequest('/api/parking/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.studentId, // ログイン中のユーザーID
                lotId: lotId,
                spaceId: spaceId
            })
        });

        // 成功したら、自分の駐車情報を更新
        myParkingInfo = newParkingInfo;
       showNotification('駐車が完了しました。');

        // モーダルを閉じて、画面全体を最新の状態に更新
        closeDetailModal();
        // データを再取得してUIを更新
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();

    } catch (error) {
        // バックエンドから送られてきたエラーメッセージをそのまま表示
        showNotification(`エラー: ${error.message}`, 'error');
    }
}
async function processSpaceCheckout() {
    if (!currentUser || !myParkingInfo) {
        return alert('駐車情報が見つかりません。');
    }

    if (!confirm('本当に退庫しますか？')) {
        return;
    }

    try {
        // STEP 1で作ったAPIを呼び出す
        await apiRequest('/api/parking/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.studentId })
        });

showNotification('退庫が完了しました。');

        // 自分の駐車情報をリセット
        myParkingInfo = null;
        // データを再取得して画面全体を更新
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();

    } catch (error) {
showNotification(`エラー: ${error.message}`, 'error');
    }
}
function getStatusClass(available, capacity) { if (available === 0) return 'full'; const rate = available / capacity; if (rate > 0.3) return 'available'; return 'limited'; }
function getStatusText(available, capacity) { if (available === 0) return '満車'; const rate = available / capacity; if (rate > 0.3) return '空きあり'; return '残りわずか'; }
function closeDetailModal() { const modal = document.getElementById('lotDetailModal'); if (modal) modal.style.display = 'none'; }
function getElapsedTime(startTime) { const diffMinutes = Math.floor((new Date() - new Date(startTime)) / 60000); const hours = Math.floor(diffMinutes / 60); const minutes = diffMinutes % 60; return `${hours > 0 ? hours + '時間' : ''} ${minutes}分`; }
function showNotification(message, type = 'success') { // 'success' or 'error'
    const container = document.getElementById('notification-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`; // 成功かエラーかでクラスを分ける
    toast.textContent = message;

    container.appendChild(toast);

    // 3秒後に通知を自動で消す
    setTimeout(() => {
        toast.remove();
    }, 3000);
}function refreshUI() {
    if (!currentUser) return; // ログイン状態でなければ何もしない

    renderParkingLots();      // 駐車場一覧を描画
    displayMyParkingStatus(); // 自分の駐車状況を更新 (この関数は後で実装)
    updateStats();            // 全体の統計情報を更新 (この関数は後で実装)
}


// =================================================================================
// ★★★★★ 修正箇所: アプリケーション起動時の処理 ★★★★★
// =================================================================================
document.addEventListener('DOMContentLoaded', () => {
    // --- 要素の取得 ---
    loginForm = document.getElementById('loginForm');
    registerForm = document.getElementById('registerForm');
    const switchToRegisterLink = document.getElementById('switchToRegisterLink');
    const switchToLoginLink = document.getElementById('switchToLoginLink');
    const logoutButton = document.getElementById('logoutButton');
    const closeModalButton = document.getElementById('closeModalButton');

    // --- 画面の初期化 ---
    showLoginScreen();

    // --- イベントリスナーの登録 ---

    // 「新規登録」リンクのクリックイベント
    if (switchToRegisterLink) {
        switchToRegisterLink.addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthMode('register');
        });
    }

    // 「ログイン」リンクのクリックイベント
    if (switchToLoginLink) {
        switchToLoginLink.addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthMode('login');
        });
    }

    // ログインフォームの送信イベント
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleLogin();
        });
    }

    // 新規登録フォームの送信イベント
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
    
    // ログアウトボタンのクリックイベント
    if(logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }

    // モーダルを閉じるボタンのイベント
    if(closeModalButton) {
        closeModalButton.addEventListener('click', closeDetailModal);
    }

    // --- 定期更新処理 ---
    setInterval(async () => {
        if (!mainSystem.classList.contains('hidden') && currentUser) {
            console.log("UIを自動更新します。");
            try {
                parkingData = await apiRequest('/api/parking-data');
                refreshUI();
            } catch (error) {
                console.error("自動更新に失敗:", error);
            }
        }
    }, 30000);
});