// 統合マップの番号検索。座標・状態の照合と位置計算だけを扱い、登録は実行しない。
(function (root) {
    'use strict';
    const geometry = typeof module !== 'undefined' && module.exports
        ? require('./parking-map-data') : root.ParkingMapData;

    function parseNumber(value) {
        const text = String(value == null ? '' : value).normalize('NFKC').trim();
        if (!text) throw new Error('駐車枠番号を入力してください。');
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1) {
            throw new Error('1以上の整数で駐車枠番号を入力してください。');
        }
        return Number(text);
    }

    function findSpot(lot, spots, value) {
        const number = parseNumber(value);
        if (!Array.isArray(lot.spaces)) throw new Error('番号データを確認できません。地図を開き直してください。');
        const registered = lot.spaces.find(space => Number(space.id) === number);
        if (!registered) throw new Error(`${lot.name || `第${lot.id}駐車場`}に${number}番はありません。`);
        const spot = spots.find(item => item.id === number);
        if (!spot) throw new Error(`${number}番は存在しますが、現在図面の位置を表示できません。`);
        return spot;
    }

    function validateStatus(rows) {
        const keys = new Set();
        if (!Array.isArray(rows) || rows.some(row => {
            if (!row || !Number.isInteger(Number(row.lot_id)) || Number(row.lot_id) < 1 ||
                !Number.isInteger(Number(row.spot_number)) || Number(row.spot_number) < 1 ||
                !['available', 'occupied'].includes(row.status)) return true;
            const key = `${Number(row.lot_id)}:${Number(row.spot_number)}`;
            if (keys.has(key)) return true;
            keys.add(key); return false;
        })) throw new Error('空き情報を確認できません。地図を開き直して再試行してください。');
        return rows;
    }

    function spaceState(lotId, number, rows, mine) {
        if (mine && String(mine.lot_id) === String(lotId) && Number(mine.space_id) === number) {
            return { kind: 'own', label: '自分の駐車枠', action: 'checkout', endTime: mine.estimated_end_time || '未定' };
        }
        const status = rows.find(row => String(row.lot_id) === String(lotId) && Number(row.spot_number) === number);
        // 既存の取得API・マップと同じく、状態行がない登録枠は空きとして扱う。
        return status && status.status === 'occupied'
            ? { kind: 'occupied', label: '使用中', action: null, endTime: status.end_time || '未定' }
            : { kind: 'available', label: '空き', action: 'checkin', endTime: null };
    }

    function focusPosition(metrics, number, fitScale, currentScale, maxScale, viewportWidth, viewportHeight, lotId) {
        const spot = metrics.spots.find(item => item.id === number);
        if (!spot) throw new Error(`${number}番の位置を計算できません。`);
        let point = spot.center;
        if (!geometry.containsPoint(spot.polygon, point)) {
            const xs = spot.polygon.map(p => p[0]), ys = spot.polygon.map(p => p[1]);
            const candidates = [];
            for (let x = 1; x < 10; x++) for (let y = 1; y < 10; y++) {
                const p = [Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * x / 10,
                    Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * y / 10];
                if (geometry.containsPoint(spot.polygon, p)) candidates.push(p);
            }
            candidates.sort((a, b) => Math.hypot(a[0] - point[0], a[1] - point[1]) - Math.hypot(b[0] - point[0], b[1] - point[1]));
            if (!candidates.length) throw new Error(`${number}番の位置を計算できません。`);
            point = candidates[0];
        }
        const local = geometry.zoomForPoint(metrics, fitScale, currentScale, point);
        const labelFont = (metrics.spots.length > 100 && Number(lotId) !== 7 ? 0.45 : 0.9) * metrics.height / 100;
        const wanted = Math.max(local.autoScale, 32 / (spot.shortSide * fitScale), 14 / (labelFont * fitScale));
        const scale = Math.max(currentScale, Math.min(maxScale, wanted));
        const pan = geometry.clampMapPan({ x: (metrics.width / 2 - point[0]) * fitScale,
            y: (metrics.height / 2 - point[1]) * fitScale }, metrics.width * fitScale, metrics.height * fitScale,
            viewportWidth, viewportHeight, scale);
        return { number, point, scale, pan, limited: labelFont * fitScale * scale < 13.9 };
    }

    const api = { parseNumber, findSpot, validateStatus, spaceState, focusPosition };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ParkingMapSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
