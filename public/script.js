// =================================================================================
// グローバル定数・変数
// =================================================================================
// ページを開いたサーバーへ接続する（別端末からも同じURLで利用できる）。
const API_BASE_URL = '';
// 番号の変更前に開かれた画面から、古い番号で登録することを防ぐ。
const PARKING_LAYOUT_VERSIONS = { 1: 4, 2: 2, 3: 1, 4: 1, 5: 2, 7: 2 };
// 比較評価後に旧入口が必要ならtrueへ戻す。旧画面・共通処理・テストは保持する。
const SHOW_LEGACY_NUMBER_ENTRY = false;

let parkingData = [];
let currentUser = null;
let myParkingInfo = null;
let latestMapStatus = null;
let mapRequestId = 0;
let parkingOperationPending = false;
let activeMapView = null;
let mapScrollState = null;


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
                showNotification('この駐車場の地図画像は準備中です。時間をおいて再度確認してください。', 'error');
                return;
            }
            openInteractiveMap(lot.id, lot.imageUrl);
        };

        // 🔢 番号から探すボタン（※機能3：以前のリスト方式）
        const numberBtn = document.createElement('button');
        numberBtn.className = 'action-btn btn-number';
        numberBtn.hidden = !SHOW_LEGACY_NUMBER_ENTRY;
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

    // 番号付き図面は閲覧専用。下の番号一覧の登録・出庫操作とは分離する。
    lotImage.alt = `${lot.name} の図面`;

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
    return getNumberedDiagram().show(lot);
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
function closeDetailModal() {
    const modal = document.getElementById('lotDetailModal');
    if (modal) modal.style.display = 'none';
    if (numberedDiagram) numberedDiagram.close();
}
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

let numberedDiagram = null;
function getNumberedDiagram() {
    if (!numberedDiagram) numberedDiagram = ParkingNumberedDiagram.create({
        document, window, fetchCoordinates: url => apiRequest(url, { cache: 'no-store' }),
        panzoom: (target, options) => Panzoom(target, options)
    });
    return numberedDiagram;
}

function openImageZoomModal() { return getNumberedDiagram().openZoom(); }



function closeImageZoomModal() { if (numberedDiagram) numberedDiagram.closeZoom(); }



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

function lockMapPageScroll() {
    if (mapScrollState) return;
    const body = document.body;
    const properties = ['position', 'top', 'left', 'width', 'overflow', 'paddingRight'];
    mapScrollState = {
        x: window.scrollX, y: window.scrollY,
        body: Object.fromEntries(properties.map(property => [property, body.style[property]])),
        htmlOverflow: document.documentElement.style.overflow,
        hadClass: body.classList.contains('parking-map-open')
    };
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const paddingRight = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    Object.assign(body.style, {
        position: 'fixed', top: `${-mapScrollState.y}px`, left: `${-mapScrollState.x}px`,
        width: '100%', overflow: 'hidden', paddingRight: `${paddingRight + scrollbarWidth}px`
    });
    document.documentElement.style.overflow = 'hidden';
    body.classList.add('parking-map-open');
}

function unlockMapPageScroll() {
    if (!mapScrollState) return;
    const previous = mapScrollState;
    mapScrollState = null;
    Object.assign(document.body.style, previous.body);
    document.documentElement.style.overflow = previous.htmlOverflow;
    if (!previous.hadClass) document.body.classList.remove('parking-map-open');
    window.scrollTo(previous.x, previous.y);
}

function currentMapOrientation() {
    const orientation = window.screen && window.screen.orientation;
    if (orientation && orientation.type) return orientation.type.split('-')[0];
    if (typeof window.orientation === 'number') return Math.abs(window.orientation) % 180 === 90 ? 'landscape' : 'portrait';
    return null;
}

function isCurrentMapView(view) {
    return activeMapView === view && view.requestId === mapRequestId;
}

// 画像全体が中央領域へ収まるサイズ。画像とSVGには同じ幅・高さを使う。
function fitInteractiveMapImage(view) {
    const width = view.viewport.clientWidth;
    const height = view.viewport.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(width / view.image.naturalWidth, height / view.image.naturalHeight);
    const previousFit = view.fitScale;
    view.fitScale = scale;
    const imageWidth = view.image.naturalWidth * scale;
    const imageHeight = view.image.naturalHeight * scale;
    view.element.style.width = `${imageWidth}px`;
    view.element.style.height = `${imageHeight}px`;
    // Panzoomは親からの余白をmarginで読むため、中央配置の余白も明示する。
    view.element.style.marginLeft = `${(width - imageWidth) / 2}px`;
    view.element.style.marginTop = `${(height - imageHeight) / 2}px`;
    if (view.metrics) {
        view.sizing = ParkingMapData.mapSizing(view.metrics, scale);
        // 高さだけの変更では、現在の倍率を強制的に下げない。
        view.maxScale = Math.max(view.sizing.maxScale, view.panzoom ? view.panzoom.getScale() : 1);
        if (view.panzoom) {
            view.panzoom.setOptions({ maxScale: view.maxScale });
            if (previousFit && previousFit !== scale) {
                const pan = view.panzoom.getPan();
                view.panzoom.pan(pan.x * scale / previousFit, pan.y * scale / previousFit, { animate: false });
            }
        }
    }
}

function setInteractiveMapMode(view, mode) {
    view.mode = mode;
    view.modal.querySelector('.map-guide').textContent = mode === 'selection'
        ? '空いている駐車枠をタップ' : '見たい場所をタップして拡大';
}

function resetInteractiveMapOverview(view) {
    clearInteractiveMapSearch(view);
    if (view.settleFrame != null) window.cancelAnimationFrame(view.settleFrame);
    view.settleFrame = null;
    view.busy = false;
    view.completedGesture = null;
    if (view.gesture) view.gesture.canceled = true;
    view.observedScale = 1;
    view.autoScale = null;
    if (view.sizing) {
        view.maxScale = view.sizing.maxScale;
        if (view.panzoom) view.panzoom.setOptions({ maxScale: view.maxScale });
    }
    setInteractiveMapMode(view, 'overview');
    if (view.panzoom) view.panzoom.reset({ animate: false });
}

// 画像とSVGを含む同じ親の実際の表示位置から、元画像の座標へ換算する。
function interactiveMapPoint(view, clientX, clientY, allowOutside = false) {
    const rect = view.element.getBoundingClientRect();
    if (![rect.width, rect.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('地図の位置を取得できません。');
    const point = [(clientX - rect.left) / rect.width * view.metrics.width, (clientY - rect.top) / rect.height * view.metrics.height];
    if (!point.every(Number.isFinite)) throw new Error('タップ位置を取得できません。');
    if (!allowOutside && (point[0] < 0 || point[0] > view.metrics.width || point[1] < 0 || point[1] > view.metrics.height)) return null;
    return point;
}

function constrainInteractiveMapPan(view) {
    updateInteractiveMapSearchHighlight(view);
    const pan = view.panzoom.getPan();
    const bounded = ParkingMapData.clampMapPan(pan, view.metrics.width * view.fitScale, view.metrics.height * view.fitScale,
        view.viewport.clientWidth, view.viewport.clientHeight, view.panzoom.getScale());
    if (Math.abs(pan.x - bounded.x) > 0.01 || Math.abs(pan.y - bounded.y) > 0.01) {
        view.panzoom.pan(bounded.x, bounded.y, { animate: false });
    }
}

function failInteractiveMap(error) {
    console.error('地図操作エラー:', error);
    closeInteractiveMap();
    showNotification('地図を正しく操作できないため閉じました。地図を開き直してください。', 'error');
}

function autoZoomInteractiveMap(view, point) {
    const result = ParkingMapData.zoomForPoint(view.metrics, view.fitScale, view.panzoom.getScale(), point);
    view.autoScale = result.autoScale;
    view.busy = true;
    // 親の中心を原点とするPanzoomの移動量。倍率を二重に掛けない。
    const pan = ParkingMapData.clampMapPan({ x: (view.metrics.width / 2 - point[0]) * view.fitScale,
        y: (view.metrics.height / 2 - point[1]) * view.fitScale },
        view.metrics.width * view.fitScale, view.metrics.height * view.fitScale,
        view.viewport.clientWidth, view.viewport.clientHeight, view.autoScale);
    view.panzoom.zoom(view.autoScale, { animate: false });
    view.panzoom.pan(pan.x, pan.y, { animate: false });
    // Panzoomが画像とSVGへ同じ変形を描画した後に選択を許可する。
    view.settleFrame = window.requestAnimationFrame(() => {
        view.settleFrame = null;
        if (!isCurrentMapView(view)) return;
        view.busy = false;
        view.observedScale = view.panzoom.getScale();
        setInteractiveMapMode(view, 'selection');
    });
}

// 検索は閲覧・位置指定だけ。登録・出庫は検索結果の明示的なボタンから共通処理へ渡す。
function clearInteractiveMapSearch(view) {
    view.searchToken = (view.searchToken || 0) + 1;
    if (view.searchAbort) view.searchAbort.abort();
    view.searchAbort = null;
    if (view.searchTimer != null) clearTimeout(view.searchTimer);
    if (view.searchFrame != null) window.cancelAnimationFrame(view.searchFrame);
    view.searchTimer = view.searchFrame = null;
    view.searchPending = false;
    view.selectedNumber = null;
    if (view.searchHighlight) view.searchHighlight.remove();
    view.searchHighlight = null;
    if (view.searchNodes) {
        const nodes = view.searchNodes;
        nodes.form.setAttribute('aria-busy', 'false');
        nodes.input.readOnly = false;
        nodes.submit.disabled = false;
        nodes.submit.textContent = '位置を表示';
        nodes.input.removeAttribute('aria-invalid');
        nodes.error.textContent = '';
        nodes.error.hidden = true;
        nodes.result.hidden = true;
        nodes.action.hidden = true;
    }
}

function highlightInteractiveMapSearch(view, number) {
    if (view.searchHighlight) view.searchHighlight.remove();
    const spot = view.spots.find(item => item.id === number);
    const svg = view.modal.querySelector('.map-spots-overlay');
    const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    highlight.setAttribute('points', spot.polygon.map(p => p.join(',')).join(' '));
    highlight.setAttribute('class', 'map-search-highlight');
    highlight.setAttribute('data-search-number', String(number));
    highlight.setAttribute('aria-hidden', 'true');
    // 元の枠より後ろへ青い外周を置き、自分の黄枠・空き/使用中の色を残す。
    svg.insertBefore(highlight, svg.firstChild);
    view.searchHighlight = highlight;
    updateInteractiveMapSearchHighlight(view);
}

function updateInteractiveMapSearchHighlight(view) {
    if (!view.searchHighlight || !view.panzoom || !view.fitScale) return;
    const own = myParkingInfo && String(myParkingInfo.lot_id) === String(view.lotId) && Number(myParkingInfo.space_id) === view.selectedNumber;
    const dense = view.spots.length > 100;
    const original = view.modal.querySelector(`#spot-${view.lotId}-${view.selectedNumber}`);
    const originalWidth = parseFloat(original.style.strokeWidth) || (dense ? (own ? 0.16 : 0.08) : (own ? 0.6 : 0.3));
    const baseStroke = originalWidth * Math.max(view.image.naturalWidth, view.image.naturalHeight) * view.fitScale / 100;
    // SVGのnon-scaling-strokeだけでは親のCSS拡大を打ち消せないため、倍率で補正する。
    // 元の状態線より画面上で6pxだけ太くし、黄枠の外側にも青い輪郭を残す。
    view.searchHighlight.style.strokeWidth = `${baseStroke + 6 / view.panzoom.getScale()}px`;
}

function updateInteractiveMapSearchResult(view) {
    const number = view.selectedNumber;
    if (!number || !view.searchNodes) return;
    const nodes = view.searchNodes;
    const state = ParkingMapSearch.spaceState(view.lotId, number, view.statusRows, myParkingInfo);
    nodes.result.hidden = false;
    nodes.result.setAttribute('data-space-state', state.kind);
    nodes.title.textContent = `検索対象：${view.lot.name || `第${view.lotId}駐車場`} ${number}番`;
    nodes.state.textContent = `状態：${state.label}${state.endTime ? ` ／ 出庫予定 ${state.endTime}` : ''}`;
    nodes.note.textContent = view.searchLimited ? '番号はこの結果欄でも確認できます。状態は取得時点の情報です。' : '状態は取得時点の情報です。';
    nodes.action.hidden = !state.action;
    nodes.action.textContent = state.action === 'checkout' ? '出庫手続き' : 'この駐車枠を選択';
    nodes.action.disabled = view.searchPending || (state.kind === 'available' && !!myParkingInfo);
    if (state.kind === 'available' && myParkingInfo) nodes.note.textContent = '駐車中です。出庫後に別の枠を選択できます。';
}

function focusInteractiveMapSearch(view, number) {
    if (!isCurrentMapView(view) || view.selectedNumber !== number) return;
    let result = ParkingMapSearch.focusPosition(view.metrics, number, view.fitScale, view.panzoom.getScale(),
        view.maxScale, view.viewport.clientWidth, view.viewport.clientHeight, view.lotId);
    // 結果パネルで中央領域の高さが変わるため、表示を確定してから移動量を計算する。
    view.searchLimited = result.limited;
    updateInteractiveMapSearchResult(view);
    fitInteractiveMapImage(view);
    result = ParkingMapSearch.focusPosition(view.metrics, number, view.fitScale, view.panzoom.getScale(),
        view.maxScale, view.viewport.clientWidth, view.viewport.clientHeight, view.lotId);
    if (view.settleFrame != null) window.cancelAnimationFrame(view.settleFrame);
    view.completedGesture = null;
    if (view.gesture) view.gesture.canceled = true;
    view.busy = true;
    view.searchLimited = result.limited;
    view.panzoom.zoom(result.scale, { animate: false });
    view.panzoom.pan(result.pan.x, result.pan.y, { animate: false });
    highlightInteractiveMapSearch(view, number);
    updateInteractiveMapSearchResult(view);
    view.settleFrame = window.requestAnimationFrame(() => {
        view.settleFrame = null;
        if (!isCurrentMapView(view)) return;
        view.busy = false;
        view.observedScale = view.panzoom.getScale();
        setInteractiveMapMode(view, 'selection');
    });
}

async function searchInteractiveMap(view) {
    if (!isCurrentMapView(view) || !view.panzoom || view.searchPending) return;
    const value = view.searchNodes.input.value;
    clearInteractiveMapSearch(view);
    const token = view.searchToken;
    const nodes = view.searchNodes;
    const showFailure = (message, invalidInput = false) => {
        nodes.error.textContent = message;
        nodes.error.hidden = false;
        if (invalidInput) nodes.input.setAttribute('aria-invalid', 'true');
        else nodes.input.removeAttribute('aria-invalid');
    };
    let spot;
    try { spot = ParkingMapSearch.findSpot(view.lot, view.spots, value); }
    catch (error) { showFailure(error.message, true); return; }
    view.completedGesture = null;
    if (view.gesture) view.gesture.canceled = true;
    view.searchPending = true;
    nodes.input.readOnly = true;
    nodes.submit.disabled = true;
    nodes.submit.textContent = '検索中…';
    nodes.form.setAttribute('aria-busy', 'true');
    if (typeof nodes.input.blur === 'function') nodes.input.blur();
    view.searchAbort = typeof AbortController === 'function' ? new AbortController() : null;
    if (view.searchAbort) {
        const controller = view.searchAbort;
        view.searchTimer = setTimeout(() => controller.abort(), 10000);
    }
    try {
        // 中断された古い検索が画面外へ通知を出さないよう、エラーはこの欄だけで扱う。
        const response = await fetch(API_BASE_URL + '/api/parking/status', {
            cache: 'no-store', ...(view.searchAbort ? { signal: view.searchAbort.signal } : {})
        });
        const rows = await response.json();
        if (!response.ok) throw new Error('空き情報を取得できません。時間をおいて再検索してください。');
        ParkingMapSearch.validateStatus(rows);
        if (!isCurrentMapView(view) || view.searchToken !== token) return;
        view.statusRows = rows;
        latestMapStatus = { lotId: String(view.lotId), spots: rows };
        const rowsByNumber = new Map(rows.filter(row => String(row.lot_id) === String(view.lotId)).map(row => [Number(row.spot_number), row]));
        view.spots.forEach(item => {
            const polygon = view.modal.querySelector(`#spot-${view.lotId}-${item.id}`);
            const own = myParkingInfo && String(myParkingInfo.lot_id) === String(view.lotId) && Number(myParkingInfo.space_id) === item.id;
            const occupied = rowsByNumber.get(item.id)?.status === 'occupied';
            polygon.style.fill = occupied ? 'rgba(231, 76, 60, 0.6)' : 'rgba(46, 204, 113, 0.4)';
            polygon.style.stroke = own ? '#f1c40f' : occupied ? '#e74c3c' : '#2ecc71';
        });
        view.selectedNumber = spot.id;
        view.searchLimited = false;
        updateInteractiveMapSearchResult(view);
        // キーボードを閉じた後の寸法再計算と描画を待ち、画像とSVGへ同時に移動を適用。
        view.searchFrame = window.requestAnimationFrame(() => {
            view.searchFrame = window.requestAnimationFrame(() => {
                view.searchFrame = null;
                if (isCurrentMapView(view) && view.searchToken === token) {
                    fitInteractiveMapImage(view);
                    focusInteractiveMapSearch(view, spot.id);
                }
            });
        });
    } catch (error) {
        if (isCurrentMapView(view) && view.searchToken === token) {
            showFailure(error.name === 'AbortError' ? '空き情報の取得が完了しませんでした。再検索してください。'
                : error.message.includes('空き情報') ? error.message : '空き情報を取得できません。通信を確認して再検索してください。');
        }
    } finally {
        if (isCurrentMapView(view) && view.searchToken === token) {
            if (view.searchTimer != null) clearTimeout(view.searchTimer);
            view.searchTimer = null;
            view.searchAbort = null;
            view.searchPending = false;
            nodes.input.readOnly = false;
            nodes.submit.disabled = false;
            nodes.submit.textContent = '位置を表示';
            nodes.form.setAttribute('aria-busy', 'false');
        }
    }
}

function setupInteractiveMapSearch(view) {
    const query = selector => view.modal.querySelector(selector);
    view.searchNodes = { form: query('.map-search'), input: query('.map-search-input'), submit: query('.map-search-submit'),
        error: query('.map-search-error'), result: query('.map-search-result'), title: query('.map-search-result-title'),
        state: query('.map-search-result-state'), note: query('.map-search-result-note'), action: query('.map-search-action') };
    clearInteractiveMapSearch(view);
    view.listeners.push([view.searchNodes.form, 'submit', event => {
        event.preventDefault(); event.stopPropagation(); searchInteractiveMap(view);
    }], [view.searchNodes.input, 'keydown', event => {
        if (event.key === 'Enter' && event.isComposing) event.preventDefault();
    }], [view.searchNodes.input, 'focus', () => {
        view.modal.classList.add('map-search-editing');
        scheduleInteractiveMapLayout(view);
    }], [view.searchNodes.input, 'blur', () => {
        view.modal.classList.remove('map-search-editing');
        scheduleInteractiveMapLayout(view);
    }], [view.searchNodes.action, 'click', event => {
        event.stopPropagation();
        if (!isCurrentMapView(view) || !view.selectedNumber || view.searchPending || view.busy) return;
        handleSpotCheckIn(view.lotId, view.selectedNumber);
    }]);
    const resizeVisibleViewport = () => {
        if (!isCurrentMapView(view)) return;
        const viewport = window.visualViewport;
        if (viewport) view.modal.style.setProperty('--map-visible-height', `${viewport.height}px`);
        scheduleInteractiveMapLayout(view);
    };
    if (window.visualViewport) {
        view.listeners.push([window.visualViewport, 'resize', resizeVisibleViewport]);
        resizeVisibleViewport();
    }
}

function syncInteractiveMapManualZoom(view, before, focus, shrinking) {
    if (view.busy) return;
    const scale = view.panzoom.getScale();
    view.observedScale = scale;
    if (shrinking && scale <= 1.001) {
        resetInteractiveMapOverview(view);
        return;
    }
    if (view.mode !== 'overview' || scale <= before + 0.00001) return;
    const point = interactiveMapPoint(view, focus.clientX, focus.clientY, true);
    const result = ParkingMapData.zoomForPoint(view.metrics, view.fitScale, scale, point);
    if (result.displayedShortSide >= 31.9 || scale >= view.maxScale - 0.001) setInteractiveMapMode(view, 'selection');
}

function setupInteractiveMapControls(view) {
    const center = () => {
        const rect = view.viewport.getBoundingClientRect();
        return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    };
    const zoom = factor => {
        if (view.busy) return;
        const before = view.panzoom.getScale();
        const focus = center();
        const scale = Math.max(1, Math.min(view.maxScale, before * factor));
        view.panzoom.zoomToPoint(scale, focus, { animate: false });
        syncInteractiveMapManualZoom(view, before, focus, factor < 1);
    };
    view.listeners.push([view.modal.querySelector('[data-map-action="in"]'), 'click', () => zoom(1.3)],
        [view.modal.querySelector('[data-map-action="out"]'), 'click', () => zoom(1 / 1.3)],
        [view.modal.querySelector('[data-map-action="overview"]'), 'click', () => resetInteractiveMapOverview(view)]);
    view.wheel = event => {
        if (view.busy) { event.preventDefault(); return; }
        const delta = event.deltaY === 0 && event.deltaX ? event.deltaX : event.deltaY;
        if (!delta) return;
        view.completedGesture = null;
        if (view.gesture && view.gesture.pointers.size) view.gesture.canceled = true;
        const before = view.panzoom.getScale();
        view.panzoom.zoomWithWheel(event);
        syncInteractiveMapManualZoom(view, before, event, delta > 0);
    };
    view.viewport.addEventListener('wheel', view.wheel, { passive: false });
    view.listeners.push([view.element, 'panzoomzoom', event => {
        // ピンチはPanzoomが処理した実倍率を使う。内部更新や描画だけではモードを戻さない。
        const original = event.detail && event.detail.originalEvent;
        if (!isCurrentMapView(view) || !original || !['pointermove', 'touchmove'].includes(original.type)) return;
        const gesture = view.gesture;
        if (!gesture || !gesture.pinched || !gesture.focus) return;
        syncInteractiveMapManualZoom(view, view.observedScale, gesture.focus, gesture.shrinking);
    }]);
}

function setupInteractiveMapGestures(view) {
    const isControl = event => event.target && event.target.closest && event.target.closest('.map-controls, .map-search, .map-search-result');
    const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const down = event => {
        if (isControl(event) || (event.button != null && event.button !== 0)) return;
        if (!view.gesture || !view.gesture.pointers.size) {
            view.completedGesture = null;
            view.gesture = { pointers: new Map(), moved: false, pinched: false, canceled: view.busy || view.searchPending, startMode: view.mode };
        }
        const gesture = view.gesture;
        gesture.pointers.set(event.pointerId, { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY });
        if (gesture.pointers.size > 1) {
            gesture.pinched = true;
            gesture.lastDistance = distance([...gesture.pointers.values()]);
        }
    };
    const move = event => {
        const gesture = view.gesture;
        const pointer = gesture && gesture.pointers.get(event.pointerId);
        if (!pointer) return;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 8) gesture.moved = true;
        if (gesture.pointers.size > 1) {
            const points = [...gesture.pointers.values()];
            const nextDistance = distance(points);
            if (Math.abs(nextDistance - gesture.lastDistance) > 0.1) gesture.shrinking = nextDistance < gesture.lastDistance;
            gesture.lastDistance = nextDistance;
            gesture.focus = { clientX: (points[0].x + points[1].x) / 2, clientY: (points[0].y + points[1].y) / 2 };
        }
    };
    const up = event => {
        const gesture = view.gesture;
        if (!gesture || !gesture.pointers.has(event.pointerId)) return;
        move(event);
        if (event.type === 'pointercancel') gesture.canceled = true;
        gesture.pointers.delete(event.pointerId);
        if (!gesture.pointers.size) {
            view.completedGesture = { allowed: !gesture.moved && !gesture.pinched && !gesture.canceled,
                startMode: gesture.startMode, x: event.clientX, y: event.clientY };
            // 最小倍率ですでに選択中でも、明示的なピンチ縮小なら全体表示に戻す。
            if (gesture.pinched && gesture.shrinking && view.panzoom.getScale() <= 1.001) resetInteractiveMapOverview(view);
        }
    };
    const click = event => {
        if (isControl(event)) return;
        const gesture = view.completedGesture;
        view.completedGesture = null;
        if (!gesture || !gesture.allowed || view.busy || view.searchPending || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 8) return;
        try {
            const point = interactiveMapPoint(view, event.clientX, event.clientY);
            if (!point) return; // 画像外の背景は拡大しない。
            if (gesture.startMode === 'overview' || view.mode === 'overview') {
                autoZoomInteractiveMap(view, point);
                return; // 初回タップは登録へ流さない。
            }
            const hits = view.metrics.spots.filter(spot => ParkingMapData.containsPoint(spot.polygon, point));
            if (hits.length > 1) throw new Error('複数の駐車枠が重なっています。');
            if (hits.length === 1) handleSpotCheckIn(view.lotId, hits[0].id);
        } catch (error) { failInteractiveMap(error); }
    };
    const cancel = () => {
        if (view.gesture) { view.gesture.canceled = true; view.gesture.pointers.clear(); }
        view.completedGesture = null;
    };
    view.listeners.push([view.viewport, 'pointerdown', down, true], [document, 'pointermove', move, true],
        [document, 'pointerup', up, true], [document, 'pointercancel', up, true], [view.viewport, 'click', click], [window, 'blur', cancel]);
}

function scheduleInteractiveMapLayout(view, orientationEvent = false) {
    view.orientationEvent = view.orientationEvent || orientationEvent;
    if (view.layoutFrame != null) return;
    view.layoutFrame = window.requestAnimationFrame(() => {
        view.layoutFrame = null;
        if (!isCurrentMapView(view)) return;
        const orientation = currentMapOrientation();
        // 高さだけの変化（アドレスバー・キーボード）では拡大位置を初期化しない。
        const fallbackOrientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
        const nextOrientation = orientation || (view.orientationEvent ? fallbackOrientation : view.orientation);
        const rotated = nextOrientation !== view.orientation;
        view.orientation = nextOrientation;
        view.orientationEvent = false;
        fitInteractiveMapImage(view);
        if (rotated) {
            const searchedNumber = view.selectedNumber;
            if (searchedNumber) focusInteractiveMapSearch(view, searchedNumber);
            else resetInteractiveMapOverview(view);
        }
        else if (view.panzoom) constrainInteractiveMapPan(view);
    });
}

function initializeInteractiveMap(view) {
    if (!isCurrentMapView(view)) return;
    view.element = view.modal.querySelector('#panzoom-container');
    view.viewport = view.modal.querySelector('.map-viewport');
    view.listeners = [];
    try {
        view.metrics = ParkingMapData.measureSpots(view.spots, view.image.naturalWidth, view.image.naturalHeight);
        fitInteractiveMapImage(view);
        if (!view.fitScale) throw new Error('地図の表示領域がありません。');
        setInteractiveMapMode(view, 'overview');
        view.observedScale = 1;
        view.panzoom = Panzoom(view.element, { minScale: 1, maxScale: view.maxScale, canvas: true });
        setupInteractiveMapGestures(view);
        setupInteractiveMapControls(view);
        setupInteractiveMapSearch(view);
        view.listeners.push([view.element, 'panzoomchange', () => {
            if (isCurrentMapView(view)) constrainInteractiveMapPan(view);
        }]);
    } catch (error) {
        failInteractiveMap(error);
        return;
    }
    view.orientation = currentMapOrientation() || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    const resize = () => scheduleInteractiveMapLayout(view);
    const rotate = () => scheduleInteractiveMapLayout(view, true);
    view.listeners.push([window, 'resize', resize], [window, 'orientationchange', rotate]);
    if (window.screen && window.screen.orientation) view.listeners.push([window.screen.orientation, 'change', rotate]);
    view.listeners.forEach(([target, event, handler, options]) => target.addEventListener(event, handler, options));
    if (window.ResizeObserver) {
        view.resizeObserver = new window.ResizeObserver(resize);
        view.resizeObserver.observe(view.viewport);
    }
}

function closeInteractiveMap() {
    mapRequestId++;
    latestMapStatus = null;
    const view = activeMapView;
    activeMapView = null;
    if (view) {
        clearInteractiveMapSearch(view);
        if (view.initTimer != null) clearTimeout(view.initTimer);
        if (view.layoutFrame != null) window.cancelAnimationFrame(view.layoutFrame);
        if (view.settleFrame != null) window.cancelAnimationFrame(view.settleFrame);
        if (view.resizeObserver) view.resizeObserver.disconnect();
        (view.listeners || []).forEach(([target, event, handler, options]) => target.removeEventListener(event, handler, options));
        if (view.wheel) view.viewport.removeEventListener('wheel', view.wheel);
        if (view.panzoom) view.panzoom.destroy();
        view.image.onload = view.image.onerror = null;
        view.modal.remove();
    }
    const modal = document.getElementById('interactiveMapModal');
    if (modal) modal.remove();
    unlockMapPageScroll();
}

// 2. マップを開き、個別マスを生成する（A案：リアルタイム都度取得＆塗り分け版）
async function openInteractiveMap(lotId, imgSrc) {
    closeInteractiveMap();
    const requestId = ++mapRequestId;

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
        showNotification('この駐車場の地図の枠は準備中です。時間をおいて再度確認してください。', 'error');
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
    mapModal.setAttribute('role', 'dialog');
    mapModal.setAttribute('aria-modal', 'true');
    mapModal.setAttribute('aria-labelledby', 'interactive-map-title');
    document.body.appendChild(mapModal);
    lockMapPageScroll();

    const img = new Image();
    const view = { requestId, lotId: String(lotId), lot, statusRows: latestParkingStatus, spots: currentSpots, modal: mapModal, image: img,
        initTimer: null, layoutFrame: null, settleFrame: null, mode: 'overview', busy: false };
    activeMapView = view;
    img.onerror = () => {
        if (!isCurrentMapView(view)) return;
        closeInteractiveMap();
        showNotification('地図画像を読み込めません。時間をおいて地図を開き直してください。', 'error');
    };
    img.onload = () => {
        if (requestId !== mapRequestId || !currentUser) {
            mapModal.remove();
            return;
        }

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
            return `<polygon id="spot-${lotId}-${spot.id}" points="${pts}" class="spot-polygon" style="display: block; fill: ${fillColor}; stroke: ${strokeColor}; stroke-width: ${strokeWidth}; cursor: pointer;"><title>${spot.id}番${isMySpot ? '（自分の駐車枠）' : ''}</title></polygon>${numberLabel}`;
        }).join('');

        const escapeMapText = value => String(value).replace(/[&<>"']/g, character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
        const name = lot.name || `第${lotId}駐車場`;
        const provisional = [3, 7].includes(Number(lotId));
        const title = `${name}：${lot.capacity}台${provisional ? '（暫定・位置を確認中）' : ''}`;
        mapModal.innerHTML = `
            <div class="map-zoom-content">
                <header class="map-header">
                    <div class="map-title-row">
                    <h2 class="map-heading" id="interactive-map-title" aria-label="${escapeMapText(title)}" title="${escapeMapText(title)}">
                        <span class="map-lot-name">${escapeMapText(name)}</span>
                        <span class="map-capacity">${lot.capacity}台${provisional ? '<small class="map-provisional">暫定</small>' : ''}</span>
                    </h2>
                    <button type="button" class="map-close" aria-label="マップを閉じる" onclick="closeInteractiveMap()">&times;</button>
                    </div>
                    <form class="map-search panzoom-exclude" aria-label="駐車枠番号で探す">
                        <label for="map-space-number">枠番号</label>
                        <input id="map-space-number" class="map-search-input" type="text" inputmode="numeric" enterkeyhint="search" autocomplete="off" placeholder="例：128" aria-describedby="map-search-error" maxlength="12">
                        <button type="submit" class="map-search-submit" disabled>準備中…</button>
                    </form>
                    <p id="map-search-error" class="map-search-error" role="alert" hidden></p>
                </header>
                <div class="map-viewport">
                    <p class="map-guide" role="status" aria-live="polite">見たい場所をタップして拡大</p>
                    <div id="panzoom-container">
                        <img class="map-image" src="${imgSrc}" alt="${escapeMapText(name)}の地図" draggable="false">
                        <svg class="map-spots-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
                            ${spotsSvg}
                        </svg>
                    </div>
                    <div class="map-controls panzoom-exclude" role="group" aria-label="地図の表示操作">
                        <button type="button" data-map-action="in" aria-label="地図を拡大">＋</button>
                        <button type="button" data-map-action="out" aria-label="地図を縮小">−</button>
                        <button type="button" data-map-action="overview" class="map-overview-button" aria-label="地図全体を表示">全体表示</button>
                    </div>
                </div>
                <footer class="map-footer">
                    <section class="map-search-result" aria-label="検索結果" hidden>
                        <div class="map-search-result-info" role="status" aria-live="polite">
                            <strong class="map-search-result-title"></strong>
                            <span class="map-search-result-state"></span>
                            <small class="map-search-result-note"></small>
                        </div>
                        <button type="button" class="map-search-action" hidden></button>
                    </section>
                    <div class="map-legend" aria-label="駐車枠の色の意味">
                        <span><i class="map-swatch map-swatch-available" aria-hidden="true"></i>緑：空き</span>
                        <span><i class="map-swatch map-swatch-occupied" aria-hidden="true"></i>赤：使用中</span>
                        <span><i class="map-swatch map-swatch-own" aria-hidden="true"></i>黄枠：自分</span>
                    </div>
                    <p class="map-instruction">空き枠から入庫・自分の枠から出庫</p>
                </footer>
            </div>`;
        mapModal.style.display = 'flex';
        view.initTimer = setTimeout(() => initializeInteractiveMap(view), 100);
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
