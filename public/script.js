// =================================================================================
// グローバル定数・変数
// =================================================================================
// ページを開いたサーバーへ接続する（別端末からも同じURLで利用できる）。
const API_BASE_URL = '';
// 番号の変更前に開かれた画面から、古い番号で登録することを防ぐ。
const PARKING_LAYOUT_VERSIONS = { 1: 4, 2: 2, 3: 1, 4: 1, 5: 2, 7: 2 };

let parkingData = [];
let currentUser = null;
let myParkingInfo = null;
let latestMapStatus = null;
let mapRequestId = 0;
let parkingOperationPending = false;


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
        if (mainSystem.classList.contains('hidden')) {
            showError(error.message);
        } else {
            showNotification(error.message, 'error');
        }
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

// ログアウト確認後に、利用者情報を消してログイン画面へ戻す。
function processLogout() {
    // ユーザー情報を消す
    currentUser = null;
    myParkingInfo = null;

    // 画面を切り替え、開いているモーダルも閉じる。
    showLoginScreen();
}


// =================================================================================
// 画面表示の制御
// =================================================================================
function showLoginScreen() {
    closeInteractiveMap();
    loginScreen.classList.remove('hidden');
    mainSystem.classList.add('hidden');
    closeDetailModal();     // 詳細モーダルを閉じる
    closeEndTimeModal();    // 時刻入力モーダルを閉じる
    closeImageZoomModal();  // 画像拡大モーダルを閉じる
    closeLogoutModal();
    closeCheckoutModal();
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
function renderParkingLots() {
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

            // DBで設定した画像を使用する。画像未準備なら番号一覧へ案内する。
            if (!lot.imageUrl) {
                showNotification('この駐車場の地図画像は準備中です。「番号から探す」を利用してください。', 'error');
                return;
            }
            openInteractiveMap(lot.id, lot.imageUrl);
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

        const isMyCar = myParkingInfo && String(myParkingInfo.lot_id) === String(lotId) && Number(myParkingInfo.space_id) === space.id;

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
// ウィジェットの開閉を切り替える関数
function toggleParkingStatus() {
    const widget = document.getElementById('myParkingStatus');
    if (widget) {
        widget.classList.toggle('expanded');
    }
}

// 駐車状態ウィジェットの表示更新
function displayMyParkingStatus() {
    const statusWidget = document.getElementById('myParkingStatus');
    const toggleText = document.getElementById('widgetToggleText');
    const detailsContent = document.getElementById('widgetDetailsContent');

    if (myParkingInfo) {
        const parkedLot = parkingData.find(l => String(l.id) === String(myParkingInfo.lot_id));

        if (parkedLot) {
            const elapsedTime = getElapsedTime(myParkingInfo.start_time);
            const endTimeDisplay = myParkingInfo.estimated_end_time ? myParkingInfo.estimated_end_time : '未定';

            // ピル状の常時見えているテキストを更新
            toggleText.textContent = `${parkedLot.name} (${myParkingInfo.space_id}番) ・ 経過${elapsedTime}`;

            // 展開時の詳細情報を更新
            detailsContent.innerHTML = `
                場所: <strong>${parkedLot.name} (${myParkingInfo.space_id}番)</strong><br>
                退庫予定: <strong>${endTimeDisplay}</strong><br>
                経過時間: <strong>${elapsedTime}</strong>
            `;

            statusWidget.classList.remove('hidden');
        }
    } else {
        statusWidget.classList.add('hidden');
        statusWidget.classList.remove('expanded'); // 閉じておく
    }
}

async function processSpaceCheckin(lotId, spaceId, endTimeToSend) {
    if (!currentUser) return showNotification('ログインしてください', 'error');
    if (myParkingInfo) {
        return showNotification('すでに駐車登録されています。複数台の登録はできません。', 'error');
    }
    if (parkingOperationPending) return;
    parkingOperationPending = true;

    try {
        // 正式なチェックインAPIを呼び出す
        const newParkingInfo = await apiRequest('/api/parking/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.studentId,
                lotId: lotId,
                spaceId: spaceId,
                endTime: endTimeToSend,
                layoutVersion: PARKING_LAYOUT_VERSIONS[Number(lotId)]
            })
        });

        myParkingInfo = newParkingInfo;
        showNotification(`第${lotId}駐車場の${spaceId}番に駐車しました`, 'success');

        // 最新の駐車場データを再取得してリスト等を更新
        // 各種モーダルおよびマップを閉じる（ホーム画面に戻す）
        closeDetailModal();
        closeEndTimeModal();

        closeInteractiveMap();
        displayMyParkingStatus();
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();

    } catch (error) {
        console.error('Checkin failed:', error);
    } finally {
        parkingOperationPending = false;
    }
}

// 【変更】ボタンが押されたら、いきなり処理せず「モーダルを開く」だけにする
function processSpaceCheckout() {
    // 以前の confirm('本当に退庫しますか？') は削除！
    openCheckoutModal();
}

// 【新規】モーダルの「退庫する」が押された時に実行される関数
async function executeCheckout() {
    if (!currentUser || parkingOperationPending) return;
    parkingOperationPending = true;
    try {
        // サーバーに「退庫します」と伝える（既存の処理と同じ）
        await apiRequest('/api/parking/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.studentId })
        });

        showNotification('出庫しました。', 'success');
        myParkingInfo = null; // 自分の情報をクリア
        displayMyParkingStatus();
        closeDetailModal();
        closeCheckoutModal();
        closeInteractiveMap();

        // 画面の数字などを最新にする
        parkingData = await apiRequest('/api/parking-data');
        refreshUI();

    } catch (error) {
        // エラーは apiRequest 内で表示されるので、ここでは何もしない（ログだけ）
        console.error(error);
    } finally {
        parkingOperationPending = false;
    }
}



// =================================================================================
// ヘルパー関数 (変更なし)
// =================================================================================
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



    // 駐車状況の出庫ボタンは、起動時に一度だけ設定する。
    const mainCheckoutButton = document.getElementById('mainCheckoutButton');
    if (mainCheckoutButton) {
        mainCheckoutButton.addEventListener('click', processSpaceCheckout);
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
// ★★★ ドリルダウン型：マップ展開 ＆ 個別マスタップ機能 ★★★
// =================================================================================

// 座標は public/data/parking-spots/lot-番号.json から読み込む。

function closeInteractiveMap() {
    mapRequestId++;
    latestMapStatus = null;
    const modal = document.getElementById('interactiveMapModal');
    if (modal) modal.remove();
}

// 2. マップを開き、個別マスを生成する（A案：リアルタイム都度取得＆塗り分け版）
async function openInteractiveMap(lotId, imgSrc) {
    const requestId = ++mapRequestId;
    const oldModal = document.getElementById('interactiveMapModal');
    if (oldModal) oldModal.remove();
    latestMapStatus = null;

    const lot = parkingData.find(item => String(item.id) === String(lotId));
    if (!lot) {
        showNotification('駐車場一覧を読み込み直してから、地図を開いてください。', 'error');
        return;
    }
    let currentSpots;
    try {
        const coordinates = await apiRequest(ParkingMapData.spotFile(lotId), { cache: 'no-store' });
        currentSpots = ParkingMapData.validateSpots(coordinates, lot.capacity);
    } catch (error) {
        if (requestId === mapRequestId) {
            showNotification(`地図の枠を読み込めません。${error.message}`, 'error');
        }
        return;
    }
    if (requestId !== mapRequestId || !currentUser) return;
    if (!currentSpots.length) {
        showNotification('この駐車場の地図の枠は準備中です。「番号から探す」を利用してください。', 'error');
        return;
    }

    // 空き状況を確認できたときだけ、登録できる地図を表示する。
    let latestParkingStatus;
    try {
        latestParkingStatus = await apiRequest('/api/parking/status');
        if (!Array.isArray(latestParkingStatus)) throw new Error('空き状況のデータが正しくありません。');
    } catch (error) {
        console.error('通信エラー:', error);
        showNotification('空き状況を確認できないため、地図を開けません。時間をおいて再度お試しください。', 'error');
        return;
    }
    if (requestId !== mapRequestId || !currentUser) return;
    latestMapStatus = { lotId: String(lotId), spots: latestParkingStatus };

    const mapModal = document.createElement('div');
    mapModal.id = 'interactiveMapModal';
    mapModal.className = 'map-fullscreen-modal';
    document.body.appendChild(mapModal);

    const img = new Image();
    img.onerror = () => {
        if (requestId !== mapRequestId) return;
        mapModal.remove();
        latestMapStatus = null;
        showNotification('地図画像を読み込めません。「番号から探す」を利用してください。', 'error');
    };
    img.onload = () => {
        if (requestId !== mapRequestId || !currentUser) {
            mapModal.remove();
            return;
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
            // ★取得した最新のDBデータと突き合わせて色を決定
            const spotStatus = latestParkingStatus.find(s =>
                String(s.lot_id) === String(lotId) && Number(s.spot_number) === Number(spot.id)
            );

            // デフォルトは空き（緑色）
            let fillColor = 'rgba(46, 204, 113, 0.4)';
            let strokeColor = '#2ecc71';

            // もしDBにデータが存在し、occupied（満車）なら赤色にする
            if (spotStatus && spotStatus.status === 'occupied') {
                fillColor = 'rgba(231, 76, 60, 0.6)';
                strokeColor = '#e74c3c';
            }
            const isMySpot = myParkingInfo && String(myParkingInfo.lot_id) === String(lotId) &&
                Number(myParkingInfo.space_id) === spot.id;
            if (isMySpot) strokeColor = '#f1c40f';

            const pts = spot.polygon.map(p => `${p[0]},${p[1]}`).join(' ');
            const denseMap = currentSpots.length > 100;
            const strokeWidth = denseMap ? (isMySpot ? 0.16 : 0.08) : (isMySpot ? 0.6 : 0.3);
            const centerX = spot.polygon.reduce((sum, point) => sum + point[0], 0) / spot.polygon.length;
            const centerY = spot.polygon.reduce((sum, point) => sum + point[1], 0) / spot.polygon.length;
            const numberLabel = denseMap || [4, 5, 7].includes(Number(lotId))
                ? `<text x="${centerX}" y="${centerY}" class="map-spot-number" text-anchor="middle" dominant-baseline="middle" style="font-size: ${denseMap && Number(lotId) !== 7 ? 0.45 : 0.9}px; fill: #173b23; ${Number(lotId) === 7 ? 'paint-order: stroke; stroke: white; stroke-width: 0.18px; stroke-linejoin: round;' : ''} pointer-events: none;">${spot.id}</text>`
                : '';
            // ★修正ポイント2：polygonタグに id="spot-${lotId}-${spot.id}" を追加しました！
            return `<polygon id="spot-${lotId}-${spot.id}" points="${pts}" class="spot-polygon" onclick="handleSpotCheckIn('${lotId}', '${spot.id}')" style="display: block; fill: ${fillColor}; stroke: ${strokeColor}; stroke-width: ${strokeWidth}; cursor: pointer;"><title>${spot.id}番${isMySpot ? '（自分の駐車枠）' : ''}</title></polygon>${numberLabel}`;
        }).join('');

        mapModal.innerHTML = `
            <div class="map-zoom-content" style="position: relative; overflow: hidden; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.95);">
                <span onclick="closeInteractiveMap()" style="position: absolute; top: 20px; right: 30px; font-size: 50px; color: white; cursor: pointer; z-index: 10000; line-height: 1;">&times;</span>
                <p style="position: absolute; top: 20px; left: 16px; color: white; z-index: 10000; margin: 0; font-size: 18px;">第${lotId}駐車場：${lot.capacity}台${[3, 7].includes(Number(lotId)) ? '（暫定・位置を確認中）' : ''}</p>
                <p style="position: absolute; bottom: 8px; left: 16px; right: 16px; text-align: center; color: white; z-index: 10000; margin: 0; font-size: 14px;">緑の枠から入庫・黄色い線で囲まれた自分の枠から出庫できます</p>

                <div id="panzoom-container" style="position: relative; display: inline-block; line-height: 0; font-size: 0; margin: 0 auto;">
                    <img src="${imgSrc}" style="display: block; max-width: 95vw; max-height: 85vh; width: auto; height: auto; pointer-events: none; margin: 0; padding: 0; border: none;">

                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; margin: 0; padding: 0;">
                        ${spotsSvg}

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
                mainArea.style.display = 'none';
                document.querySelectorAll('.spot-polygon').forEach(el => {
                    el.style.pointerEvents = 'auto';
                });
            }
        }, 100);
    };
    img.src = imgSrc;
}

// 3. マスがクリックされたときの処理（時間入力フロー統合版）
function handleSpotCheckIn(lotId, spotName) {
    if (!currentUser) return showNotification('ログインしてください。', 'error');
    const lot = parkingData.find(item => String(item.id) === String(lotId));
    const spotNumber = Number(spotName);
    if (!lot || !Number.isInteger(spotNumber) || spotNumber < 1 || spotNumber > lot.capacity) {
        showNotification('この駐車枠は登録対象外です。地図を開き直してください。', 'error');
        return;
    }
    if (!latestMapStatus || latestMapStatus.lotId !== String(lotId)) {
        showNotification('地図を開き直して、最新の空き状況を確認してください。', 'error');
        return;
    }
    if (myParkingInfo) {
        const isMySpot = String(myParkingInfo.lot_id) === String(lotId) &&
            Number(myParkingInfo.space_id) === spotNumber;
        if (isMySpot) openCheckoutModal();
        else showNotification('すでに駐車登録されています。自分の駐車枠から出庫してください。', 'error');
        return;
    }
    const spotStatus = latestMapStatus.spots.find(spot =>
        String(spot.lot_id) === String(lotId) && Number(spot.spot_number) === Number(spotName)
    );
    if (spotStatus?.status === 'occupied') {
        showNotification('その駐車枠は使用中です。緑色の空き枠を選んでください。', 'error');
        return;
    }

    // 古いToggleAPIではなく、「番号から探す」と同じ予定時刻入力モーダルを開く
    openEndTimeModal(lotId, spotName);
}
