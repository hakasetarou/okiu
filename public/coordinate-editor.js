const editor = Object.fromEntries([
    'message', 'lotSelect', 'lotSummary', 'capacity', 'capacityNote', 'drawMode', 'spotNumber',
    'rowCountLabel', 'rowCount', 'drawHelp', 'rowGuide', 'pointCount', 'undoPoint', 'clearPoints',
    'saveSpot', 'progress', 'undoSave', 'deleteSpot', 'spotList', 'importFile', 'download',
    'saveHelp', 'zoomOut', 'zoomIn', 'zoomLabel', 'mapViewport', 'mapStage', 'mapImage', 'mapOverlay'
].map(id => [id, document.getElementById(id)]));

let editorLots = [];
let editorLot = null;
let editorSpots = [];
let editorPoints = [];
let editorHistory = [];
let editorBase = '';
let editorZoom = 1;
let editorLoadId = 0;
let editorImageReady = false;

function editorMessage(message, type = '') {
    editor.message.textContent = message;
    editor.message.className = `message ${type}`;
}

function editorCapacity() {
    const capacity = Number(editor.capacity.value);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2000) {
        throw new Error('設定する台数は1〜2000の整数で入力してください。');
    }
    return capacity;
}

function proposedSpots() {
    const start = Number(editor.spotNumber.value);
    const count = editor.drawMode.value === 'row' ? Number(editor.rowCount.value) : 1;
    if (!Number.isInteger(count) || count < 1 || count > editorCapacity()) {
        throw new Error('一列の台数を確認してください。');
    }
    return ParkingMapData.validateSpots(ParkingMapData.rowSpots(start, count, editorPoints), editorCapacity());
}

function nextSpotNumber() {
    const ids = new Set(editorSpots.map(spot => spot.id));
    let next = 1;
    while (ids.has(next)) next++;
    editor.spotNumber.value = next;
}

function rememberEditor() {
    editorHistory.push(JSON.stringify(editorSpots));
    if (editorHistory.length > 20) editorHistory.shift();
}

function persistEditor() {
    if (!editorLot) return;
    try {
        localStorage.setItem(`parking-coordinate-draft-v1-${editorLot.id}`, JSON.stringify({
            base: editorBase, capacity: editorCapacity(), spots: editorSpots
        }));
    } catch (error) {
        editorMessage('このブラウザへの自動保存ができません。座標ファイルを保存して作業を残してください。', 'error');
    }
}

function polygonMarkup(spot, color) {
    const points = spot.polygon.map(point => point.join(',')).join(' ');
    const x = spot.polygon.reduce((sum, point) => sum + point[0], 0) / spot.polygon.length;
    const y = spot.polygon.reduce((sum, point) => sum + point[1], 0) / spot.polygon.length;
    return `<polygon points="${points}" fill="${color}" fill-opacity=".3" stroke="${color}" stroke-width=".15"/>
        <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size=".8" fill="#172533">${spot.id}</text>`;
}

function renderEditor() {
    let overlay = editorSpots.map(spot => polygonMarkup(spot, '#198754')).join('');
    if (editorPoints.length === 4) {
        try { overlay += proposedSpots().map(spot => polygonMarkup(spot, '#e37813')).join(''); }
        catch (error) { /* 保存ボタンを押したときに入力エラーを説明する。 */ }
    }
    if (editorPoints.length) {
        overlay += `<polyline points="${editorPoints.map(point => point.join(',')).join(' ')}" fill="none" stroke="#e37813" stroke-width=".2"/>`;
        overlay += editorPoints.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r=".35" fill="#e37813"/>
            <text x="${x + .5}" y="${y - .5}" font-size="1.2" fill="#9b4200">${index + 1}</text>`).join('');
    }
    editor.mapOverlay.innerHTML = overlay;
    editor.pointCount.textContent = `指定した角：${editorPoints.length} / 4`;
    editor.saveSpot.disabled = !editorImageReady || editorPoints.length !== 4;
    editor.undoPoint.disabled = editorPoints.length === 0;
    editor.clearPoints.disabled = editorPoints.length === 0;
    editor.undoSave.disabled = editorHistory.length === 0;
    editor.download.disabled = !editorLot || editorSpots.length === 0;
    editor.spotList.replaceChildren();
    editorSpots.forEach(spot => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = spot.id;
        button.title = `${spot.id}番を編集`;
        button.onclick = () => {
            editor.drawMode.value = 'single';
            updateDrawMode();
            editor.spotNumber.value = spot.id;
            editorPoints = spot.polygon.map(point => [...point]);
            editorMessage(`${spot.id}番を選択しました。位置を直す場合は「角を取り直す」を押してください。`);
            renderEditor();
        };
        editor.spotList.appendChild(button);
    });
    const capacity = Number(editor.capacity.value);
    const missing = Array.from({ length: Math.max(0, Math.min(2000, capacity || 0)) }, (_, index) => index + 1)
        .filter(id => !editorSpots.some(spot => spot.id === id));
    editor.progress.textContent = `設定済み：${editorSpots.length}枠 / ${capacity || 0}台（未設定：${missing.length}枠）`;
    if (editorLot) {
        editor.capacityNote.textContent = capacity === editorLot.capacity
            ? '登録可能台数と一致しています。'
            : `現在の登録可能台数は${editorLot.capacity}台です。地図で使う前に、登録可能台数との一致が必要です。ここでの入力は登録可能台数を変更しません。`;
    }
}

function updateDrawMode() {
    const isRow = editor.drawMode.value === 'row';
    editor.rowCountLabel.hidden = !isRow;
    editor.rowGuide.hidden = !isRow;
    editor.drawHelp.textContent = isRow
        ? '一列全体の四隅を図の1→2→3→4の順にクリックしてください。1→2へ向かって枠番号が増えます。両面の列は片側ずつ指定します。'
        : '枠の四隅を、外周に沿って順番にクリックしてください。';
}

async function editorJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`データを読み込めません（${response.status}）。`);
    return response.json();
}

async function loadEditorLot() {
    const loadId = ++editorLoadId;
    editorLot = null;
    editorSpots = [];
    editorPoints = [];
    editorHistory = [];
    editorImageReady = false;
    editor.mapStage.hidden = true;
    editor.lotSummary.textContent = '';
    editor.capacityNote.textContent = '';
    editor.saveHelp.textContent = '';
    editorMessage('地図と座標を読み込んでいます…');
    renderEditor();
    try {
        const lot = editorLots.find(item => String(item.id) === editor.lotSelect.value);
        if (!lot || !lot.imageUrl) throw new Error('この駐車場の地図画像が見つかりません。');
        const storedSpots = ParkingMapData.validateSpots(await editorJson(ParkingMapData.spotFile(lot.id)));
        if (loadId !== editorLoadId) return;
        editorLot = lot;
        editorSpots = storedSpots;
        editorBase = JSON.stringify({ image: lot.imageUrl, spots: storedSpots });
        editor.capacity.value = Math.max(lot.capacity, ...storedSpots.map(spot => spot.id));
        let restored = false;
        try {
            const draft = JSON.parse(localStorage.getItem(`parking-coordinate-draft-v1-${lot.id}`));
            if (draft && draft.base === editorBase && Number.isInteger(draft.capacity) && draft.capacity > 0 && draft.capacity <= 2000) {
                editorSpots = ParkingMapData.validateSpots(draft.spots, draft.capacity);
                editor.capacity.value = draft.capacity;
                restored = true;
            }
        } catch (error) { /* 古い形式や破損した下書きは使わず、保存済みの座標を読み込む。 */ }
        editor.lotSummary.textContent = `${lot.name}・登録可能台数：${lot.capacity}台`;
        editor.saveHelp.textContent = `保存先：public/data/parking-spots/lot-${lot.id}.json（同名ファイルを置き換えます）`;
        nextSpotNumber();
        editorZoom = 1;
        editor.mapStage.style.width = '100%';
        editor.zoomLabel.textContent = '100%';
        editor.mapImage.onload = () => {
            if (loadId !== editorLoadId) return;
            editorImageReady = true;
            editor.mapStage.hidden = false;
            renderEditor();
            editorMessage(restored ? 'このブラウザに保存した作業途中の座標を復元しました。' : '地図を読み込みました。枠の四隅を指定してください。', 'success');
        };
        editor.mapImage.onerror = () => {
            if (loadId !== editorLoadId) return;
            editorImageReady = false;
            editor.mapStage.hidden = true;
            renderEditor();
            editorMessage('地図画像を読み込めません。画像ファイルを確認してください。', 'error');
        };
        editor.mapImage.src = lot.imageUrl;
        renderEditor();
    } catch (error) {
        if (loadId === editorLoadId) editorMessage(error.message, 'error');
    }
}

editor.mapOverlay.addEventListener('click', event => {
    if (!editorImageReady) return;
    if (editorPoints.length >= 4) return editorMessage('四隅を指定済みです。枠を保存するか、角を取り直してください。');
    const bounds = editor.mapOverlay.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) / bounds.width * 100;
    const y = (event.clientY - bounds.top) / bounds.height * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    editorPoints.push([Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    renderEditor();
});
editor.undoPoint.onclick = () => { editorPoints.pop(); renderEditor(); };
editor.clearPoints.onclick = () => { editorPoints = []; renderEditor(); };
editor.drawMode.onchange = () => { editorPoints = []; updateDrawMode(); renderEditor(); };
editor.rowCount.oninput = renderEditor;
editor.spotNumber.oninput = renderEditor;
editor.capacity.onchange = () => {
    try { editorCapacity(); renderEditor(); persistEditor(); }
    catch (error) { editorMessage(error.message, 'error'); }
};
editor.saveSpot.onclick = () => {
    if (!editorImageReady) return;
    try {
        const additions = proposedSpots();
        const ids = new Set(additions.map(spot => spot.id));
        const merged = ParkingMapData.validateSpots([...editorSpots.filter(spot => !ids.has(spot.id)), ...additions], editorCapacity());
        rememberEditor();
        editorSpots = merged;
        editorPoints = [];
        nextSpotNumber();
        renderEditor();
        editorMessage(`${additions[0].id}〜${additions.at(-1).id}番の${additions.length}枠を保存しました。`, 'success');
        persistEditor();
    } catch (error) { editorMessage(error.message, 'error'); }
};
editor.undoSave.onclick = () => {
    if (!editorHistory.length) return;
    editorSpots = JSON.parse(editorHistory.pop());
    editorPoints = [];
    nextSpotNumber();
    renderEditor();
    editorMessage('前の保存状態に戻しました。');
    persistEditor();
};
editor.deleteSpot.onclick = () => {
    const id = Number(editor.spotNumber.value);
    if (!editorSpots.some(spot => spot.id === id)) return editorMessage('その番号の枠は設定されていません。', 'error');
    rememberEditor();
    editorSpots = editorSpots.filter(spot => spot.id !== id);
    editorPoints = [];
    renderEditor();
    editorMessage(`${id}番の座標を削除しました。番号の繰り上げは行いません。`);
    persistEditor();
};
editor.importFile.onchange = async () => {
    const file = editor.importFile.files[0];
    if (!file || !editorLot) return;
    const loadId = editorLoadId;
    try {
        const imported = ParkingMapData.validateSpots(JSON.parse(await file.text()), editorCapacity());
        if (loadId !== editorLoadId) return;
        rememberEditor();
        editorSpots = imported;
        editorPoints = [];
        nextSpotNumber();
        renderEditor();
        editorMessage(`${imported.length}枠の座標を読み込みました。`, 'success');
        persistEditor();
    } catch (error) { if (loadId === editorLoadId) editorMessage(error.message, 'error'); }
    finally { editor.importFile.value = ''; }
};
editor.download.onclick = () => {
    if (!editorLot) return;
    try {
        const spots = ParkingMapData.validateSpots(editorSpots, editorCapacity());
        if (!spots.length) throw new Error('座標を指定してから保存してください。');
        const url = URL.createObjectURL(new Blob([JSON.stringify(spots, null, 2) + '\n'], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `lot-${editorLot.id}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        editorMessage(`${link.download}を保存しました。表示されている保存先へ置き換えてください。`, 'success');
    } catch (error) { editorMessage(error.message, 'error'); }
};
function editorChangeZoom(amount) {
    editorZoom = Math.max(1, Math.min(5, editorZoom + amount));
    editor.mapStage.style.width = `${editorZoom * 100}%`;
    editor.zoomLabel.textContent = `${editorZoom * 100}%`;
}
editor.zoomIn.onclick = () => editorChangeZoom(.5);
editor.zoomOut.onclick = () => editorChangeZoom(-.5);
editor.lotSelect.onchange = loadEditorLot;

(async () => {
    try {
        const lots = await editorJson('/api/parking-data');
        if (!Array.isArray(lots)) throw new Error('駐車場の一覧を読み込めません。');
        editorLots = lots.filter(lot => ParkingMapData.lotIds.includes(Number(lot.id)));
        if (!editorLots.length) throw new Error('対象の駐車場がありません。');
        editorLots.forEach(lot => {
            const option = document.createElement('option');
            option.value = lot.id;
            option.textContent = lot.name;
            editor.lotSelect.appendChild(option);
        });
        editor.lotSelect.disabled = false;
        await loadEditorLot();
    } catch (error) { editorMessage(error.message, 'error'); }
})();
