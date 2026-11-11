const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { measureSpots, percentile, mapSizing, zoomForPoint, containsPoint, clampMapPan } = require('../public/parking-map-data');

test('short side accounts for image aspect ratio, rotation, and small outline segments', () => {
    // 30度回転した20×40pxの長方形。辺の途中に点を追加しても短辺は20px。
    const angle = Math.PI / 6;
    const polygon = [[0,0],[10,0],[20,0],[20,40],[0,40]].map(([x,y]) =>
        [(100 + x * Math.cos(angle) - y * Math.sin(angle)) / 4, (100 + x * Math.sin(angle) + y * Math.cos(angle)) / 2]);
    const metrics = measureSpots([{ id: 1, polygon }], 400, 200);
    assert.ok(Math.abs(metrics.median - 20) < 1e-8);
    assert.equal(mapSizing(metrics, 0.5).shortSide, metrics.median * 0.5);
    assert.ok(Math.abs(zoomForPoint(metrics, 0.5, 1, [110,110]).autoScale - 3.2) < 1e-8);
    assert.equal(percentile([1,2,100,3], 0.5), 2.5);
});

test('nearby sampling uses CSS distance, nearest eight, and global fallback without double scaling', () => {
    const spots = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, polygon: [[i*5,0],[i*5+2,0],[i*5+2,10],[i*5,10]] }));
    const metrics = measureSpots(spots, 1000, 500);
    const local = zoomForPoint(metrics, 0.1, 1, [0,25]);
    assert.deepEqual(local.nearbyIds, [1,2,3,4,5,6,7,8]);
    const zoomed = zoomForPoint(metrics, 0.1, 4, [0,25]);
    assert.ok(zoomed.nearbyIds.length < 8);
    assert.equal(zoomed.autoScale, local.autoScale);
    const fallback = zoomForPoint(metrics, 0.1, 1, [10000,10000]);
    assert.deepEqual(fallback.nearbyIds, []);
    assert.equal(fallback.shortSide, metrics.median * 0.1);
    assert.equal(fallback.autoScale, 16);
    assert.equal(containsPoint(metrics.spots[0].polygon, [10,20]), true);
    assert.equal(containsPoint(metrics.spots[0].polygon, [25,20]), false);
});

test('all six real maps agree with the investigation at 393px and recalculate for smaller screens', () => {
    for (const [id, median, max] of [[1,3.90249,11],[2,5.948775,8],[3,2.556045,16],[4,12.471432,5],[5,14.105986,5],[7,10.994410,5]]) {
        const spec = JSON.parse(fs.readFileSync(`docs/lot-${id}-map-rows.json`, 'utf8'));
        const metrics = measureSpots(JSON.parse(fs.readFileSync(`public/data/parking-spots/lot-${id}.json`, 'utf8')), spec.width, spec.height);
        const sizing = mapSizing(metrics, 393 / spec.width);
        assert.ok(Math.abs(sizing.shortSide - median) < 0.002, `lot ${id}: ${sizing.shortSide}`);
        assert.equal(sizing.maxScale, max, `lot ${id}`);
        const smaller = mapSizing(metrics, 360 / spec.width);
        assert.ok(smaller.shortSide < sizing.shortSide);
        assert.ok(smaller.maxScale >= sizing.maxScale);
        const landscapeFit = Math.min(852 / spec.width, 300 / spec.height);
        assert.ok(mapSizing(metrics, landscapeFit).shortSide > 0);
    }
});

test('extreme small bays are capped, large bays may select at one, and invalid geometry is rejected', () => {
    const metrics = measureSpots([{id:1,polygon:[[0,0],[1,0],[1,10],[0,10]]}], 100, 100);
    assert.equal(zoomForPoint(metrics, 0.1, 1, [0,0]).autoScale, 16);
    assert.equal(zoomForPoint(metrics, 40, 1, [0,0]).autoScale, 1);
    assert.equal(mapSizing(metrics, 40).maxScale, 5);
    assert.throws(() => measureSpots([{id:1,polygon:[[0,0],[1,1],[2,2]]}], 100, 100));
    assert.throws(() => measureSpots([], 0, 100));
    assert.throws(() => mapSizing(metrics, 0));
});

test('pan limits center small images and keep enlarged edges within the viewport', () => {
    assert.deepEqual(clampMapPan({x:999,y:-999}, 400, 300, 400, 700, 1), {x:0,y:-0});
    assert.deepEqual(clampMapPan({x:999,y:-999}, 400, 300, 400, 700, 4), {x:150,y:-62.5});
});
