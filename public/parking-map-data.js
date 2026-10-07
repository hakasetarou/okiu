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

    const api = { lotIds, spotFile, validateSpots, rowSpots };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ParkingMapData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
