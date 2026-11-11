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
const artifacts = path.join(root, 'artifacts/numbered-autozoom');
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
    html=html.replace('</body>',`<script>window.addEventListener('load',()=>(${browserChecks.toString()})(${JSON.stringify(lots)},${before}));</script></body>`);
    res.type('html').send(html);
});
if(baseline) app.use('/baseline',express.static(path.resolve(baseline)));
app.use(express.static(path.join(root,'public')));

async function browserChecks(data,before) {
    const results=[], posts=[];
    const check=(condition,message)=>{if(!condition)throw new Error(message);};
    const frames=(n=4)=>new Promise(resolve=>{function frame(){if(--n<=0)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);});
    const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('待機時間を超えました。');};
    const originalFetch=window.fetch.bind(window);
    window.fetch=(url,options={})=>{if(options.method==='POST')posts.push(url);return originalFetch(url,options);};
    const event=(target,type,id,x,y,pointerType='mouse')=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,button:0,clientX:x,clientY:y,pointerType}));
    const click=(target,x,y)=>target.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y,detail:1}));
    const tap=(target,x,y)=>{event(target,'pointerdown',1,x,y);event(document,'pointerup',1,x,y);click(target,x,y);};
    const text=(svg,id)=>svg.querySelector(`text[data-space-id="${id}"]`);
    const screen=(svg,node)=>new DOMPoint(Number(node.getAttribute('x')),Number(node.getAttribute('y'))).matrixTransform(svg.getScreenCTM());
    const scale=()=>new DOMMatrix(getComputedStyle(document.getElementById('imageZoomCanvas')).transform).a;
    const fontPixels=node=>parseFloat(getComputedStyle(node).fontSize)*Math.hypot(node.getScreenCTM().a,node.getScreenCTM().b);
    const finish=error=>{
        const report={ok:!error,viewport:[innerWidth,innerHeight],before,results,posts,error:error?String(error.stack||error):null};
        const node=document.createElement('script');node.id='qa-result';node.type='application/json';node.textContent=JSON.stringify(report);document.body.appendChild(node);
        document.title=error?'QA FAILED':'QA PASSED';
    };
    try {
        currentUser={studentId:'diagram-browser-test',name:'表示確認用（DB未接続）'};
        parkingData=data;myParkingInfo=null;
        loginScreen.classList.add('hidden');mainSystem.classList.remove('hidden');refreshUI();
        if(before){await showLotDetail(2);openImageZoomModal();await frames(24);finish();return;}
        for(const lot of data){
            await showLotDetail(lot.id);openImageZoomModal();await frames(6);
            const svg=document.getElementById('zoomedNumbers'),target=document.getElementById('imageZoomViewport');
            const id=lot.id===2?100:Math.ceil(lot.capacity/2),node=text(svg,id),point=screen(svg,node);
            const xBefore=node.getAttribute('x'),yBefore=node.getAttribute('y');
            tap(target,point.x,point.y);await frames(6);
            check(getComputedStyle(node).display!=='none',`${lot.id}/${id}: 番号が非表示`);
            check(fontPixels(node)>=13.8,`${lot.id}/${id}: 文字サイズ ${fontPixels(node)}`);
            check(node.getAttribute('x')===xBefore&&node.getAttribute('y')===yBefore,'番号の元座標が変化');
            if(lot.id===2)check(getComputedStyle(text(svg,99)).display!=='none','99番が非表示');
            const firstScale=scale(),nextPoint=screen(svg,node);
            const viewportBox=target.getBoundingClientRect(),imageBox=document.getElementById('imageZoomCanvas').getBoundingClientRect();
            check(Math.abs(nextPoint.x-(viewportBox.left+viewportBox.width/2))<1.5||imageBox.width<=viewportBox.width||
                Math.abs(imageBox.left-viewportBox.left)<1.5||Math.abs(imageBox.right-viewportBox.right)<1.5,
                '横方向の中央・端補正が不正 '+JSON.stringify({point:nextPoint.toJSON(),viewport:viewportBox.toJSON(),image:imageBox.toJSON(),transform:getComputedStyle(document.getElementById('imageZoomCanvas')).transform}));
            check(Math.abs(nextPoint.y-(viewportBox.top+viewportBox.height/2))<1.5||imageBox.height<=viewportBox.height||
                Math.abs(imageBox.top-viewportBox.top)<1.5||Math.abs(imageBox.bottom-viewportBox.bottom)<1.5,'縦方向の中央・端補正が不正');
            tap(target,nextPoint.x,nextPoint.y);await frames();check(Math.abs(scale()-firstScale)<.001,'読める状態で追加拡大');
            document.getElementById('imageZoomIn').click();await frames();check(scale()>=firstScale,'＋が機能しない');
            document.getElementById('imageZoomOut').click();await frames();
            document.getElementById('imageZoomReset').click();await frames();check(Math.abs(scale()-1)<.001,'全体表示に戻らない');
            target.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:point.x,clientY:point.y}));
            await frames();check(scale()>1,'ホイールが機能しない');
            document.getElementById('imageZoomReset').click();await frames();
            const box=target.getBoundingClientRect(),cx=box.left+box.width/2,cy=box.top+box.height/2;
            event(target,'pointerdown',1,cx,cy);event(document,'pointermove',1,cx+30,cy);event(document,'pointerup',1,cx,cy);click(target,cx,cy);
            await frames();check(Math.abs(scale()-1)<.001,'ドラッグをタップと誤認');
            event(target,'pointerdown',1,cx-20,cy,'touch');event(target,'pointerdown',2,cx+20,cy,'touch');
            event(document,'pointermove',1,cx-35,cy,'touch');event(document,'pointermove',2,cx+35,cy,'touch');
            event(document,'pointerup',1,cx-35,cy,'touch');event(document,'pointerup',2,cx+35,cy,'touch');await frames();
            const pinchedScale=scale();click(target,cx,cy);click(target,cx,cy);await frames();
            check(pinchedScale>1,'ピンチが機能しない');check(Math.abs(scale()-pinchedScale)<.001,'ピンチ後に追加拡大');
            closeImageZoomModal();await frames();
            // 小図面の位置を拡大画面へ引き継ぐ。
            const preview=document.getElementById('lotDetailNumbers'),previewNode=text(preview,id),previewPoint=screen(preview,previewNode);
            tap(document.getElementById('lotDiagramOpen'),previewPoint.x,previewPoint.y);await frames(10);
            const reopened=text(document.getElementById('zoomedNumbers'),id);
            check(fontPixels(reopened)>=13.8,'小図面からの引き継ぎで番号が小さい');
            check(posts.length===0,'図面の操作からPOSTが発生');
            const guide=document.getElementById('imageZoomGuide').getBoundingClientRect();
            const close=document.querySelector('.close-zoom-modal').getBoundingClientRect();
            check(guide.width>0&&guide.bottom<=innerHeight+1&&close.right<=innerWidth+1,'案内または閉じるボタンが見切れ');
            check(close.width>=44&&close.height>=44,'閉じるボタンが小さい');
            check(getComputedStyle(document.getElementById('imageZoomTitle')).color==='rgb(255, 255, 255)','見出し色が背景に埋もれる');
            results.push({lot:lot.id,target:id,fontPixels:fontPixels(reopened),autoScale:scale(),guideVisible:true});
            closeDetailModal();await frames();
        }
        // 実際の既存番号一覧→時刻入力→登録→自分の番号→出庫を、架空APIで確認する。
        await showLotDetail(2);document.getElementById('parkingMap').children[0].click();
        check(document.getElementById('endTimeModal').style.display==='block','番号一覧から時刻入力が開かない');
        document.getElementById('endTimeInput').value='15:30';document.getElementById('endTimeSubmitBtn').click();
        await until(()=>myParkingInfo&&!parkingOperationPending);
        await showLotDetail(2);document.getElementById('parkingMap').children[0].click();
        check(document.getElementById('checkoutModal').style.display==='block','自分の番号から出庫確認が開かない');
        document.getElementById('confirmCheckoutBtn').click();await until(()=>!myParkingInfo&&!parkingOperationPending);
        check(posts.length===2,'番号一覧の登録・出庫の送信数が不正');
        results.push({numberListCheckin:true,numberListCheckout:true});
        // 既存マップの最初のタップは拡大だけで、登録画面を開かない。
        await openInteractiveMap(2,'/images/img2-system.svg');await until(()=>activeMapView&&activeMapView.panzoom);await frames();
        const view=activeMapView,spot=view.spots.find(s=>s.id===100);
        const p=spot.polygon.reduce((sum,a)=>[sum[0]+a[0]/spot.polygon.length,sum[1]+a[1]/spot.polygon.length],[0,0]);
        const rect=view.element.getBoundingClientRect();tap(view.viewport,rect.left+p[0]/100*rect.width,rect.top+p[1]/100*rect.height);await frames(6);
        check(view.panzoom.getScale()>1,'既存マップの自動拡大が機能しない');
        check(document.getElementById('endTimeModal').style.display==='none','既存マップの初回タップが登録を開始');
        check(posts.length===2,'既存マップの初回タップで送信');closeInteractiveMap();
        results.push({existingMapFirstTap:true});
        document.querySelectorAll('.notification').forEach(node=>node.remove());
        await showLotDetail(2);
        const preview=document.getElementById('lotDetailNumbers'),point=screen(preview,text(preview,100));
        tap(document.getElementById('lotDiagramOpen'),point.x,point.y);await frames(24);
        finish();
    } catch(error){finish(error);}
}

async function run() {
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const reports=[];
    let child, socket;
    try {
        const profile=path.join(os.tmpdir(),`kari-autozoom-edge-${process.pid}-cdp`);
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
        for(const [width,height] of process.argv.includes('--quick')?[[393,852]]:[[393,852],[360,800],[1366,768]]){
            for(const before of baseline?[true,false]:[false]){
                const name=`${before?'before':'after'}-${width}x${height}`;
                const {targetId}=await send('Target.createTarget',{url:'about:blank'});
                const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
                await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
                await send('Page.enable',{},sessionId);await send('Target.activateTarget',{targetId});
                await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/qa${before?'?before=1':''}`},sessionId);
                let report;
                for(let attempt=0;attempt<120;attempt++){
                    await new Promise(resolve=>setTimeout(resolve,250));
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
        const comparisons=[[393,852],[360,800],[1366,768]].map(([w,h])=>{
            const before=`before-${w}x${h}.png`,after=`after-${w}x${h}.png`;
            return fs.existsSync(path.join(artifacts,before))&&fs.existsSync(path.join(artifacts,after))
                ? `<section><h2>${w}×${h}px</h2><div class="pair"><figure><figcaption>改善前：全体表示から＋を繰り返す</figcaption><a href="${before}"><img src="${before}" alt="改善前"></a></figure><figure><figcaption>改善後：100番付近を1回タップ</figcaption><a href="${after}"><img src="${after}" alt="改善後"></a></figure></div></section>`:'';
        }).join('');
        fs.writeFileSync(path.join(artifacts,'comparison.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><title>番号付き図面の自動拡大・前後比較</title><style>body{font:16px system-ui;margin:24px;background:#eef2f5;color:#18364c}.pair{display:flex;gap:24px;flex-wrap:wrap}figure{margin:0 0 24px;max-width:46%}img{max-width:100%;max-height:650px;object-fit:contain;object-position:top}figcaption{margin:8px 0}@media(max-width:600px){figure{max-width:100%}}</style><h1>番号付き図面の自動拡大</h1><p>第2駐車場・同じ表示寸法での比較です。画像を押すと原寸を開きます。架空の利用者と空き状況を使い、実際のEdgeで撮影しました。</p>${comparisons}</html>`);
        if(reports.some(report=>!report.ok))process.exitCode=1;
        fs.writeFileSync(path.join(artifacts,'browser.log'),errors);
        await send('Browser.close');
    } finally { if(socket)socket.close();if(child)child.kill();server.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
