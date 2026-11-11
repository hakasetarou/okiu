// 実Edgeで実行する統合UIのシナリオ。通信先は同梱の架空APIだけ。
module.exports = async function browserChecks(data, before, expectHidden) {
    const results=[],posts=[];
    const check=(value,message)=>{if(!value)throw new Error(message);};
    const frames=(n=6)=>new Promise(resolve=>{function next(){if(--n<=0)resolve();else requestAnimationFrame(next);}requestAnimationFrame(next);});
    const until=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('確認の待機時間を超えました。');};
    const finish=error=>{const node=document.createElement('script');node.id='qa-result';node.type='application/json';
        node.textContent=JSON.stringify({ok:!error,viewport:[innerWidth,innerHeight],before,results,posts,error:error?String(error.stack||error):null});document.body.appendChild(node);};
    const event=(target,type,id,x,y,kind='mouse')=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,button:0,clientX:x,clientY:y,pointerType:kind}));
    const click=(target,x,y)=>target.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y,detail:1}));
    const tap=(target,x,y)=>{event(target,'pointerdown',1,x,y);event(document,'pointerup',1,x,y);click(target,x,y);};
    const bayPoint=(view,id)=>{const spot=view.metrics.spots.find(s=>s.id===id),rect=view.element.getBoundingClientRect();return{x:rect.left+spot.center[0]/view.metrics.width*rect.width,y:rect.top+spot.center[1]/view.metrics.height*rect.height};};
    const open=async(id)=>{await openInteractiveMap(id,data.find(l=>l.id===id).imageUrl);await until(()=>activeMapView&&activeMapView.panzoom);await frames();return activeMapView;};
    const submit=async(view,value)=>{view.searchNodes.input.value=String(value);view.searchNodes.form.requestSubmit();await until(()=>!view.searchPending);await frames();};
    let statusMode='normal',resolveStatus,denyCheckin=false;
    const originalFetch=window.fetch.bind(window);
    window.fetch=(url,options={})=>{
        if(options.method==='POST'){
            posts.push({url,body:JSON.parse(options.body)});
            if(denyCheckin&&url.endsWith('/parking/checkin'))return Promise.resolve(new Response(JSON.stringify({message:'確認用：別の利用者が先に登録しました。'}),{status:409,headers:{'Content-Type':'application/json'}}));
        }
        if(url.endsWith('/parking/status')){
            if(statusMode==='fail')return Promise.resolve(new Response('{}',{status:503}));
            if(statusMode==='delay')return new Promise(resolve=>resolveStatus=resolve);
        }
        return originalFetch(url,options);
    };
    try {
        currentUser={studentId:'map-search-browser-test',name:'表示確認用（DB未接続）'};
        parkingData=data;myParkingInfo=null;
        loginScreen.classList.add('hidden');mainSystem.classList.remove('hidden');refreshUI();await frames(24);
        const visibleNumbers=[...document.querySelectorAll('.btn-number')].filter(node=>node.getClientRects().length).length;
        results.push({visibleMapEntries:document.querySelectorAll('.btn-map').length,visibleNumberEntries:visibleNumbers});
        if(expectHidden&&!before)check(visibleNumbers===0,'旧番号入口が通常画面に残っています');
        window.__qaShot='entry';await until(()=>!window.__qaShot);
        if(before){await open(3);await frames(24);finish();return;}
        for(const lot of data){
            const view=await open(lot.id),number=lot.id===3?128:lot.id===2?100:Math.ceil(lot.capacity/2);
            let point=bayPoint(view,number);
            tap(view.viewport,point.x,point.y);await frames();
            check(view.mode==='selection'&&posts.length===0,'初回タップの従来動作が変化');
            resetInteractiveMapOverview(view);await frames();
            const rect=view.viewport.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
            event(view.viewport,'pointerdown',1,cx,cy);event(document,'pointermove',1,cx+30,cy);event(document,'pointerup',1,cx,cy);click(view.viewport,cx,cy);
            await frames();check(view.mode==='overview','ドラッグが枠選択になった');
            event(view.viewport,'pointerdown',1,cx-20,cy,'touch');event(view.viewport,'pointerdown',2,cx+20,cy,'touch');
            event(document,'pointermove',1,cx-35,cy,'touch');event(document,'pointermove',2,cx+35,cy,'touch');
            event(document,'pointerup',1,cx-35,cy,'touch');event(document,'pointerup',2,cx+35,cy,'touch');await frames();
            const pinch=view.panzoom.getScale();click(view.viewport,cx,cy);await frames();check(Math.abs(view.panzoom.getScale()-pinch)<.001,'ピンチ後に追加拡大');
            resetInteractiveMapOverview(view);await frames();
            view.searchNodes.input.focus();await frames();check(view.mode==='overview'&&posts.length===0,'入力欄の操作で選択');
            if(lot.id===3){view.searchNodes.input.value='128';window.__qaEnter=true;
                await until(()=>view.selectedNumber===128&&!view.busy&&view.searchHighlight);await frames();}
            else await submit(view,number);
            check(view.selectedNumber===number&&view.searchHighlight,'検索対象が表示されない');
            check(posts.length===0,'検索でPOSTが発生');
            const svg=view.modal.querySelector('.map-spots-overlay');
            check(svg.firstChild===view.searchHighlight,'検索外周が元の枠より前面に重なる');
            check(view.searchNodes.result.textContent.includes(`${number}番`),'結果欄の番号が不一致');
            const original=view.modal.querySelector(`#spot-${lot.id}-${number}`),label=original.nextElementSibling;
            const matrix=label.getScreenCTM();
            const labelPixels=parseFloat(getComputedStyle(label).fontSize)*Math.hypot(matrix.c,matrix.d);
            const box=view.viewport.getBoundingClientRect(),imageBox=view.element.getBoundingClientRect();
            const centerInImage=[(box.left+box.width/2-imageBox.left)/imageBox.width*view.metrics.width,
                (box.top+box.height/2-imageBox.top)/imageBox.height*view.metrics.height];
            const centered=ParkingMapData.containsPoint(view.metrics.spots.find(s=>s.id===number).polygon,centerInImage);
            const clamped=imageBox.width<=box.width+1||imageBox.height<=box.height+1||Math.abs(imageBox.left-box.left)<1.5||
                Math.abs(imageBox.right-box.right)<1.5||Math.abs(imageBox.top-box.top)<1.5||Math.abs(imageBox.bottom-box.bottom)<1.5;
            check(centered||clamped,'検索対象の内部が中央に来ず、端補正でもない '+JSON.stringify({lot:lot.id,centerInImage,viewport:box.toJSON(),image:imageBox.toJSON(),pan:view.panzoom.getPan(),scale:view.panzoom.getScale(),fit:view.fitScale}));
            const scale=view.panzoom.getScale(),pan=view.panzoom.getPan();
            await submit(view,lot.capacity);
            check(view.panzoom.getScale()>=scale-.001,'十分な倍率で縮小された');
            check(Math.hypot(pan.x-view.panzoom.getPan().x,pan.y-view.panzoom.getPan().y)>.01,'拡大済みで別番号へ移動しない');
            check(view.searchHighlight.dataset.searchNumber===String(lot.capacity),'強調が切り替わらない');
            if(lot.id===3){
                view.searchNodes.input.focus();await frames();
                window.__qaResize={width:innerWidth,height:Math.max(300,innerHeight-200)};await until(()=>!window.__qaResize);await frames(18);
                check(view.selectedNumber===lot.capacity&&view.searchHighlight,'高さ変更で検索結果が消えた');
                window.__qaResize={restore:true};await until(()=>!window.__qaResize);await frames(18);
                view.searchNodes.input.blur();await frames();
                window.__qaResize={width:innerHeight,height:innerWidth};await until(()=>!window.__qaResize);await frames(18);
                check(view.selectedNumber===lot.capacity&&view.searchHighlight,'回転で検索結果が消えた');
                window.__qaResize={restore:true};await until(()=>!window.__qaResize);await frames(18);
            }
            view.modal.querySelector('[data-map-action="out"]').click();await frames();
            view.modal.querySelector('[data-map-action="in"]').click();await frames();
            view.viewport.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-100,clientX:cx,clientY:cy}));await frames();
            const header=view.modal.querySelector('.map-header').getBoundingClientRect(),footer=view.modal.querySelector('.map-footer').getBoundingClientRect();
            const input=view.searchNodes.input.getBoundingClientRect(),close=view.modal.querySelector('.map-close').getBoundingClientRect();
            check(header.top>=-1&&footer.bottom<=innerHeight+1&&view.viewport.clientHeight>80,'表示領域・凡例が見切れ');
            check(input.right<=close.left||input.left>=close.right||input.top>=close.bottom||input.bottom<=close.top,'入力欄と閉じる部品が重なる');
            check(Math.abs(header.right-close.right-parseFloat(getComputedStyle(view.modal.querySelector('.map-header')).paddingRight))<=1,'閉じるボタンがヘッダー右端にない');
            check(close.width>=88&&close.height>=44&&view.modal.querySelector('.map-close').textContent.includes('閉じる'),'閉じるボタンの文言・操作面積が不足');
            results.push({lot:lot.id,searched:number,mode:view.mode,labelPixels,scale:view.panzoom.getScale(),mapHeight:view.viewport.clientHeight,searchAction:view.searchNodes.action.textContent});
            view.modal.querySelector('[data-map-action="overview"]').click();await frames();
            check(!view.selectedNumber&&!view.searchHighlight&&view.searchNodes.result.hidden,'全体表示で検索が残った');
            view.modal.querySelector('.map-close').click();check(document.body.style.position!=='fixed','背景スクロールが復元されない');
        }
        let view=await open(2);
        for(const value of ['',0,-1,'1.5','100abc',206]){await submit(view,value);check(!view.searchNodes.error.hidden,'入力エラーが表示されない');check(!view.selectedNumber,'失敗時に結果が残る');}
        const saved=view.spots;view.spots=saved.filter(s=>s.id!==100);await submit(view,100);
        check(view.searchNodes.error.textContent.includes('100番は存在しますが'),'不存在と座標不足を区別しない');view.spots=saved;
        statusMode='fail';await submit(view,100);check(view.searchNodes.error.textContent.includes('空き情報'),'通信失敗が入力エラーになった');
        statusMode='normal';await submit(view,2);check(view.searchNodes.action.hidden&&view.searchNodes.state.textContent.includes('使用中'),'使用中の枠に登録できる');
        await frames(24);window.__qaShot='occupied';await until(()=>!window.__qaShot);
        statusMode='delay';view.searchNodes.input.value='100';view.searchNodes.form.requestSubmit();await until(()=>view.searchPending);
        check(view.searchNodes.submit.disabled,'検索の二重操作を防いでいない');closeInteractiveMap();statusMode='normal';
        const next=await open(3);resolveStatus(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));await frames(12);
        check(!next.selectedNumber&&next.searchNodes.result.hidden,'古い検索が別駐車場に反映');closeInteractiveMap();
        view=await open(5);await submit(view,1);const position=view.panzoom.getPan(),scale=view.panzoom.getScale();
        view.searchNodes.action.click();check(document.getElementById('endTimeModal').style.display==='block','既存時刻入力へ進まない');
        document.getElementById('closeEndTimeModal').click();await frames();
        check(view.panzoom.getScale()===scale&&Math.hypot(view.panzoom.getPan().x-position.x,view.panzoom.getPan().y-position.y)<.01,'キャンセルで拡大位置が変化');
        view.searchNodes.action.click();document.getElementById('endTimeInput').value='15:30';document.getElementById('endTimeSubmitBtn').click();
        await until(()=>myParkingInfo&&!parkingOperationPending&&!activeMapView);
        check(myParkingInfo.estimated_end_time==='15:30','共通登録の予定時刻が不一致');
        view=await open(5);await submit(view,1);check(view.searchNodes.state.textContent.includes('自分の駐車枠'),'自分の枠の状態が不正');
        check(getComputedStyle(view.modal.querySelector('#spot-5-1')).stroke==='rgb(241, 196, 15)','自分の黄枠が消えた');
        await frames(24);window.__qaShot='own';await until(()=>!window.__qaShot);
        view.searchNodes.action.click();check(document.getElementById('checkoutModal').style.display==='block','共通出庫確認へ進まない');
        document.getElementById('cancelCheckoutBtn').click();check(activeMapView===view,'出庫キャンセルでマップが閉じた');
        view.searchNodes.action.click();document.getElementById('confirmCheckoutBtn').click();await until(()=>!myParkingInfo&&!parkingOperationPending&&!activeMapView);
        denyCheckin=true;view=await open(5);await submit(view,3);view.searchNodes.action.click();document.getElementById('endTimeInput').value='16:00';document.getElementById('endTimeSubmitBtn').click();
        await until(()=>!parkingOperationPending);await frames();check(!myParkingInfo&&document.getElementById('endTimeModal').style.display==='block','登録拒否が成功扱いされた');
        document.getElementById('closeEndTimeModal').click();closeInteractiveMap();denyCheckin=false;
        await showLotDetail(5);document.getElementById('parkingMap').children[3].click();check(document.getElementById('endTimeModal').style.display==='block','旧番号一覧の内部処理が壊れた');
        closeEndTimeModal();closeDetailModal();
        results.push({inlineErrors:true,staleResultRejected:true,sharedCheckin:true,sharedCheckout:true,serverRejectionHandled:true,legacyNumberListRetained:true});
        document.querySelectorAll('.notification').forEach(node=>node.remove());
        view=await open(3);await submit(view,128);await frames(24);finish();
    }catch(error){finish(error);}
};
