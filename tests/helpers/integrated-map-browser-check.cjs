// 実Edge・実Panzoomによる確認。DBは読み書きせず、架空データだけを使う。
// node tests/helpers/numbered-diagram-browser-check.cjs <Panzoom 4.5.1 JS> [変更前publicの保存先]
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const library = process.argv[2], baseline = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
if (!library || !fs.existsSync(library)) throw new Error('確認用のPanzoom 4.5.1のファイルを指定してください。');
const artifacts = path.join(root, 'artifacts/integrated-map');
fs.mkdirSync(artifacts, { recursive: true });
const app = express();
const counts = { 1:530, 2:205, 3:706, 4:78, 5:61, 7:104 };
const images = { 1:'img1.jpg', 2:'img2-system.svg', 3:'img3-system.svg', 4:'img4.jpg', 5:'img5.jpg', 7:'img7-system.svg' };
const lots = Object.entries(counts).map(([id, capacity]) => ({ id:Number(id), name:`第${id}駐車場`, capacity,
    available:capacity-1, imageUrl:`/images/${images[id]}`,
    spaces:Array.from({length:capacity},(_,i)=>({id:i+1,isParked:i===1,endTime:i===1?'15:30':null})) }));
let parking = null;
app.use(express.json());
app.get('/panzoom.js', (req,res)=>res.type('js').send(fs.readFileSync(library)));
app.get('/api/parking-data',(req,res)=>res.json(lots));
app.get('/api/parking/status',(req,res)=>res.json(lots.flatMap(l=>l.spaces.map(s=>({lot_id:String(l.id),spot_number:s.id,status:s.isParked?'occupied':'available'})))));
app.post('/api/parking/checkin',(req,res)=>{
    const {lotId,spaceId,endTime}=req.body;
    const lot=lots.find(l=>l.id===Number(lotId)), space=lot?.spaces.find(s=>s.id===Number(spaceId));
    if(!space||space.isParked||parking) return res.status(409).json({message:'確認用：使用中です。'});
    parking={lot_id:lot.id,space_id:space.id,estimated_end_time:endTime,start_time:new Date().toISOString()};
    space.isParked=true;space.endTime=endTime;lot.available--;res.json(parking);
});
app.post('/api/parking/checkout',(req,res)=>{
    if(parking){const lot=lots.find(l=>l.id===parking.lot_id),space=lot.spaces.find(s=>s.id===parking.space_id);space.isParked=false;space.endTime=null;lot.available++;}
    parking=null;res.json({message:'確認用：出庫しました。'});
});
app.use('/api',(req,res)=>res.status(404).json({message:'確認用サーバーです。'}));
app.get('/qa',(req,res)=>{
    const before=req.query.before==='1';
    const dir=before&&baseline?baseline:path.join(root,'public');
    let html=fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(/https:\/\/unpkg.com\/[^"']+panzoom.min.js/,'/panzoom.js');
    if(before&&baseline) html=html.replace(/(href|src)="(style.css|script.js|parking-map-data.js|numbered-diagram.js)/g,'$1="/baseline/$2');
    html=html.replace('</body>',`<script>window.addEventListener('load',()=>(${browserChecks.toString()})(${JSON.stringify(lots)},${before},${process.argv.includes('--expect-hidden')}));</script></body>`);
    res.type('html').send(html);
});
if(baseline) app.use('/baseline',express.static(path.resolve(baseline)));
app.use(express.static(path.join(root,'public')));

const browserChecks = require('./integrated-map-scenarios.cjs');

async function run() {
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const reports=[];
    let child, socket;
    try {
        const profile=path.join(os.tmpdir(),`kari-integrated-map-edge-${process.pid}-cdp`);
        child=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
                '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`],{windowsHide:true});
        let errors='';
        const endpoint=await new Promise((resolve,reject)=>{
            const timeout=setTimeout(()=>reject(new Error('Edgeの確認用接続を開始できません。')),15000);
            child.once('error',reject);
            child.stderr.on('data',chunk=>{errors+=chunk;const match=errors.match(/DevTools listening on (ws:\/\/[^\s]+)/);
                if(match){clearTimeout(timeout);resolve(match[1]);}});
        });
        socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
        let nextId=0;const pending=new Map();
        socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(!data.id)return;
            const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);data.error?entry.reject(new Error(JSON.stringify(data.error))):entry.resolve(data.result);});
        const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
        for(const [width,height] of process.argv.includes('--quick')?[[393,852]]:[[393,852],[360,800],[852,393],[1366,768]]){
            for(const before of baseline?[true,false]:[false]){
                const name=`${before?'before':'after'}-${width}x${height}`;
                const {targetId}=await send('Target.createTarget',{url:'about:blank'});
                const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
                await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false,screenOrientation:{type:width>height?'landscapePrimary':'portraitPrimary',angle:width>height?90:0}},sessionId);
                await send('Page.enable',{},sessionId);await send('Target.activateTarget',{targetId});
                await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/qa${before?'?before=1':''}`},sessionId);
                let report;
                for(let attempt=0;attempt<120;attempt++){
                    await new Promise(resolve=>setTimeout(resolve,250));
                    const hook=await send('Runtime.evaluate',{expression:'JSON.stringify({shot:window.__qaShot,enter:window.__qaEnter,resize:window.__qaResize})',returnByValue:true},sessionId);
                    const requested=JSON.parse(hook.result.value||'{}');
                    if(requested.shot){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);const kind=['entry','own','occupied'].includes(requested.shot)?requested.shot:'entry';fs.writeFileSync(path.join(artifacts,(before?'before':'after')+'-'+kind+'-'+width+'x'+height+'.png'),Buffer.from(shot.data,'base64'));await send('Runtime.evaluate',{expression:'window.__qaShot=null'},sessionId);}
                    if(requested.enter){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'},sessionId);await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);await send('Runtime.evaluate',{expression:'window.__qaEnter=false'},sessionId);}
                    if(requested.resize){const w=requested.resize.restore?width:requested.resize.width,h=requested.resize.restore?height:requested.resize.height;await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false,screenOrientation:{type:w>h?'landscapePrimary':'portraitPrimary',angle:w>h?90:0}},sessionId);await send('Runtime.evaluate',{expression:'window.__qaResize=null'},sessionId);}
                    const result=await send('Runtime.evaluate',{expression:"document.getElementById('qa-result')?.textContent",returnByValue:true},sessionId);
                    if(result.result.value){report=JSON.parse(result.result.value);break;}
                }
                if(!report)report={ok:false,error:'ブラウザ確認の完了待機が時間切れ'};
                const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
                fs.writeFileSync(path.join(artifacts,name+'.png'),Buffer.from(screenshot.data,'base64'));
                await send('Target.closeTarget',{targetId});
                reports.push({name,...report});console.log(JSON.stringify({name,...report}));
            }
        }
        fs.writeFileSync(path.join(artifacts,'results.json'),JSON.stringify(reports,null,2));
        const comparisons=[[393,852],[360,800],[852,393],[1366,768]].map(([w,h])=>{
            const before=`before-${w}x${h}.png`,after=`after-${w}x${h}.png`;
            return fs.existsSync(path.join(artifacts,before))&&fs.existsSync(path.join(artifacts,after))
                ? `<section><h2>${w}×${h}px</h2><div class="pair"><figure><figcaption>改善前：入口が2つ</figcaption><a href="before-entry-${w}x${h}.png"><img src="before-entry-${w}x${h}.png" alt="改善前の駐車場一覧"></a></figure><figure><figcaption>改善後：マップへ入口を統合</figcaption><a href="after-entry-${w}x${h}.png"><img src="after-entry-${w}x${h}.png" alt="改善後の駐車場一覧"></a></figure></div><div class="pair"><figure><figcaption>改善前：番号を直接指定できないマップ</figcaption><a href="${before}"><img src="${before}" alt="改善前"></a></figure><figure><figcaption>改善後：第3駐車場128番を番号検索</figcaption><a href="${after}"><img src="${after}" alt="改善後"></a></figure></div></section>`:'';
        }).join('');
        fs.writeFileSync(path.join(artifacts,'comparison.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><title>統合マップ・番号検索の前後比較</title><style>body{font:16px system-ui;margin:24px;background:#eef2f5;color:#18364c}.pair{display:flex;gap:24px;flex-wrap:wrap}figure{margin:0 0 24px;max-width:46%}img{max-width:100%;max-height:650px;object-fit:contain;object-position:top}figcaption{margin:8px 0}@media(max-width:600px){figure{max-width:100%}}</style><h1>マップ＋番号検索の統合UI</h1><p>同じ表示寸法での駐車場一覧と第3駐車場の比較です。画像を押すと原寸を開きます。架空の利用者・空き状況で実際のEdgeを使用しています。利用者の操作時間は未測定です。</p>${comparisons}</html>`);
        if(reports.some(report=>!report.ok))process.exitCode=1;
        fs.writeFileSync(path.join(artifacts,'browser.log'),errors);
        await send('Browser.close');
    } finally { if(socket)socket.close();if(child)child.kill();server.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
