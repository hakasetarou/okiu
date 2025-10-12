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
    // ... (この中身は変更なし)
}
function updateStats() {
    // ... (この中身は変更なし)
}
function displayMyParkingStatus() {
    // ... (この中身は変更なし)
}
async function processSpaceCheckin(lotId, spaceId) {
    // ... (この中身は変更なし)
}
async function processSpaceCheckout() {
    // ... (この中身は変更なし)
}
function getStatusClass(available, capacity) { if (available === 0) return 'full'; const rate = available / capacity; if (rate > 0.3) return 'available'; return 'limited'; }
function getStatusText(available, capacity) { if (available === 0) return '満車'; const rate = available / capacity; if (rate > 0.3) return '空きあり'; return '残りわずか'; }
function closeDetailModal() { const modal = document.getElementById('lotDetailModal'); if (modal) modal.style.display = 'none'; }
function getElapsedTime(startTime) { const diffMinutes = Math.floor((new Date() - new Date(startTime)) / 60000); const hours = Math.floor(diffMinutes / 60); const minutes = diffMinutes % 60; return `${hours > 0 ? hours + '時間' : ''} ${minutes}分`; }
function showNotification(message, type) { /* ... (変更なし) ... */ }
function refreshUI() {
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