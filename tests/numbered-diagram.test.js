const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { labelLayout, labelVisibility, autoZoomForPoint, create } = require('../public/numbered-diagram');
const { containsPoint } = require('../public/parking-map-data');
const capacities = { 1: 530, 2: 205, 3: 706, 4: 78, 5: 61, 7: 104 };
const coordinates = id => JSON.parse(fs.readFileSync(`public/data/parking-spots/lot-${id}.json`));
const dimensions = id => JSON.parse(fs.readFileSync(`docs/lot-${id}-map-rows.json`));
const lot = id => ({ id, name: `第${id}駐車場`, capacity: capacities[id], imageUrl: `images/img${id}.jpg`,
    spaces: Array.from({ length: capacities[id] }, (_, i) => ({ id: i + 1, isParked: i === 1 })) });

test('second lot reproduces 109/205: 99 is visible, 100 is below 11px, and collision hiding is zero', () => {
    const labels = labelLayout(coordinates(2), 823, 777), scale = 2.8934829247122344;
    const states = labelVisibility(labels, scale);
    assert.equal(states.filter(s => s.visible).length, 109);
    assert.equal(labels.filter(l => l.fontSize * scale < 11).length, 96);
    assert.equal(states.find(s => s.id === 99).visible, true);
    assert.equal(states.find(s => s.id === 100).visible, false);
    assert.equal(labels.filter(l => l.fontSize * scale >= 11).length, 109);
    assert.equal(labelVisibility(labels, scale * 1.5).filter(s => s.visible).length, 205);
});

test('guide states that the count is for the whole diagram and explains how to reveal zero labels', async () => {
    const page = fakePage(); await page.controller.show(lot(2)); page.controller.openZoom();
    assert.match(page.el('imageZoomGuide').textContent, /図面全体の番号表示対象：0 \/ 205件/);
    assert.match(page.el('imageZoomGuide').textContent, /見たい場所をタップ/);
    assert.match(page.el('imageZoomGuide').textContent, /位置確認専用/);
    page.controller.close();
});

test('auto zoom keeps regular three-digit labels, ignores an isolated tiny outlier, and respects the existing limit', () => {
    const labels = [{ id: 99, x: 20, y: 20, fontSize: 4.76 }, { id: 100, x: 30, y: 20, fontSize: 3.67 },
        { id: 101, x: 40, y: 20, fontSize: 3.69 }, { id: 102, x: 50, y: 20, fontSize: 0.1 }];
    const result = autoZoomForPoint(labels, 0.5, 1, [30,20], 10);
    assert.deepEqual(result.excludedIds, [102]);
    assert.ok(Math.abs(result.scale * 0.5 * 3.67 - 14) < 1e-8);
    assert.equal(result.needsZoom, true);
    assert.equal(autoZoomForPoint(labels, 0.5, result.scale, [30,20], 10).needsZoom, false);
    const capped = autoZoomForPoint(labels, 0.5, 1, [30,20], 2);
    assert.equal(capped.scale, 2); assert.equal(capped.limited, true);
    assert.equal(autoZoomForPoint([], 1, 1, [0,0], 8), null);
});

test('nearby sampling uses current CSS distances, nearest eight, and a representative global fallback', () => {
    const labels = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, x: i * 10, y: 0, fontSize: 4 }));
    assert.deepEqual(autoZoomForPoint(labels, 1, 1, [0,0], 8).nearbyIds, [1,2,3,4,5,6,7,8]);
    assert.deepEqual(autoZoomForPoint(labels, 1, 10, [0,0], 12).nearbyIds, [1,2]);
    const fallback = autoZoomForPoint(labels, 1, 1, [1000,1000], 8);
    assert.deepEqual(fallback.nearbyIds, []); assert.equal(fallback.scale, 3.5);
});

for (const id of [1, 2, 3, 4, 5, 7]) {
    test(`lot ${id}: all ${capacities[id]} original numbers fit inside their own polygons at both viewport widths`, () => {
        const { width, height } = dimensions(id), spots = coordinates(id);
        const before = JSON.stringify(spots), labels = labelLayout(spots, width, height);
        assert.equal(JSON.stringify(spots), before, 'source coordinates are never mutated');
        assert.deepEqual(labels.map(l => l.id), lot(id).spaces.map(s => s.id));
        for (const label of labels) {
            assert.ok(containsPoint(label.polygon, [label.x, label.y]));
            // 文字と縁取りを含む領域が、凹形を含めて枠の内側に収まる。
            for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
                assert.ok(containsPoint(label.polygon, [label.x + dx * label.fontSize * String(label.id).length * 0.325,
                    label.y + dy * label.fontSize * 0.6]), `${id}/${label.id}`);
            }
        }
        for (const viewport of [360, 900]) {
            const fit = Math.min(viewport / width, 600 / height);
            const max = Math.max(8, Math.min(128, Math.ceil(16 / (Math.min(...labels.map(l => l.fontSize)) * fit))));
            assert.equal(labelVisibility(labels, fit * max).filter(l => l.visible).length, capacities[id]);
        }
    });
}

for (const id of [1, 2, 3, 4, 5, 7]) {
    test(`lot ${id}: thumbnail tap transfers the source position to the zoom viewer, including bottom and edge positions`, async () => {
        const spec = dimensions(id);
        const page = fakePage(); page.dimensions(spec);
        // 元画面のスクロール位置・中央配置・表示サイズが拡大画面と異なる場合も検証。
        page.el('lotDiagramOpen').clientWidth = 360;
        page.el('lotDiagramOpen').box = { left: 40, top: 180, width: 360, height: 300 };
        page.el('imageZoomViewport').clientWidth = 393;
        page.el('imageZoomViewport').clientHeight = 650;
        await page.controller.show(lot(id));
        const target = [spec.width * 0.5, spec.height * 0.85];
        const [x,y] = clientPoint(page, 'lotDiagramCanvas', target, spec.width,spec.height);
        pointerTap(page, page.el('lotDiagramOpen'), x,y);
        assert.equal(page.el('imageZoomModal').style.display, 'block');
        page.flush(); page.flush(); page.flush();
        const pz = page.instances[0]; assert.equal(pz.zoomCalls, 1);
        const screen = clientPoint(page, 'imageZoomCanvas', target, spec.width,spec.height);
        assert.ok(Math.abs(screen[0] - 393/2) < 1e-7);
        const rect = page.el('imageZoomCanvas').getBoundingClientRect();
        assert.ok(screen[1] >= 0 && screen[1] <= 650);
        assert.ok(Math.abs(screen[1] - 650/2) < 1e-7 || Math.abs(rect.top + rect.height - 650) < 1e-7);
        const zoomNumbers = page.el('zoomedNumbers').children.filter(n => n.attrs.class === 'numbered-diagram-number');
        const previewNumbers = page.el('lotDetailNumbers').children.filter(n => n.attrs.class === 'numbered-diagram-number');
        assert.deepEqual(zoomNumbers.map(n => [n.attrs.x,n.attrs.y]), previewNumbers.map(n => [n.attrs.x,n.attrs.y]));
        page.controller.close(); assert.equal(page.doc.listeners.get('pointerup').size, 0);
    });
}

test('thumbnail margins and drag do not open zoom; keyboard opens an overview without choosing a location', async () => {
    const page = fakePage(); await page.controller.show(lot(2));
    const opener = page.el('lotDiagramOpen');
    const event = { pointerId: 1, button: 0, clientX: 150, clientY: 150, detail: 1 };
    pointerTap(page, opener, 1,1);
    assert.equal(page.instances.length, 0);
    // 互換clickにdetailが0で届いても、ピンチ後にキーボード操作と誤認しない。
    opener.dispatch('pointerdown', event);
    opener.dispatch('pointerdown', { ...event, pointerId: 2, clientX: 170 });
    page.doc.dispatch('pointerup', event); page.doc.dispatch('pointerup', { ...event, pointerId: 2 });
    opener.dispatch('click', { ...event, detail: 0 }); opener.dispatch('click', { ...event, detail: 0 });
    assert.equal(page.instances.length, 0);
    opener.dispatch('pointerdown', event);
    page.doc.dispatch('pointermove', { ...event, clientX: 170 }); page.doc.dispatch('pointerup', event); opener.dispatch('click', event);
    assert.equal(page.instances.length, 0);
    opener.dispatch('keydown', { key: 'Enter' }); opener.dispatch('click', { detail: 0 }); page.flush();
    assert.equal(page.instances.length, 1); assert.equal(page.instances[0].scale, 1);
    page.controller.close();
});

test('all 1684 actual label centers reach the target within existing limits at the requested sizes', () => {
    for (const id of [1,2,3,4,5,7]) {
        const spec = dimensions(id), labels = labelLayout(coordinates(id), spec.width, spec.height);
        for (const [width,height] of [[393,852],[360,800],[1366,768]]) {
            const fit = Math.min(width/spec.width,(height-180)/spec.height);
            const max = Math.max(8,Math.min(128,Math.ceil(16/(Math.min(...labels.map(l=>l.fontSize))*fit))));
            for (const label of labels) {
                const result = autoZoomForPoint(labels,fit,1,[label.x,label.y],max);
                assert.equal(result.limited,false,`${id}/${label.id}, ${width}`);
                assert.ok(label.fontSize*fit*result.scale >= 13.9,`${id}/${label.id}, ${width}`);
                assert.ok(result.scale<=max);
            }
        }
    }
});

test('when the existing maximum cannot reach 14px, the viewer reports it without increasing the maximum', async () => {
    const page = fakePage(); await page.controller.show(lot(2));
    page.el('imageZoomViewport').clientWidth = 20; page.el('imageZoomViewport').clientHeight = 20;
    page.controller.openZoom();
    const pz = page.instances[0], limit = pz.options.maxScale;
    const label = labelLayout(coordinates(2),823,777).find(l=>l.id===100);
    pointerTap(page,page.el('imageZoomViewport'),...clientPoint(page,'imageZoomCanvas',[label.x,label.y],823,777));
    page.flush(); assert.equal(pz.options.maxScale,limit); assert.equal(pz.scale,limit);
    assert.match(page.el('imageZoomGuide').textContent,/倍率上限/);
    page.controller.close();
});

test('closing or resetting before the transferred tap is applied cancels the old scheduled operation', async () => {
    const page = fakePage(); await page.controller.show(lot(2));
    const point = clientPoint(page, 'lotDiagramCanvas', [400,600],823,777);
    pointerTap(page,page.el('lotDiagramOpen'),...point);
    page.flush(); page.controller.closeZoom(); page.flush(); page.flush();
    assert.equal(page.instances[0].zoomCalls, 0); assert.equal(page.frames.size, 0);
    page.controller.openZoom();
    page.controller.closeZoom(); pointerTap(page,page.el('lotDiagramOpen'),...point);
    page.el('imageZoomReset').dispatch('click'); page.flush(); page.flush();
    assert.equal(page.instances[2].scale, 1); assert.equal(page.instances[2].zoomCalls, 0);
    page.controller.close();
});

test('concave polygon uses an internal anchor even when the vertex mean is outside; non-square images remain aligned', () => {
    const polygon = [[0,0],[40,0],[40,10],[10,10],[10,40],[0,40]];
    assert.equal(containsPoint(polygon, [50/3, 50/3]), false);
    for (const [width, height] of [[1000, 200], [200, 1000]]) {
        const [label] = labelLayout([{ id: 706, polygon }], width, height);
        assert.ok(containsPoint(polygon, [label.x * 100 / width, label.y * 100 / height]));
    }
});

test('unreadable labels stay hidden, enlarged labels are capped, and neighboring labels cannot overlap', () => {
    const labels = [{ id: 1, x: 10, y: 10, fontSize: 10 }, { id: 2, x: 10.1, y: 10.1, fontSize: 10 }];
    assert.equal(labelVisibility(labels, 0.2).filter(l => l.visible).length, 0);
    assert.equal(labelVisibility(labels, 2).filter(l => l.visible).length, 1);
    assert.equal(labelVisibility(labels, 10)[0].fontSize, 2);
});

function fakePage(fetchCoordinates = async url => coordinates(Number(url.match(/lot-(\d+)/)[1]))) {
    const elements = new Map(), frames = new Map(), observers = [], instances = [];
    let nextFrame = 0, nextImageFails = false, imageDimensions = { width: 823, height: 777 };
    const doc = { activeElement: null };
    function element() {
        const listeners = new Map(), classes = new Set();
        return { listeners, style: {}, dataset: {}, attrs: {}, children: [], clientWidth: 390, clientHeight: 300,
            isConnected: true, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
            setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
            appendChild(node) { this.children.push(node); }, replaceChildren() { this.children = []; },
            addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
            removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
            dispatch(name, data = {}) { listeners.get(name)?.forEach(fn => fn({ type: name, preventDefault() {}, target: this, ...data })); },
            getBoundingClientRect() {
                if (this.box) return this.box;
                const viewportId = this.id === 'lotDiagramCanvas' ? 'lotDiagramOpen' : this.id === 'imageZoomCanvas' ? 'imageZoomViewport' : null;
                if (viewportId && this.style.width) {
                    const parent = doc.getElementById(viewportId).getBoundingClientRect();
                    const scale = this.panzoomInstance?.scale || 1, pan = this.panzoomInstance?.position || { x: 0, y: 0 };
                    const width = parseFloat(this.style.width) * scale, height = parseFloat(this.style.height) * scale;
                    return { left: parent.left + (parent.width - width) / 2 + pan.x * scale,
                        top: parent.top + (parent.height - height) / 2 + pan.y * scale, width, height };
                }
                return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
            },
            focus() { doc.activeElement = this; }
        };
    }
    Object.assign(doc, element(), { getElementById(id) { if (!elements.has(id)) elements.set(id, { ...element(), id }); return elements.get(id); },
        querySelector(selector) { return doc.getElementById(selector); }, createElementNS: element, createElement: element,
        body: element() });
    const win = Object.assign(element(), { Image: class {
        set src(value) { const fails = nextImageFails; nextImageFails = false;
            this.naturalWidth = imageDimensions.width; this.naturalHeight = imageDimensions.height;
            queueMicrotask(() => fails ? this.onerror?.() : this.onload?.()); }
    }, requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }, ResizeObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {} disconnect() { this.disconnected = true; }
    } });
    const panzoom = (target, options) => {
        const instance = { target, options, scale: 1, position: { x: 0, y: 0 }, zoomCalls: 0,
            getScale() { return this.scale; }, getPan() { return this.position; }, setOptions(next) { Object.assign(this.options, next); },
            pan(x, y) { this.position = { x, y }; }, zoomToPoint(scale) { this.scale = scale; },
            zoom(scale) { this.scale = Math.min(options.maxScale, Math.max(1, scale)); this.zoomCalls++; },
            zoomWithWheel(event) { event.preventDefault(); this.scale = Math.min(options.maxScale, this.scale * 1.5); },
            reset() { this.scale = 1; this.position = { x: 0, y: 0 }; }, destroy() { this.destroyed = true; } };
        target.panzoomInstance = instance;
        instances.push(instance); return instance;
    };
    const controller = create({ document: doc, window: win, fetchCoordinates, panzoom });
    return { controller, doc, win, elements, instances, observers,
        el: doc.getElementById, failImage() { nextImageFails = true; }, dimensions(value) { imageDimensions = value; },
        flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); }, frames };
}

function pointerTap(page, target, x, y) {
    const event = { pointerId: 1, button: 0, pointerType: 'mouse', clientX: x, clientY: y, detail: 1 };
    target.dispatch('pointerdown', event); page.doc.dispatch('pointerup', event);
    target.dispatch('click', { ...event, clientX: Math.trunc(x), clientY: Math.trunc(y) });
}
function clientPoint(page, canvasId, point, width, height) {
    const rect = page.el(canvasId).getBoundingClientRect();
    return [rect.left + point[0] / width * rect.width, rect.top + point[1] / height * rect.height];
}

for (const id of [1, 2, 3, 4, 5, 7]) {
    test(`lot ${id}: one tap reveals nearby numbers at all three requested viewport sizes without registration`, async () => {
        const spec = dimensions(id), labels = labelLayout(coordinates(id), spec.width, spec.height);
        const target = labels.find(l => l.id === (id === 2 ? 100 : Math.ceil(capacities[id] / 2)));
        for (const [width, height] of [[393,852], [360,800], [1366,768]]) {
            const page = fakePage(); page.dimensions(spec);
            page.el('imageZoomViewport').clientWidth = width;
            page.el('imageZoomViewport').clientHeight = height - 180;
            await page.controller.show(lot(id)); page.controller.openZoom();
            const canvas = page.el('imageZoomCanvas'), pz = page.instances[0], oldLimit = pz.options.maxScale;
            const [x,y] = clientPoint(page, 'imageZoomCanvas', [target.x,target.y], spec.width, spec.height);
            pointerTap(page, page.el('imageZoomViewport'), x, y); page.flush();
            assert.equal(pz.zoomCalls, 1); assert.ok(pz.scale <= oldLimit);
            const node = page.el('zoomedNumbers').children.find(n => n.attrs.class === 'numbered-diagram-number' && Number(n.textContent) === target.id);
            assert.equal(node.style.display, '');
            const fit = Math.min(width / spec.width, (height - 180) / spec.height);
            assert.ok(parseFloat(node.style.fontSize) * fit * pz.scale >= 13.9, `lot ${id}, ${width}`);
            assert.equal(Number(node.attrs.x), target.x); assert.equal(Number(node.attrs.y), target.y);
            const after = clientPoint(page, 'imageZoomCanvas', [target.x,target.y], spec.width, spec.height);
            const rectAfter = canvas.getBoundingClientRect(), viewportHeight = height - 180;
            // 端の枠は画像端を画面端に合わせる。中央に寄せるための余白は作らない。
            assert.ok(after[0] >= 0 && after[0] <= width && after[1] >= 0 && after[1] <= viewportHeight);
            assert.ok(Math.abs(after[0] - width / 2) < 1e-7 || rectAfter.width <= width ||
                Math.abs(rectAfter.left) < 1e-7 || Math.abs(rectAfter.left + rectAfter.width - width) < 1e-7);
            assert.ok(Math.abs(after[1] - viewportHeight / 2) < 1e-7 || rectAfter.height <= viewportHeight ||
                Math.abs(rectAfter.top) < 1e-7 || Math.abs(rectAfter.top + rectAfter.height - viewportHeight) < 1e-7);
            if (id === 2) {
                const n99 = page.el('zoomedNumbers').children.find(n => n.attrs.class === 'numbered-diagram-number' && n.textContent === '99');
                assert.equal(n99.style.display, '');
            }
            // 1タップからの追加clickと、読める状態での再タップで不要な拡大をしない。
            page.el('imageZoomViewport').dispatch('click', { clientX: x, clientY: y, detail: 1 });
            pointerTap(page, page.el('imageZoomViewport'), ...after); page.flush();
            assert.equal(pz.zoomCalls, 1);
            page.el('imageZoomOut').dispatch('click'); page.flush();
            page.el('imageZoomIn').dispatch('click'); page.flush();
            page.el('imageZoomReset').dispatch('click'); page.flush(); assert.equal(pz.scale, 1);
            page.controller.close(); assert.equal(page.frames.size, 0);
        }
    });
}

test('drag returning to origin, pinch compatibility clicks, canceled pointers and blur never auto zoom', async () => {
    const page = fakePage(); await page.controller.show(lot(2)); page.controller.openZoom();
    const target = page.el('imageZoomViewport'), pz = page.instances[0];
    const down = (id, x = 150) => target.dispatch('pointerdown', { pointerId: id, clientX: x, clientY: 150, button: 0 });
    const up = (id, type = 'pointerup') => page.doc.dispatch(type, { pointerId: id, clientX: 150, clientY: 150 });
    const click = () => target.dispatch('click', { clientX: 150, clientY: 150, detail: 1 });
    down(1); page.doc.dispatch('pointermove', { pointerId: 1, clientX: 158, clientY: 150 }); up(1); click();
    down(1); down(2,170); up(1); up(2); click(); click();
    down(1); up(1,'pointercancel'); click();
    down(1); page.win.dispatch('blur'); up(1); click(); page.flush();
    assert.equal(pz.zoomCalls, 0);
    // 画像の外の余白と右クリックも対象外。
    pointerTap(page, target, 0, 0); page.flush(); assert.equal(pz.zoomCalls, 0);
    target.dispatch('pointerdown', { pointerId: 1, button: 2, clientX: 150, clientY: 150 }); up(1); click();
    assert.equal(pz.zoomCalls, 0);
    page.controller.close();
    assert.equal(page.doc.listeners.get('pointermove').size, 0);
    assert.equal(page.doc.listeners.get('pointerup').size, 0);
});

test('edge tap clamps image movement and closing immediately cancels pending auto zoom frames', async () => {
    const page = fakePage(); await page.controller.show(lot(2)); page.controller.openZoom();
    const [x,y] = clientPoint(page, 'imageZoomCanvas', [2,2], 823,777);
    pointerTap(page, page.el('imageZoomViewport'), x,y);
    const pz = page.instances[0]; assert.equal(pz.zoomCalls, 1);
    const fit = Math.min(390/823,300/777);
    assert.ok(Math.abs(pz.position.x) <= Math.max(0,(823*fit-390/pz.scale)/2)+1e-8);
    assert.ok(Math.abs(pz.position.y) <= Math.max(0,(777*fit-300/pz.scale)/2)+1e-8);
    page.controller.closeZoom(); assert.equal(page.frames.size, 0); page.flush();
    assert.equal(pz.destroyed, true);
});

for (const id of [1, 2, 3, 4, 5, 7]) {
    test(`lot ${id}: thumbnail and zoom have the same IDs, zoom reveals all labels, and closing releases resources`, async () => {
        const page = fakePage(); page.dimensions(dimensions(id));
        await page.controller.show(lot(id));
        const svg = page.el('lotDetailNumbers');
        const texts = svg.children.filter(node => node.attrs.class === 'numbered-diagram-number');
        assert.deepEqual(texts.map(node => Number(node.textContent)), lot(id).spaces.map(space => space.id));
        page.el('lotDiagramOpen').focus();
        assert.equal(page.controller.openZoom(), true);
        assert.equal(page.el('zoomedNumbers').children.length, capacities[id] * 2);
        assert.equal(page.el('zoomedNumbers').attrs.viewBox, svg.attrs.viewBox);
        assert.equal(page.el('lotDetailModal').inert, true);
        for (let i = 0; i < 20; i++) { page.el('imageZoomIn').dispatch('click'); page.flush(); }
        const zoomTexts = page.el('zoomedNumbers').children.filter(node => node.attrs.class === 'numbered-diagram-number');
        assert.equal(zoomTexts.filter(node => node.style.display !== 'none').length, capacities[id]);
        assert.deepEqual(zoomTexts.map(node => [node.attrs.x, node.attrs.y]), texts.map(node => [node.attrs.x, node.attrs.y]));
        page.el('imageZoomReset').dispatch('click'); page.flush();
        assert.equal(page.instances[0].scale, 1);
        page.el('imageZoomViewport').dispatch('wheel'); page.flush();
        assert.equal(page.instances[0].scale, 1.5);
        page.el('imageZoomModal').dispatch('keydown', { key: 'Escape' });
        assert.equal(page.el('imageZoomModal').style.display, 'none');
        assert.equal(page.doc.activeElement, page.el('lotDiagramOpen'));
        assert.equal(page.instances[0].destroyed, true);
        assert.equal(page.el('imageZoomViewport').listeners.get('wheel').size, 0);
        page.controller.close();
        assert.equal(page.frames.size, 0);
        assert.ok(page.observers.every(observer => observer.disconnected));
    });
}

test('missing, duplicate, mismatched, or failed coordinates never leave old labels on a new image', async () => {
    for (const bad of [[], [coordinates(2)[0], coordinates(2)[0]], coordinates(2).slice(1), null]) {
        const page = fakePage(async () => { if (bad === null) throw new Error('offline'); return bad; });
        await page.controller.show(lot(2));
        assert.equal(page.el('lotDetailNumbers').children.length, 0);
        assert.match(page.el('lotDiagramHint').textContent, /番号を表示できません/);
        assert.equal(page.el('lotDiagramOpen').disabled, false, 'raw image remains viewable');
        page.controller.close();
    }
});

test('image failure leaves the number list usable and disables the broken image opener', async () => {
    const page = fakePage(); page.failImage();
    await page.controller.show(lot(2));
    assert.match(page.el('lotDiagramHint').textContent, /図面画像を読み込めません/);
    assert.equal(page.el('lotDiagramOpen').disabled, true);
    assert.equal(page.controller.openZoom(), false);
});

test('late loads after switching lots or closing cannot overwrite the current diagram', async () => {
    const pending = [];
    const page = fakePage(url => new Promise(resolve => pending.push({ url, resolve })));
    const first = page.controller.show(lot(2)); await Promise.resolve();
    const second = page.controller.show(lot(5)); await Promise.resolve();
    pending[1].resolve(coordinates(5)); await second;
    pending[0].resolve(coordinates(2)); await first;
    assert.equal(page.el('lotDetailNumbers').children.length, 61 * 2);
    const third = page.controller.show(lot(3)); await Promise.resolve();
    page.controller.close(); pending[2].resolve(coordinates(3)); await third;
    assert.equal(page.el('lotDetailNumbers').children.length, 0);
    assert.equal(page.controller.openZoom(), false);
});

test('number list retains available, occupied, and own-space actions and the shared departure-time submission', () => {
    const page = fakePage();
    const draws = [];
    const context = vm.createContext({ document: page.doc, window: page.win, console,
        ParkingNumberedDiagram: { create: () => ({ show: value => draws.push(value), close() {} }) } });
    vm.runInContext(fs.readFileSync('public/script.js', 'utf8'), context);
    const data = lot(2);
    vm.runInContext(`parkingData = [${JSON.stringify(data)}]; currentUser = { studentId: 'test-a' };`, context);
    context.showLotDetail(2);
    assert.equal(draws.length, 1);
    let selected, submitted, checkouts = 0;
    context.openEndTimeModal = (...args) => { selected = args; };
    const buttons = page.el('parkingMap').children;
    assert.equal(buttons.length, 205);
    buttons[0].onclick(); assert.deepEqual(selected, [2, 1]);
    assert.equal(buttons[1].onclick, undefined);
    vm.runInContext('myParkingInfo = { lot_id: 2, space_id: 3 };', context);
    context.processSpaceCheckout = () => checkouts++;
    page.el('parkingMap').children = []; context.showLotDetail(2);
    page.el('parkingMap').children[2].onclick(); assert.equal(checkouts, 1);
    context.processSpaceCheckin = (...args) => { submitted = args; };
    page.el('endTimeSubmitBtn').dataset = { lotId: '2', spaceId: '1' };
    page.el('endTimeInput').value = '15:30';
    context.handleEndTimeSubmit(false); assert.deepEqual(submitted, ['2', '1', '15:30']);
    context.handleEndTimeSubmit(true); assert.deepEqual(submitted, ['2', '1', '未定']);
});

test('resizing keeps the image and SVG fitted together; repeated zoom opens start at scale one', async () => {
    const page = fakePage();
    await page.controller.show(lot(2)); page.controller.openZoom();
    page.el('imageZoomIn').dispatch('click'); page.flush();
    const svg = page.el('zoomedNumbers'), viewBox = svg.attrs.viewBox;
    page.el('imageZoomViewport').clientWidth = 800;
    page.el('imageZoomViewport').clientHeight = 390;
    page.win.dispatch('resize'); page.flush();
    assert.equal(svg.attrs.viewBox, viewBox);
    assert.equal(page.instances[0].scale, 1.5);
    const width = parseFloat(page.el('imageZoomCanvas').style.width);
    const height = parseFloat(page.el('imageZoomCanvas').style.height);
    assert.ok(Math.abs(width / height - 823 / 777) < 1e-10);
    page.controller.closeZoom(); page.controller.openZoom();
    assert.equal(page.instances[1].scale, 1);
    assert.equal(page.instances[0].destroyed, true);
    page.controller.close();
});

test('closing while the image is loading settles the canceled operation without rendering labels', async () => {
    const page = fakePage();
    page.win.Image = class { set src(value) {} };
    const loading = page.controller.show(lot(2));
    page.controller.close(); await loading;
    assert.equal(page.el('lotDetailNumbers').children.length, 0);
    assert.equal(page.controller.openZoom(), false);
});

test('missing image URL hides only the diagram, and a Panzoom failure remains closable', async () => {
    const page = fakePage();
    await page.controller.show({ ...lot(2), imageUrl: null });
    assert.equal(page.el('lotDiagramPanel').hidden, true);
    assert.equal(page.controller.openZoom(), false);
    const broken = create({ document: page.doc, window: page.win, fetchCoordinates: async () => coordinates(2),
        panzoom() { throw new Error('library unavailable'); } });
    await broken.show(lot(2)); broken.openZoom();
    assert.match(page.el('imageZoomGuide').textContent, /拡大機能を読み込めません/);
    assert.equal(page.el('imageZoomIn').disabled, true);
    page.el('imageZoomViewport').clientWidth = 800;
    page.win.dispatch('resize');
    assert.match(page.el('imageZoomGuide').textContent, /拡大機能を読み込めません/);
    broken.closeZoom();
    assert.equal(page.el('imageZoomModal').style.display, 'none');
});
