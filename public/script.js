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

    // ----- バリデーションルール -----
    const studentIdRegex = /^\d{2}[a-z]{2}\d{3}$/i;
    if (!studentIdRegex.test(studentId)) {
        return showError('学籍番号は「数字2桁 + 英字2文字 + 数字3桁」の形式で入力してください。(例: 23db123)');
    }
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!passwordRegex.test(password)) {
        return showError('パスワードは8文字以上の英数字の両方を含めてください。');
    }
    if (password !== passwordConfirm) {
        return showError('パスワードが一致しません。');
    }
    if (!name) {
        return showError('氏名を入力してください。');
    }

    // APIリクエスト
    try {
        await apiRequest('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId, name, password })
        });
        showNotification('新規登録が完了しました。ログインしてください。', 'success');
        switchToLogin();
    } catch (error) {
        // apiRequest関数内でshowErrorが呼ばれる
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
    } catch (error) {
        // apiRequest関数内でshowErrorが呼ばれる
    }
}

function handleLogout() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'block';
}
// 1. モーダルを表示する関数
function openCheckoutModal() {
    const modal = document.getElementById('checkoutModal');
    if (modal) {
        modal.style.display = 'block'; // 画面に出す
    }
}

// 2. モーダルを非表示にする（閉じる）関数
function closeCheckoutModal() {
    const modal = document.getElementById('checkoutModal');
    if (modal) {
        modal.style.display = 'none'; // 画面から消す
    }
}
// 【新規】ログアウトモーダルを閉じる関数
function closeLogoutModal() {
    const modal = document.getElementById('logoutModal');
    if (modal) modal.style.display = 'none';
}

// 【新規】実際にログアウト処理を行う関数（「はい」が押された時）
async function processLogout() {
    // サーバーにログアウト通知を送る（既存の処理と同じ）
    // ※もしセッション管理などをしていないなら、ここは省略しても画面切り替えだけで動きますが、念のため残します
    try {
        /* 必要に応じてAPIリクエストを送る */
        // await apiRequest('/api/logout', { method: 'POST' }); 
    } catch (error) {
        console.error(error);
    }

    // ユーザー情報を消す
    currentUser = null;
    myParkingInfo = null;

    // 画面を切り替える
    showLoginScreen();
    
    // モーダルを閉じる
    closeLogoutModal();
}


// =================================================================================
// 画面表示の制御
// =================================================================================
function showLoginScreen() {
    loginScreen.classList.remove('hidden');
    mainSystem.classList.add('hidden');
    closeDetailModal();     // 詳細モーダルを閉じる
    closeEndTimeModal();    // 時刻入力モーダルを閉じる
    closeImageZoomModal();  // 画像拡大モーダルを閉じる
    closeLogoutModal();
}

function showMainSystem() {
    loginScreen.classList.add('hidden');
    mainSystem.classList.remove('hidden');
    closeDetailModal();     // 詳細モーダルを閉じる
    closeEndTimeModal();    // 時刻入力モーダルを閉じる
    closeImageZoomModal();  // 画像拡大モーダルを閉じる
    closeLogoutModal();
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
// 駐車場関連の処理 (テンプレート利用版：HTMLタグなし)
// =================================================================================
async function renderParkingLots() {
    const container = document.getElementById('parkingLots');
    const template = document.getElementById('parking-card-template'); 
    
    if(!container || !template) return;
    
    container.innerHTML = ''; // 画面クリア

    // --- ★★★ ここから追加：A案（満車を沈める）のロジック ★★★ ---
    const availableLots = []; // 空きがある駐車場を入れる箱
    const fullLots = [];      // 満車の駐車場を入れる箱

    // 1. 駐車場を「空きあり」と「満車」に仕分ける
    parkingData.forEach(lot => {
        if (lot.available <= 0) {
            fullLots.push(lot); // 満車ならこっち
        } else {
            availableLots.push(lot); // 空きがあればこっち
        }
    });

    // 2. 空きありのグループの後に、満車のグループをくっつける
    const sortedParkingData = [...availableLots, ...fullLots];
    // --- ★★★ 追加ここまで ★★★ ---


    // 3. 並び替えたデータ（sortedParkingData）を使って画面を作る
    sortedParkingData.forEach(lot => {
        // 設計図（テンプレート）を複製する
        const clone = template.content.cloneNode(true);
        const cardElement = clone.querySelector('.parking-lot'); 

        // --- 計算ロジック ---
        const used = lot.capacity - lot.available;
        let percentage = Math.round((used / lot.capacity) * 100);
        if (isNaN(percentage)) percentage = 0;

        // --- 色とテキストの決定 ---
        let headerColorClass = 'header-green';
        let barColorClass = 'bg-green';
        let statusText = '空きあり';

        if (percentage >= 100) {
            headerColorClass = 'header-red';
            barColorClass = 'bg-red';
            statusText = '満車';
            // 満車時の半透明処理
            cardElement.style.opacity = '0.5'; 
            cardElement.style.filter = 'grayscale(30%)';
        } else if (percentage >= 80) {
            headerColorClass = 'header-orange';
            barColorClass = 'bg-orange';
            statusText = '残りわずか';
        }

        // --- 複製した設計図に、データを埋め込む ---
        
        // ヘッダーの色設定
        const header = clone.querySelector('.card-header');
        header.classList.add(headerColorClass);

        // 駐車場名と状態
        clone.querySelector('.lot-name').textContent = lot.name;
        clone.querySelector('.lot-status').textContent = statusText;

        // 台数情報
        clone.querySelector('.available-text').textContent = `空き: ${lot.available}台`;
        clone.querySelector('.total-text').textContent = `総数: ${lot.capacity}台`;

// ★ プログレスバー（bar）の設定
        const bar = clone.querySelector('.progress-bar');
        bar.style.width = `${percentage}%`;
        bar.textContent = `${percentage}% 使用中`;
        bar.classList.add(barColorClass);

        // =========================================================
        // 【1 と 3 の実装】カード自体へのクリックを無効にし、2つのボタンを追加する
        // =========================================================
        cardElement.style.cursor = 'default'; // カード全体は押せないようにする
        
        // ボタンを入れる箱（コンテナ）を作る
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'card-actions';

const mapBtn = document.createElement('button');
        mapBtn.className = 'action-btn btn-map';
        mapBtn.innerHTML = '🗺️ マップから探す';
        mapBtn.onclick = (e) => {
            e.stopPropagation(); 
            
            // データベースから取得した画像URL（lot.imageUrl）を使用する
            // もし画像URLが設定されていない場合の保険としてフォールバックも用意します
            const imgSrc = lot.imageUrl ? lot.imageUrl : `images/img${lot.id}.jpg`;
            openInteractiveMap(lot.id, imgSrc); 
        };

        // 🔢 番号から探すボタン（※機能3：以前のリスト方式）
        const numberBtn = document.createElement('button');
        numberBtn.className = 'action-btn btn-number';
        numberBtn.innerHTML = '🔢 番号から探す';
        numberBtn.onclick = (e) => {
            e.stopPropagation();
            
            // 従来の「四角いマス目が並んだ詳細画面」を開く
            showLotDetail(lot.id);
        };

        // 箱に2つのボタンを入れて、カードの最後に追加する
        actionsContainer.appendChild(mapBtn);
        actionsContainer.appendChild(numberBtn);
        cardElement.appendChild(actionsContainer);
        // =========================================================
        
        // --- 完成したカードを画面に追加 ---
        container.appendChild(clone);
    });
}

function showLotDetail(lotId) {
    const lot = parkingData.find(l => l.id === lotId);
    if (!lot) return;

    const modal = document.getElementById('lotDetailModal');
    const modalTitle = document.getElementById('lotDetailTitle');
    const parkingMap = document.getElementById('parkingMap');
    const lotImage = document.getElementById('lotDetailImage');

    modalTitle.textContent = `${lot.name} の状況`;
    parkingMap.innerHTML = '';

    if (lot.imageUrl) {
        lotImage.src = lot.imageUrl;
        lotImage.alt = `${lot.name} の画像`;
        lotImage.parentElement.style.display = 'flex';
        lotImage.onclick = () => openImageZoomModal(lot.imageUrl);
    } else {
        lotImage.parentElement.style.display = 'none';
        lotImage.onclick = null;
    }

    lot.spaces.forEach(space => {
        const spaceElement = document.createElement('div');
        spaceElement.className = 'parking-space';
        
        const isMyCar = myParkingInfo && myParkingInfo.lot_id === lotId && myParkingInfo.space_id === space.id;

        if (isMyCar) {
            spaceElement.classList.add('space-my-car');
            const endTime = myParkingInfo.estimated_end_time;
            spaceElement.innerHTML = `<span>${space.id}</span><span class="space-time">${endTime ? endTime : 'My Car'}</span>`;
            spaceElement.onclick = () => processSpaceCheckout();

        } else if (space.isParked) {
            spaceElement.classList.add('space-occupied');
            const endTime = space.endTime;
            if (endTime) {
                spaceElement.innerHTML = `<span>${space.id}</span><span class="space-time">${endTime}</span>`;
            } else {
                spaceElement.textContent = space.id;
            }

        } else {
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
}

function updateStats() {
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
            
            // 短いテキストに変更
            const endTimeDisplay = myParkingInfo.estimated_end_time 
                ? `<span>予定: ${myParkingInfo.estimated_end_time}</span>` 
                : '';

            // ★ここから新しいコンパクトなHTML構造★
            statusDiv.innerHTML = `
                <div class="my-status-compact">
                    <div class="my-status-details">
                        <div class="my-status-title">
                            <span class="pulse-dot"></span> 駐車中: ${parkedLot.name} (${myParkingInfo.space_id})
                        </div>
                        <div class="my-status-time">
                            ${endTimeDisplay}
                            <span>経過: ${elapsedTime}</span>
                        </div>
                    </div>
                    <button class="checkout-btn" id="mainCheckoutButton">出庫する</button>
                </div>
            `;

            const checkoutBtn = document.getElementById('mainCheckoutButton');
            if (checkoutBtn) {
                checkoutBtn.addEventListener('click', processSpaceCheckout);
            }

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

    try {
        const newParkingInfo = await apiRequest('/api/parking/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.studentId,
                lotId: lotId,
                spaceId: spaceId,
                endTime: endTimeToSend
            })
        });

        myParkingInfo = newParkingInfo;
        showNotification(`${lotId}の${spaceId}に駐車登録しました。`, 'success');

        parkingData = await apiRequest('/api/parking-data');
        refreshUI();
        closeDetailModal();
        closeEndTimeModal();

    } catch (error) {
        // apiRequest関数でエラーが表示される
    }
}

// 【変更】ボタンが押されたら、いきなり処理せず「モーダルを開く」だけにする
function processSpaceCheckout() {
    // 以前の confirm('本当に退庫しますか？') は削除！
    openCheckoutModal(); 
}

// 【新規】モーダルの「退庫する」が押された時に実行される関数
async function executeCheckout() {
    try {
        // サーバーに「退庫します」と伝える（既存の処理と同じ）
        await apiRequest('/api/parking/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.studentId })
        });
        
        showNotification('出庫しました。', 'success');
        myParkingInfo = null; // 自分の情報をクリア
        
        // 画面の数字などを最新にする
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();
        
        // 開いているモーダルをすべて閉じる
        closeDetailModal();
        closeCheckoutModal(); // ★ここが重要！

    } catch (error) {
        // エラーは apiRequest 内で表示されるので、ここでは何もしない（ログだけ）
        console.error(error);
    }
}



// =================================================================================
// ヘルパー関数 (変更なし)
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

// 画像拡大モーダル関連の関数

// =================================================================================

function openImageZoomModal(imageUrl) {

    const imageZoomModal = document.getElementById('imageZoomModal');

    const zoomedImage = document.getElementById('zoomedImage');



    zoomedImage.src = imageUrl;

    imageZoomModal.style.display = 'block'; // 拡大モーダルを表示

}



function closeImageZoomModal() {

    const imageZoomModal = document.getElementById('imageZoomModal');

    imageZoomModal.style.display = 'none'; // 拡大モーダルを非表示

}



// =================================================================================

// ★★★★★ アプリケーション起動時の処理 (最終・完成版) ★★★★★

// =================================================================================

document.addEventListener('DOMContentLoaded', () => {

    // ログイン画面を初期表示

    showLoginScreen();



    // ----- 1. フォームの「送信(submit)」イベント（エンターキー対応） -----

    const loginForm = document.getElementById('loginMode');

    if (loginForm) {

        loginForm.addEventListener('submit', handleLogin);

    }

    const registerForm = document.getElementById('registerMode');

    if (registerForm) {

        registerForm.addEventListener('submit', handleRegister);

    }



    // ★★★★★ 2. ログイン/登録切り替えリンク (ここが修正・追加箇所) ★★★★★

    const switchToRegisterLink = document.getElementById('switchToRegisterLink');

    if (switchToRegisterLink) {

        switchToRegisterLink.addEventListener('click', (event) => {

            event.preventDefault(); // リンクの標準動作を防ぐ

            switchToRegister();

        });

    }

    const switchToLoginLink = document.getElementById('switchToLoginLink');

    if (switchToLoginLink) {

        switchToLoginLink.addEventListener('click', (event) => {

            event.preventDefault(); // リンクの標準動作を防ぐ

            switchToLogin();

        });

    }



    // ----- 3. メインシステムのボタン -----

    const logoutButton = document.querySelector('.logout-btn');

    if (logoutButton) {

        logoutButton.addEventListener('click', handleLogout);

    }



    // ----- 4. 詳細モーダルの閉じるボタン -----

    const closeDetailModalButton = document.querySelector('#lotDetailModal .close');

    if (closeDetailModalButton) {

        closeDetailModalButton.addEventListener('click', closeDetailModal);

    }

    

    // ----- 5. 画像拡大モーダルの閉じるボタン -----

    const closeZoomModalButton = document.querySelector('.close-zoom-modal');

    if (closeZoomModalButton) {

        closeZoomModalButton.addEventListener('click', closeImageZoomModal);

    }



    // ----- 6. 時刻入力モーダルのボタン -----

    const closeEndTimeModalBtn = document.getElementById('closeEndTimeModal');

    if (closeEndTimeModalBtn) {

        closeEndTimeModalBtn.addEventListener('click', closeEndTimeModal);

    }

    const endTimeSubmitBtn = document.getElementById('endTimeSubmitBtn');

    if (endTimeSubmitBtn) {

        endTimeSubmitBtn.addEventListener('click', () => handleEndTimeSubmit(false)); // OKボタン

    }

    const endTimeUncertainBtn = document.getElementById('endTimeUncertainBtn');

    if (endTimeUncertainBtn) {

        endTimeUncertainBtn.addEventListener('click', () => handleEndTimeSubmit(true)); // 未定ボタン

    }
    // ログアウト確認モーダルの「ログアウト（はい）」ボタン
    const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');
    if (confirmLogoutBtn) {
        confirmLogoutBtn.addEventListener('click', processLogout);
    }

    // ログアウト確認モーダルの「キャンセル（いいえ）」ボタン
    const cancelLogoutBtn = document.getElementById('cancelLogoutBtn');
    if (cancelLogoutBtn) {
        cancelLogoutBtn.addEventListener('click', closeLogoutModal);
    }
    // ----- 7. 退庫確認モーダルのボタン設定 (ここを追加) -----
    
    // 「退庫する」ボタンの設定
    const confirmCheckoutBtn = document.getElementById('confirmCheckoutBtn');
    if (confirmCheckoutBtn) {
        // クリックされたら、さっき作った「実行関数」を呼ぶ
        confirmCheckoutBtn.addEventListener('click', executeCheckout);
    }

    // 「キャンセル」ボタンの設定
    const cancelCheckoutBtn = document.getElementById('cancelCheckoutBtn');
    if (cancelCheckoutBtn) {
        // クリックされたら、「閉じる関数」を呼ぶ
        cancelCheckoutBtn.addEventListener('click', closeCheckoutModal);
    }

});
// =================================================================================
// ★★★ A案：エリア選択 ＆ 空きスペース自動割り当て機能 ★★★
// =================================================================================

// 1. Claudeで作った多角形の座標データ
const PARKING_AREAS = [
  { id: 1, name: "エリアA", polygon: [[480,200], [368,335], [573,521], [708,372], [481,199]]},
  { id: 2, name: "エリアA2", polygon: [[347,362], [195,527], [395,785], [572,542], [347,356]] },
  { id: 3, name: "エリアA3", polygon: [[445,720], [771,264], [897,407], [561,805], [446,720]] },
  { id: 4, name: "エリアA4", polygon: [[728,212], [477,2], [404,87], [679,307], [732,206]] },
  { id: 5, name: "エリアA5", polygon: [[384,102], [99,474], [179,525], [474,167], [386,99]] }
];

// =================================================================================
// ★★★ ドリルダウン型：マップ展開 ＆ 個別マスタップ機能 ★★★
// =================================================================================

// 1. 各駐車場の座標データを一元管理するオブジェクト
const PARKING_SPOTS_DATA = {
    // 修正ポイント：キーを数値の 5 ではなく、文字列の "lot-5" に変更します！
    "lot-5": [
        // 取得した第5駐車場の1番マスの完璧な座標
{ id: 1, name: "1", polygon: [[81.998,35.292], [82.597,41.247], [88.582,47.423], [88.383,41.688]] },
  { id: 2, name: "2", polygon: [[82.397,41.468], [82.397,46.761], [88.582,53.158], [88.383,47.423]] },
  { id: 3, name: "3", polygon: [[82.597,46.982], [79.804,49.85], [85.989,56.026], [88.582,52.938]] },
  { id: 4, name: "4", polygon: [[80.003,49.85], [77.609,52.496], [83.794,58.672], [85.989,56.026]] },
  { id: 5, name: "5", polygon: [[77.609,52.643], [75.016,55.731], [81.001,61.687], [83.794,58.819]] },
  { id: 6, name: "6", polygon: [[75.215,55.731], [72.821,58.599], [78.407,64.554], [81.001,61.687]] },
  { id: 7, name: "7", polygon: [[72.621,58.599], [70.227,61.907], [75.814,67.422], [78.407,64.554]] },
  { id: 8, name: "8", polygon: [[70.227,61.687], [67.634,64.775], [73.22,70.51], [75.814,67.422]] },
  { id: 9, name: "9", polygon: [[67.634,64.775], [65.24,67.642], [71.025,73.157], [73.22,70.51]] },
  { id: 10, name: "10", polygon: [[65.439,67.642], [63.245,70.289], [68.631,75.804], [70.826,73.157]] },
  { id: 11, name: "11", polygon: [[63.045,70.289], [60.651,73.377], [66.038,78.892], [68.432,76.024]] },
  { id: 12, name: "12", polygon: [[60.451,73.377], [58.057,76.465], [63.444,81.98], [65.838,78.892]] },
  { id: 13, name: "13", polygon: [[58.057,76.465], [55.663,79.553], [60.85,84.847], [63.245,81.759]] },
  { id: 14, name: "14", polygon: [[55.464,79.553], [53.07,82.421], [59.055,88.817], [61.05,84.847]] },
  { id: 15, name: "15", polygon: [[53.07,82.421], [51.673,86.171], [57.658,92.126], [59.055,88.597]]},
  { id: 16, name: "16", polygon: [[51.811,86.206], [49.616,82.322], [45.335,90.089], [48.299,92.759]] },
  { id: 17, name: "17", polygon: [[49.616,82.322], [47.201,79.045], [41.164,84.142], [43.469,87.54]] },
  { id: 18, name: "18", polygon: [[47.201,79.086], [44.896,75.809], [38.749,81.028], [41.164,84.061]] },
  { id: 19, name: "19", polygon: [[44.896,76.052], [42.7,72.654], [36.443,77.751], [38.858,81.149]] },
  { id: 20, name: "20", polygon: [[42.7,72.775], [40.285,69.498], [34.138,74.595], [36.553,77.872]] },
  { id: 21, name: "21", polygon: [[40.176,69.498], [37.98,66.222], [31.833,71.319], [34.248,74.595]] },
  { id: 22, name: "22", polygon: [[37.87,66.464], [33.699,60.032], [29.967,61.974], [34.687,68.892]] },
  { id: 23, name: "23", polygon: [[29.967,61.974], [26.454,64.037], [31.723,71.561], [34.797,68.77]] },
  { id: 24, name: "24", polygon: [[22.942,59.264], [23.82,54.935], [17.124,50.445], [14.709,53.479]] },
  { id: 25, name: "25", polygon: [[24.479,53.924], [26.894,50.769], [21.076,45.065], [18.661,48.341]] },
  { id: 26, name: "26", polygon: [[26.674,50.769], [29.308,47.613], [23.381,41.788], [21.076,45.186]] },
  { id: 27, name: "27", polygon: [[29.199,47.492], [31.614,44.337], [25.686,38.633], [23.491,41.909]] },
  { id: 28, name: "28", polygon: [[31.614,44.296], [33.919,41.262], [28.101,35.437], [25.686,38.714]] },
  { id: 29, name: "29", polygon: [[33.919,41.019], [36.334,38.107], [30.296,32.16], [28.211,35.316]] },
  { id: 30, name: "30", polygon: [[36.334,37.985], [38.749,34.83], [32.711,29.005], [30.406,32.282]] },
  { id: 31, name: "31", polygon: [[38.749,34.83], [41.164,31.796], [35.126,25.85], [32.711,29.005]] },
  { id: 32, name: "32", polygon: [[41.054,31.675], [43.578,28.641], [37.431,22.573], [35.126,25.728]] },
  { id: 33, name: "33", polygon: [[43.578,28.519], [45.993,25.485], [39.846,19.417], [37.431,22.816]] },
  { id: 34, name: "34", polygon: [[45.884,25.485], [48.299,22.209], [42.151,16.141], [39.737,19.417]] },
  { id: 35, name: "35", polygon: [[45.884,11.044], [51.043,14.684], [55.434,7.039], [51.482,3.519]] },
  { id: 36, name: "36", polygon: [[51.043,14.927], [53.787,17.476], [58.397,9.709], [55.324,7.16]] },
  { id: 37, name: "37", polygon: [[53.787,17.476], [56.861,20.267], [61.251,12.257], [58.397,9.709]] },
  { id: 38, name: "38", polygon: [[56.641,20.267], [59.495,22.937], [64.105,14.927], [61.251,12.379]] },
  { id: 39, name: "39", polygon: [[59.495,22.937], [62.349,25.728], [66.85,17.597], [63.996,14.927]] },
  { id: 40, name: "40", polygon: [[62.349,25.728], [65.203,28.641], [69.813,20.267], [66.85,17.718]] },
  { id: 41, name: "41", polygon: [[65.313,28.519], [67.838,31.432], [72.777,23.058], [69.813,20.267]] },
  { id: 42, name: "42", polygon: [[53.897,27.791], [48.847,34.345], [51.482,37.015], [56.641,30.583]] },
  { id: 43, name: "43", polygon: [[56.641,30.704], [51.592,37.015], [54.446,39.806], [59.495,33.374]] },
  { id: 44, name: "44", polygon: [[54.336,39.927], [57.08,42.476], [62.239,36.044], [59.385,33.252]] },
  { id: 45, name: "45", polygon: [[57.08,42.476], [59.934,45.267], [64.984,38.835], [62.239,35.922]] },
  { id: 46, name: "46", polygon: [[64.984,38.835], [59.824,45.267], [62.678,47.937], [67.728,41.626]] },
  { id: 47, name: "47", polygon: [[67.728,41.626], [62.569,47.816], [65.423,50.607], [70.472,44.296]] },
  { id: 48, name: "48", polygon: [[70.472,44.296], [65.532,50.485], [68.277,53.155], [73.326,46.966]] },
  { id: 49, name: "49", polygon: [[68.277,53.398], [63.117,59.83], [60.263,57.039], [65.423,50.728]] },
  { id: 50, name: "50", polygon: [[65.423,50.728], [60.483,57.039], [57.629,54.369], [62.678,47.816]] },
  { id: 51, name: "51", polygon: [[62.678,47.816], [57.629,54.369], [54.775,51.699], [59.934,45.146]] },
  { id: 52, name: "52", polygon: [[59.934,45.146], [54.885,51.456], [52.031,48.908], [56.97,42.476]] },
  { id: 53, name: "53", polygon: [[56.97,42.476], [52.031,48.786], [49.177,46.238], [54.446,39.806]] },
  { id: 54, name: "54", polygon: [[54.446,39.806], [49.286,46.117], [46.432,43.447], [51.592,36.893]] },
  { id: 55, name: "55", polygon: [[51.372,37.136], [46.542,43.325], [43.688,40.655], [49.067,34.223]] },
  { id: 56, name: "56", polygon: [[53.568,71.966], [58.507,65.534], [55.763,62.743], [50.823,69.175]] },
  { id: 57, name: "57", polygon: [[50.714,69.296], [55.653,62.864], [53.019,60.073], [47.969,66.383]] },
  { id: 58, name: "58", polygon: [[47.969,66.383], [52.909,60.073], [50.274,57.524], [45.225,63.592]] },
  { id: 59, name: "59", polygon: [[45.225,63.592], [50.274,57.524], [47.42,54.733], [42.481,61.044]] },
  { id: 60, name: "60", polygon: [[42.481,61.044], [47.42,54.612], [44.786,51.82], [39.737,58.252]] },
  { id: 61, name: "61", polygon: [[39.737,58.252], [44.676,51.942], [41.932,49.272], [36.883,55.461]] },
  { id: 62, name: "62", polygon: [[36.883,55.461], [41.932,49.272], [39.188,46.602], [34.029,52.791]] }
    ],
    // 将来、第3駐車場を追加する場合は以下のようにします
    "lot-3": [
        // 第3駐車場の座標データ...
    ]
};


// 2. マップを開き、個別マスを生成する（★本番用：堅牢なデータ連携 ＆ 透明エリア版）
function openInteractiveMap(lotId, imgSrc) {
    const oldModal = document.getElementById('interactiveMapModal');
    if (oldModal) oldModal.remove();

    const mapModal = document.createElement('div');
    mapModal.id = 'interactiveMapModal';
    mapModal.className = 'map-fullscreen-modal'; 
    document.body.appendChild(mapModal);

    const img = new Image();
    img.src = imgSrc;
    img.onload = () => {
        // ★ アーキテクチャ改善：型安全なデータ取得
        // PostgreSQLから渡される lotId が数値でも文字列でも確実にマッチするように吸収し、
        // 開発者用コンソールにデバッグログを出力します。
        console.log(`[Debug] 展開リクエスト受信 - 駐車場ID: ${lotId}`);
        const currentSpots = PARKING_SPOTS_DATA[String(lotId)] || PARKING_SPOTS_DATA[Number(lotId)] || [];

        if (currentSpots.length === 0) {
            console.warn(`[Warn] ID: ${lotId} の座標データが PARKING_SPOTS_DATA に定義されていません。`);
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        currentSpots.forEach(spot => spot.polygon.forEach(p => {
            if(p[0] < minX) minX = p[0]; if(p[1] < minY) minY = p[1];
            if(p[0] > maxX) maxX = p[0]; if(p[1] > maxY) maxY = p[1];
        }));
        
        minX -= 2; minY -= 2; maxX += 2; maxY += 2; 
        if (minX === Infinity) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
        const autoAreaPoints = `${minX},${minY} ${maxX},${minY} ${maxX},${maxY} ${minX},${maxY}`;

        let spotsSvg = currentSpots.map(spot => {
            const pts = spot.polygon.map(p => `${p[0]},${p[1]}`).join(' ');
            return `<polygon points="${pts}" class="spot-polygon" onclick="handleSpotCheckIn(${lotId}, '${spot.name}')" style="display: block; fill: rgba(46, 204, 113, 0.4); stroke: #2ecc71; stroke-width: 0.3; cursor: pointer;" />`;
        }).join('');

        mapModal.innerHTML = `
            <div class="map-zoom-content" style="position: relative; overflow: hidden; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.95);">
                <span onclick="document.getElementById('interactiveMapModal').style.display='none'" style="position: absolute; top: 20px; right: 30px; font-size: 50px; color: white; cursor: pointer; z-index: 10000; line-height: 1;">&times;</span>
                
                <div id="panzoom-container" style="position: relative; display: inline-block; line-height: 0; font-size: 0; margin: 0 auto;">
                    <img src="${imgSrc}" style="display: block; max-width: 95vw; max-height: 85vh; width: auto; height: auto; pointer-events: none; margin: 0; padding: 0; border: none;">
                    
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; margin: 0; padding: 0;">
                        ${spotsSvg}
                        
                        <!-- ★ 修正ポイント：職人モードを終了し、完全に透明な本番用ダミーエリアに戻しました -->
                        <polygon points="${autoAreaPoints}" id="main-area" style="fill: transparent; stroke: none; pointer-events: auto; cursor: pointer;" />
                    </svg>
                </div>
            </div>
        `;
        mapModal.style.display = 'flex';

        setTimeout(() => {
            const elem = document.getElementById('panzoom-container');
            const mainArea = document.getElementById('main-area');

            try {
                const panzoom = Panzoom(elem, { maxScale: 5 });
                elem.parentElement.addEventListener('wheel', panzoom.zoomWithWheel);

                mainArea.onclick = (e) => {
                    mainArea.style.display = 'none'; 
                    document.querySelectorAll('.spot-polygon').forEach(el => {
                        el.style.pointerEvents = 'auto';
                    });
                    panzoom.zoomToPoint(2.5, { clientX: e.clientX, clientY: e.clientY }, { animate: true }); 
                };
            } catch (err) {
                console.error("Panzoomエラー:", err);
            }
        }, 100); 
    };
}
// 3. 個別マスをタップした時の処理
function handleSpotCheckIn(lotId, spotName) {
    document.getElementById('interactiveMapModal').style.display = 'none';
    showUndoToast(`【${spotName}番】に駐車しました`, () => {
        console.log(`【取り消し】 ${spotName}番 の駐車をキャンセルしました`);
    });
}