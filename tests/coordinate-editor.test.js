const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function editorScreen(storage = new Map()) {
    const elements = new Map();
    const requests = [];
    let exported;
    function element(id) {
        const node = {
            value: '', style: {}, children: [], listeners: {}, files: [],
            appendChild(child) { this.children.push(child); if (id === 'lotSelect' && !this.value) this.value = String(child.value); },
            replaceChildren() { this.children = []; },
            addEventListener(event, fn) { this.listeners[event] = fn; },
            getBoundingClientRect() { return { left: 100, top: 50, width: 1000, height: 500 }; },
            remove() {}, click() { exported = { ...exported, name: this.download, url: this.href }; }
        };
        if (id === 'mapImage') Object.defineProperty(node, 'src', { set(value) { this.onload(); } });
        return node;
    }
    const context = vm.createContext({
        document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
            createElement: tag => element(tag), body: element('body') },
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
        URL: { createObjectURL(blob) { exported = { blob }; return 'blob:test'; }, revokeObjectURL() {} },
        Blob, setTimeout() {},
        fetch: async (url, options) => {
            requests.push({ url, method: options?.method || 'GET' });
            return { ok: true, json: async () => url === '/api/parking-data'
                ? [{ id: 1, name: 'Lot 1', capacity: 4, imageUrl: 'images/img1.jpg' },
                    { id: 5, name: 'Lot 5', capacity: 61, imageUrl: 'images/img5.jpg' },
                    { id: 6, name: 'Lot 6', capacity: 40, imageUrl: null }]
                : url === '/data/parking-spots/lot-1.json' ? []
                : JSON.parse(fs.readFileSync(`public${url}`, 'utf8')) };
        }
    });
    // 実際のHTMLで指定されている初期値。
    ['drawMode', 'spotNumber', 'rowCount'].forEach(id => context.document.getElementById(id));
    elements.get('drawMode').value = 'single';
    elements.get('spotNumber').value = '1';
    elements.get('rowCount').value = '1';
    vm.runInContext(fs.readFileSync('public/parking-map-data.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('public/coordinate-editor.js', 'utf8'), context);
    await new Promise(resolve => setImmediate(resolve));
    return { context, elements, storage, requests, exported: () => exported };
}

test('four image clicks create a row, persist a draft, and can be undone without API writes', async () => {
    const page = await editorScreen();
    const el = id => page.elements.get(id);
    assert.deepEqual(el('lotSelect').children.map(option => option.value), [1, 5]);
    el('drawMode').value = 'row';
    el('drawMode').onchange();
    el('rowCount').value = '2';
    const click = el('mapOverlay').listeners.click;
    [[200, 150], [400, 150], [400, 250], [200, 250]].forEach(([clientX, clientY]) => click({ clientX, clientY }));
    assert.equal(el('saveSpot').disabled, false);
    el('saveSpot').onclick();
    const draft = JSON.parse(page.storage.get('parking-coordinate-draft-v1-1'));
    assert.deepEqual(draft.spots.map(spot => spot.id), [1, 2]);
    assert.deepEqual(draft.spots[0].polygon, [[10, 20], [20, 20], [20, 40], [10, 40]]);
    assert.deepEqual(draft.spots[1].polygon, [[20, 20], [30, 20], [30, 40], [20, 40]]);
    assert.equal(el('spotNumber').value, 3);
    assert.ok(el('progress').textContent.includes('設定済み：2枠'));
    el('undoSave').onclick();
    assert.deepEqual(JSON.parse(page.storage.get('parking-coordinate-draft-v1-1')).spots, []);
    assert.ok(page.requests.every(request => request.method === 'GET'));
});

test('saved drafts restore for their lot while fifth-lot coordinates remain separate', async () => {
    const page = await editorScreen();
    const el = id => page.elements.get(id);
    el('mapOverlay').listeners.click({ clientX: 200, clientY: 150 });
    el('mapOverlay').listeners.click({ clientX: 300, clientY: 150 });
    el('mapOverlay').listeners.click({ clientX: 300, clientY: 200 });
    el('mapOverlay').listeners.click({ clientX: 200, clientY: 200 });
    el('saveSpot').onclick();
    const reloaded = await editorScreen(page.storage);
    assert.ok(reloaded.elements.get('progress').textContent.includes('設定済み：1枠'));
    reloaded.elements.get('lotSelect').value = '5';
    await reloaded.elements.get('lotSelect').onchange();
    assert.ok(reloaded.elements.get('progress').textContent.includes('設定済み：61枠'));
    assert.equal(JSON.parse(page.storage.get('parking-coordinate-draft-v1-1')).spots.length, 1);
    assert.equal(page.storage.has('parking-coordinate-draft-v1-5'), false);
});

test('coordinate JSON can be imported and exported for the selected lot', async () => {
    const page = await editorScreen();
    const spots = [{ id: 2, name: '2', polygon: [[10, 10], [20, 10], [20, 20], [10, 20]] }];
    const file = page.elements.get('importFile');
    file.files = [{ text: async () => JSON.stringify(spots) }];
    await file.onchange();
    assert.ok(page.elements.get('progress').textContent.includes('設定済み：1枠'));
    page.elements.get('download').onclick();
    assert.equal(page.exported().name, 'lot-1.json');
    assert.deepEqual(JSON.parse(await page.exported().blob.text()), spots);
    assert.ok(page.requests.every(request => request.method === 'GET'));
});
