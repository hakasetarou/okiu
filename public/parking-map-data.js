// 地図表示と座標設定画面で、同じ座標形式を使う。
(function (root) {
    const lotIds = [1, 2, 3, 4, 5, 7];

    function spotFile(lotId) {
        const id = Number(lotId);
        if (!lotIds.includes(id)) throw new Error('対象外の駐車場です。');
        return `/data/parking-spots/lot-${id}.json`;
    }

    function validateSpots(spots, capacity = Infinity) {
        if (!Array.isArray(spots)) throw new Error('座標データは配列で指定してください。');
        const ids = new Set();
        return spots.map(spot => {
            if (!spot || !Number.isInteger(spot.id) || spot.id < 1 || spot.id > capacity) {
                throw new Error('枠番号が収容台数の範囲外です。台数と座標を確認してください。');
            }
            if (ids.has(spot.id)) throw new Error(`${spot.id}番の座標が重複しています。`);
            ids.add(spot.id);
            if (!Array.isArray(spot.polygon) || spot.polygon.length < 3 ||
                spot.polygon.some(point => !Array.isArray(point) || point.length !== 2 ||
                    point.some(value => !Number.isFinite(value) || value < 0 || value > 100))) {
                throw new Error(`${spot.id}番の座標が正しくありません。`);
            }
            const area = spot.polygon.reduce((sum, point, index, points) => {
                const next = points[(index + 1) % points.length];
                return sum + point[0] * next[1] - next[0] * point[1];
            }, 0);
            if (Math.abs(area) < 0.000001) throw new Error(`${spot.id}番の枠に面積がありません。`);
            const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            const points = spot.polygon;
            for (let i = 0; i < points.length; i++) {
                for (let j = i + 2; j < points.length; j++) {
                    if (i === 0 && j === points.length - 1) continue;
                    const a = points[i], b = points[(i + 1) % points.length];
                    const c = points[j], d = points[(j + 1) % points.length];
                    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) {
                        throw new Error(`${spot.id}番の枠の線が交差しています。四隅を外周に沿って指定してください。`);
                    }
                }
            }
            return { id: spot.id, name: String(spot.id), polygon: spot.polygon.map(point => [...point]) };
        }).sort((a, b) => a.id - b.id);
    }

    // 一列の四隅を囲み、両端を等分して各駐車枠を作る。
    function rowSpots(startId, count, corners) {
        if (!Number.isInteger(startId) || startId < 1 || !Number.isInteger(count) || count < 1 ||
            !Array.isArray(corners) || corners.length !== 4) {
            throw new Error('開始番号、台数、四隅の座標を確認してください。');
        }
        validateSpots([{ id: startId, polygon: corners }]);
        const between = (a, b, fraction) => a.map((value, index) =>
            Math.round((value + (b[index] - value) * fraction) * 1000) / 1000);
        const spots = Array.from({ length: count }, (_, index) => ({
            id: startId + index,
            polygon: [
                between(corners[0], corners[1], index / count),
                between(corners[0], corners[1], (index + 1) / count),
                between(corners[3], corners[2], (index + 1) / count),
                between(corners[3], corners[2], index / count)
            ]
        }));
        return validateSpots(spots);
    }

    function percentile(values, fraction) {
        if (!values.length || values.some(value => !Number.isFinite(value)) || fraction < 0 || fraction > 1) {
            throw new Error('枠サイズの代表値を計算できません。');
        }
        const sorted = [...values].sort((a, b) => a - b);
        const position = (sorted.length - 1) * fraction;
        const index = Math.floor(position);
        return sorted[index] + (sorted[Math.min(index + 1, sorted.length - 1)] - sorted[index]) * (position - index);
    }

    // 輪郭の細かい段差を短辺と誤認しないよう、外周を囲む最小面積の長方形を探す。
    function polygonShortSide(points) {
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const half = sequence => {
            const result = [];
            sequence.forEach(point => {
                while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) result.pop();
                result.push(point);
            });
            return result.slice(0, -1);
        };
        const hull = half(sorted).concat(half([...sorted].reverse()));
        let bestArea = Infinity;
        let shortSide = 0;
        hull.forEach((point, index) => {
            const next = hull[(index + 1) % hull.length];
            const length = Math.hypot(next[0] - point[0], next[1] - point[1]);
            if (!length) return;
            const ux = (next[0] - point[0]) / length, uy = (next[1] - point[1]) / length;
            const horizontal = hull.map(p => p[0] * ux + p[1] * uy);
            const vertical = hull.map(p => -p[0] * uy + p[1] * ux);
            const width = Math.max(...horizontal) - Math.min(...horizontal);
            const height = Math.max(...vertical) - Math.min(...vertical);
            if (width * height < bestArea - 1e-10) {
                bestArea = width * height;
                shortSide = Math.min(width, height);
            }
        });
        if (!(shortSide > 0) || !Number.isFinite(shortSide)) throw new Error('駐車枠の大きさを計算できません。');
        return shortSide;
    }

    // 元画像のピクセル単位で一度だけ計算する。表示サイズ変更時はfitScaleを掛け直す。
    function measureSpots(spots, width, height) {
        if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('地図画像のサイズが正しくありません。');
        const measured = validateSpots(spots).map(spot => {
            const polygon = spot.polygon.map(([x, y]) => [x * width / 100, y * height / 100]);
            const center = polygon.reduce((sum, point) => [sum[0] + point[0] / polygon.length, sum[1] + point[1] / polygon.length], [0, 0]);
            return { id: spot.id, polygon, center, shortSide: polygonShortSide(polygon) };
        });
        const sizes = measured.map(spot => spot.shortSide);
        return { width, height, spots: measured, median: percentile(sizes, 0.5), lowerDecile: percentile(sizes, 0.1) };
    }

    function mapSizing(metrics, fitScale) {
        if (!Number.isFinite(fitScale) || fitScale <= 0) throw new Error('地図の表示サイズが正しくありません。');
        const shortSide = metrics.median * fitScale;
        const maxScale = Math.min(16, Math.max(5, Math.ceil(32 / (metrics.lowerDecile * fitScale) * 1.3)));
        return { shortSide, maxScale };
    }

    function zoomForPoint(metrics, fitScale, currentScale, point) {
        const sizing = mapSizing(metrics, fitScale);
        const nearby = metrics.spots.map(spot => ({ spot, distance: Math.hypot(spot.center[0] - point[0], spot.center[1] - point[1]) * fitScale * currentScale }))
            .filter(item => item.distance <= 120).sort((a, b) => a.distance - b.distance || a.spot.id - b.spot.id).slice(0, 8);
        const shortSide = (nearby.length ? percentile(nearby.map(item => item.spot.shortSide), 0.5) : metrics.median) * fitScale;
        return { shortSide, displayedShortSide: shortSide * currentScale,
            autoScale: Math.min(sizing.maxScale, Math.max(1, 32 / shortSide)),
            maxScale: sizing.maxScale, nearbyIds: nearby.map(item => item.spot.id) };
    }

    function containsPoint(polygon, point) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[j], b = polygon[i];
            const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
            if (Math.abs(cross) < 1e-8 && point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) &&
                point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1])) return true;
            if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        return inside;
    }

    function clampMapPan(pan, width, height, viewportWidth, viewportHeight, scale) {
        const limitX = Math.max(0, (width - viewportWidth / scale) / 2);
        const limitY = Math.max(0, (height - viewportHeight / scale) / 2);
        return { x: Math.max(-limitX, Math.min(limitX, pan.x)), y: Math.max(-limitY, Math.min(limitY, pan.y)) };
    }

    const api = { lotIds, spotFile, validateSpots, rowSpots, percentile, measureSpots, mapSizing, zoomForPoint, containsPoint, clampMapPan };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ParkingMapData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
