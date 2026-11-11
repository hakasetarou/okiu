// UI確認専用。127.0.0.1だけで待ち受け、DBや本番APIには接続しない。
// node tests/helpers/numbered-diagram-preview.cjs [変更前のpublicファイルを置いたディレクトリ]
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const app = express();
const root = path.resolve(__dirname, '../..');
const baseline = process.argv[2] ? path.resolve(process.argv[2]) : null;
const counts = { 1: 530, 2: 205, 3: 706, 4: 78, 5: 61, 7: 104 };
const images = { 1: 'img1.jpg', 2: 'img2-system.svg', 3: 'img3-system.svg', 4: 'img4.jpg', 5: 'img5.jpg', 7: 'img7-system.svg' };
const lots = Object.entries(counts).map(([id, capacity]) => ({
    id: Number(id), name: `第${id}駐車場`, capacity, available: capacity - 1,
    imageUrl: `/images/${images[id]}`,
    spaces: Array.from({ length: capacity }, (_, i) => ({ id: i + 1, isParked: i === 1, endTime: i === 1 ? '15:30' : null }))
}));
let parking = null;
app.use(express.json());
app.get('/api/parking-data', (req, res) => res.json(lots));
app.get('/api/parking/status', (req, res) => res.json(lots.flatMap(l => l.spaces.map(s => ({
    lot_id: String(l.id), spot_number: s.id, status: s.isParked ? 'occupied' : 'available'
})))));
app.post('/api/parking/checkin', (req, res) => {
    const { lotId, spaceId, endTime } = req.body;
    const lot = lots.find(l => l.id === Number(lotId));
    const space = lot?.spaces.find(s => s.id === Number(spaceId));
    if (parking || !space || space.isParked) return res.status(409).json({ message: '確認用：この枠には登録できません。' });
    parking = { lot_id: lot.id, space_id: space.id, estimated_end_time: endTime, start_time: new Date().toISOString() };
    space.isParked = true; space.endTime = endTime; lot.available--;
    res.json(parking);
});
app.post('/api/parking/checkout', (req, res) => {
    if (parking) {
        const lot = lots.find(l => l.id === parking.lot_id), space = lot.spaces.find(s => s.id === parking.space_id);
        space.isParked = false; space.endTime = null; lot.available++;
    }
    parking = null; res.json({ message: '確認用：出庫しました。' });
});
app.use('/api', (req, res) => res.status(404).json({ message: '表示確認用サーバーです。' }));
app.get('/review', (req, res) => res.send(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>番号付き図面の比較（DB未接続）</title>
<style>body{font:16px system-ui;background:#eef2f5;margin:16px}nav{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px}iframe{border:1px solid #aab7c2;height:780px;background:white;max-width:100%}main{display:flex;gap:16px;flex-wrap:wrap}h2{font-size:18px}button,select{font:inherit;padding:6px}</style>
<h1>番号付き図面の比較</h1><p>架空の利用者・空き状況を使用する確認ページです。DBには接続しません。</p>
<nav><label>駐車場 <select id="lot">${Object.keys(counts).map(id => `<option value="${id}" ${id === '2' ? 'selected' : ''}>第${id}（${counts[id]}枠）</option>`).join('')}</select></label>
<label>画面幅 <select id="width"><option>390</option><option>1000</option><option>360</option></select></label>
<label>表示 <select id="zoom"><option value="0">番号一覧</option><option value="1">図面拡大</option></select></label><button id="apply">表示する</button></nav>
<main><section><h2>変更前</h2><iframe id="before" title="変更前"></iframe></section><section><h2>変更後</h2><iframe id="after" title="変更後"></iframe></section></main>
<script>function show(){for(const version of ['before','after']){const frame=document.getElementById(version);frame.style.width=document.getElementById('width').value+'px';frame.src='/'+version+'/app?lot='+document.getElementById('lot').value+'&zoom='+document.getElementById('zoom').value;}}document.getElementById('apply').onclick=show;show();</script></html>`));
function serveApp(req, res, old) {
    if (old && !baseline) return res.status(404).send('変更前との比較には、起動時に変更前ファイルのディレクトリを指定してください。');
    const dir = old ? baseline : path.join(root, 'public');
    let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const id = counts[Number(req.query.lot)] ? Number(req.query.lot) : 2;
    const zoom = req.query.zoom === '1';
    const seed = `<script>document.addEventListener('DOMContentLoaded',async()=>{
        currentUser={studentId:'diagram-preview',name:'表示確認用（DB未接続）'};
        parkingData=${JSON.stringify(lots)};myParkingInfo=null;
        loginScreen.classList.add('hidden');mainSystem.classList.remove('hidden');refreshUI();
        await showLotDetail(${id});
        if(${zoom}){openImageZoomModal(${JSON.stringify(lots.find(l => l.id === id).imageUrl)});}
    });</script>`;
    html = html.replace('</body>', seed + '</body>');
    res.set('Cache-Control', 'no-store').type('html').send(html);
}
app.get('/before/app', (req, res) => serveApp(req, res, true));
app.get('/after/app', (req, res) => serveApp(req, res, false));
if (baseline) app.use('/before', express.static(baseline));
app.use('/after', express.static(path.join(root, 'public')));
app.use(express.static(path.join(root, 'public')));
app.listen(5179, '127.0.0.1', () => console.log('番号付き図面の確認: http://127.0.0.1:5179/review （DB未接続）'));
