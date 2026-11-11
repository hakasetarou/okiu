// 番号一覧専用の閲覧用図面。駐車登録や既存マップの操作状態は扱わない。
(function (root) {
    'use strict';
    const mapData = typeof module !== 'undefined' && module.exports
        ? require('./parking-map-data') : root.ParkingMapData;
    const svgNS = 'http://www.w3.org/2000/svg';

    function edgeDistance(point, a, b) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1,
            ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
        return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
    }

    // 枠内で外周から離れた点を選ぶ。凹形の枠でも頂点平均が外へ出る問題を避ける。
    function labelLayout(spots, width, height) {
        return mapData.measureSpots(spots, width, height).spots.map(spot => {
            const xs = spot.polygon.map(p => p[0]), ys = spot.polygon.map(p => p[1]);
            const left = Math.min(...xs), top = Math.min(...ys);
            const boxWidth = Math.max(...xs) - left, boxHeight = Math.max(...ys) - top;
            let area = 0, cx = 0, cy = 0;
            spot.polygon.forEach((a, index, points) => {
                const b = points[(index + 1) % points.length], cross = a[0] * b[1] - b[0] * a[1];
                area += cross; cx += (a[0] + b[0]) * cross; cy += (a[1] + b[1]) * cross;
            });
            const candidates = [spot.center, [cx / (3 * area), cy / (3 * area)]];
            for (let y = 1; y < 10; y++) for (let x = 1; x < 10; x++) {
                candidates.push([left + boxWidth * x / 10, top + boxHeight * y / 10]);
            }
            let anchor, radius = 0;
            candidates.forEach(point => {
                if (!mapData.containsPoint(spot.polygon, point)) return;
                const distance = Math.min(...spot.polygon.map((a, index, points) =>
                    edgeDistance(point, a, points[(index + 1) % points.length])));
                if (distance > radius) { anchor = point; radius = distance; }
            });
            if (!anchor) throw new Error(`${spot.id}番の番号配置位置を計算できません。`);
            const fontSize = 1.35 * radius / Math.hypot(String(spot.id).length * 0.65, 1.2);
            return { id: spot.id, x: anchor[0], y: anchor[1], fontSize, polygon: spot.polygon };
        });
    }

    // 表示上11px未満の番号は省略。文字の大きさは20pxで止め、近接文字も間引く。
    function labelVisibility(labels, scale) {
        const cells = new Map();
        return labels.map(label => {
            const fontSize = Math.min(label.fontSize, 20 / scale);
            const size = fontSize * scale;
            if (!(size >= 11)) return { id: label.id, visible: false, fontSize };
            const halfWidth = size * String(label.id).length * 0.65 / 2 + 1;
            const halfHeight = size * 0.6 + 1;
            const box = { left: label.x * scale - halfWidth, right: label.x * scale + halfWidth,
                top: label.y * scale - halfHeight, bottom: label.y * scale + halfHeight };
            const keys = [];
            for (let x = Math.floor(box.left / 32); x <= Math.floor(box.right / 32); x++) {
                for (let y = Math.floor(box.top / 32); y <= Math.floor(box.bottom / 32); y++) keys.push(`${x},${y}`);
            }
            const overlaps = keys.some(key => (cells.get(key) || []).some(other =>
                box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top));
            if (!overlaps) keys.forEach(key => {
                if (!cells.has(key)) cells.set(key, []);
                cells.get(key).push(box);
            });
            return { id: label.id, visible: !overlaps, fontSize };
        });
    }

    // 通常の2桁・3桁の差を含めて小さい文字に合わせる。中央値の半分未満だけを
    // 極端に細い枠として除外し、1枠のために周囲が過剰に拡大されることを避ける。
    function autoZoomForPoint(labels, fitScale, currentScale, point, maxScale) {
        if (!labels.length || ![fitScale, currentScale, maxScale].every(n => Number.isFinite(n) && n > 0)) return null;
        const nearby = labels.map(label => ({ label,
            distance: Math.hypot(label.x - point[0], label.y - point[1]) * fitScale * currentScale }))
            .filter(item => item.distance <= 120).sort((a, b) => a.distance - b.distance || a.label.id - b.label.id)
            .slice(0, 8).map(item => item.label);
        const sample = nearby.length ? nearby : labels;
        const median = mapData.percentile(sample.map(label => label.fontSize), 0.5);
        const regular = sample.filter(label => label.fontSize >= median * 0.5);
        const fontSize = Math.min(...regular.map(label => label.fontSize));
        const needed = 14 / (fontSize * fitScale);
        const scale = Math.max(currentScale, Math.min(maxScale, needed));
        return { scale, needed, fontSize, nearbyIds: nearby.map(label => label.id),
            excludedIds: sample.filter(label => label.fontSize < median * 0.5).map(label => label.id),
            limited: needed > maxScale + 1e-6,
            needsZoom: fontSize * fitScale * currentScale < 13.9 && scale > currentScale + 1e-6 };
    }

    function create({ document, window, fetchCoordinates, panzoom }) {
        const el = id => document.getElementById(id);
        const panel = el('lotDiagramPanel'), opener = el('lotDiagramOpen');
        const modal = el('imageZoomModal'), hint = el('lotDiagramHint'), guide = el('imageZoomGuide');
        const controls = [el('imageZoomIn'), el('imageZoomOut'), el('imageZoomReset')];
        let current = null, zoom = null, revision = 0;

        function surface(prefix, viewport) {
            return { viewport, canvas: el(prefix === 'lot' ? 'lotDiagramCanvas' : 'imageZoomCanvas'),
                image: el(prefix === 'lot' ? 'lotDetailImage' : 'zoomedImage'),
                svg: el(prefix === 'lot' ? 'lotDetailNumbers' : 'zoomedNumbers'), nodes: new Map() };
        }
        function draw(view) {
            view.lastLabelScale = null;
            view.svg.replaceChildren();
            view.nodes.clear();
            view.svg.setAttribute('viewBox', `0 0 ${current.width} ${current.height}`);
            current.labels.forEach(label => {
                const outline = document.createElementNS(svgNS, 'polygon');
                outline.setAttribute('points', label.polygon.map(p => p.join(',')).join(' '));
                outline.setAttribute('class', 'numbered-diagram-outline');
                outline.setAttribute('data-space-id', label.id);
                const text = document.createElementNS(svgNS, 'text');
                text.setAttribute('x', label.x); text.setAttribute('y', label.y);
                text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'central');
                text.setAttribute('class', 'numbered-diagram-number');
                text.setAttribute('data-space-id', label.id);
                text.textContent = String(label.id);
                view.svg.appendChild(outline); view.svg.appendChild(text);
                view.nodes.set(label.id, text);
            });
        }
        function update(view) {
            if (!current || !view.fitScale) return;
            const scale = view.fitScale * (view.panzoom ? view.panzoom.getScale() : 1);
            // 移動だけなら文字サイズと重なりは変わらないので、706枠の再計算を省く。
            if (view.lastLabelScale !== scale) {
                view.lastLabelScale = scale;
                view.visibleCount = 0;
                labelVisibility(current.labels, scale).forEach(label => {
                    const node = view.nodes.get(label.id);
                    node.style.display = label.visible ? '' : 'none';
                    node.style.fontSize = `${label.fontSize}px`;
                    node.style.strokeWidth = `${label.fontSize * 0.13}px`;
                    if (label.visible) view.visibleCount++;
                });
            }
            if (view === zoom && current.labels.length && !view.zoomUnavailable) {
                const text = `図面全体の番号表示対象：${view.visibleCount} / ${current.labels.length}件。${view.visibleCount === 0
                    ? '見たい場所をタップすると、番号を読める大きさに拡大します。'
                    : '＋／－・ホイール・ピンチで調整、ドラッグで移動。'}${view.autoNote || ''}図面は位置確認専用です。`;
                if (guide.textContent !== text) guide.textContent = text;
            }
        }

        function imagePoint(view, clientX, clientY) {
            const rect = view.canvas.getBoundingClientRect();
            if (!(rect.width > 0 && rect.height > 0)) return null;
            const point = [(clientX - rect.left) / rect.width * current.width,
                (clientY - rect.top) / rect.height * current.height];
            return point.every(Number.isFinite) && point[0] >= 0 && point[0] <= current.width &&
                point[1] >= 0 && point[1] <= current.height ? point : null;
        }

        function autoZoom(view, point) {
            if (zoom !== view || !view.panzoom || view.busy) return;
            const result = autoZoomForPoint(current.labels, view.fitScale, view.panzoom.getScale(), point, view.maxScale);
            if (!result) return;
            view.autoNote = result.limited ? '倍率上限のため一部の番号は14px未満です。'
                : result.excludedIds.length ? '細い枠の番号は＋で確認できます。' : '';
            if (!result.needsZoom) { update(view); return; }
            const pan = mapData.clampMapPan({ x: (current.width / 2 - point[0]) * view.fitScale,
                y: (current.height / 2 - point[1]) * view.fitScale },
                current.width * view.fitScale, current.height * view.fitScale,
                view.viewport.clientWidth, view.viewport.clientHeight, result.scale);
            view.busy = true;
            view.panzoom.zoom(result.scale, { animate: false });
            view.panzoom.pan(pan.x, pan.y, { animate: false });
            queueUpdate();
            view.settleFrame = window.requestAnimationFrame(() => {
                view.settleFrame = null;
                if (zoom === view) view.busy = false;
            });
        }

        function cancelInitialZoom(view) {
            if (view && view.initialFrame != null) {
                window.cancelAnimationFrame(view.initialFrame);
                view.initialFrame = null;
            }
        }

        // Panzoomが開始イベントを止めても追跡できるよう、ポインターは捕捉段階で監視。
        // clickだけでは拡大せず、直前に完了した単一ポインターのタップと照合する。
        function trackTaps(view, accept, keyboard = false) {
            let gesture = null, completed = null, suppressClick = false;
            const down = event => {
                if (event.button != null && event.button !== 0) return;
                cancelInitialZoom(view);
                if (!gesture || !gesture.pointers.size) {
                    completed = null;
                    suppressClick = false;
                    gesture = { pointers: new Map(), moved: false, pinched: false, canceled: !!view.busy };
                }
                gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                if (gesture.pointers.size > 1) { gesture.pinched = true; suppressClick = true; }
            };
            const move = event => {
                const start = gesture && gesture.pointers.get(event.pointerId);
                if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) {
                    gesture.moved = true; suppressClick = true;
                }
            };
            const up = event => {
                if (!gesture || !gesture.pointers.has(event.pointerId)) return;
                move(event);
                if (event.type === 'pointercancel') { gesture.canceled = true; suppressClick = true; }
                gesture.pointers.delete(event.pointerId);
                if (!gesture.pointers.size) completed = { allowed: !gesture.moved && !gesture.pinched && !gesture.canceled,
                    x: event.clientX, y: event.clientY };
            };
            const cancel = () => {
                cancelInitialZoom(view);
                if (gesture) { gesture.canceled = true; gesture.pointers.clear(); }
                completed = null;
                suppressClick = true;
            };
            const click = event => {
                const tap = completed;
                completed = null;
                if (!tap) {
                    if (keyboard && !suppressClick && event.detail === 0 && !event.pointerType) accept(null);
                    return;
                }
                if (!tap.allowed || view.busy || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= 8) return;
                // 互換MouseEventのclientX/Yは整数に丸められる場合がある。
                // 拡大時に誤差を増幅しないよう、確定したポインターの小数座標を使う。
                const point = imagePoint(view, tap.x, tap.y);
                if (point) accept(point);
            };
            view.listeners.push([view.viewport, 'pointerdown', down, true], [document, 'pointermove', move, true],
                [document, 'pointerup', up, true], [document, 'pointercancel', up, true],
                [view.viewport, 'click', click], [view.viewport, 'wheel', cancel, true], [window, 'blur', cancel]);
            if (keyboard) view.listeners.push([view.viewport, 'keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { cancel(); suppressClick = false; }
            }]);
        }
        function fit(view) {
            if (!current || !current.imageReady) return;
            const width = view.viewport.clientWidth, height = view.viewport.clientHeight;
            if (!width || !height) return;
            const previousFit = view.fitScale;
            view.fitScale = Math.min(width / current.width, height / current.height);
            view.canvas.style.width = `${current.width * view.fitScale}px`;
            view.canvas.style.height = `${current.height * view.fitScale}px`;
            const smallest = Math.min(...current.labels.map(label => label.fontSize));
            view.maxScale = Math.max(8, Math.min(128, Math.ceil(16 / (smallest * view.fitScale))));
            if (view.panzoom) {
                view.panzoom.setOptions({ maxScale: Math.max(view.maxScale, view.panzoom.getScale()) });
                if (previousFit && previousFit !== view.fitScale) {
                    const pan = view.panzoom.getPan();
                    view.panzoom.pan(pan.x * view.fitScale / previousFit, pan.y * view.fitScale / previousFit);
                }
            }
            update(view);
        }
        function queueUpdate() {
            if (!zoom || zoom.frame != null) return;
            const view = zoom;
            view.frame = window.requestAnimationFrame(() => {
                view.frame = null;
                if (zoom !== view) return;
                const pan = view.panzoom.getPan();
                const bounded = mapData.clampMapPan(pan, current.width * view.fitScale, current.height * view.fitScale,
                    view.viewport.clientWidth, view.viewport.clientHeight, view.panzoom.getScale());
                if (Math.abs(bounded.x - pan.x) > 0.01 || Math.abs(bounded.y - pan.y) > 0.01) {
                    view.panzoom.pan(bounded.x, bounded.y, { animate: false });
                }
                update(view);
            });
        }
        function changeZoom(factor) {
            if (!zoom || !zoom.panzoom) return;
            cancelInitialZoom(zoom);
            zoom.autoNote = '';
            const rect = zoom.viewport.getBoundingClientRect();
            zoom.panzoom.zoomToPoint(Math.min(zoom.maxScale, Math.max(1, zoom.panzoom.getScale() * factor)),
                { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, { animate: false });
            queueUpdate();
        }
        function closeZoom() {
            const view = zoom;
            zoom = null;
            modal.style.display = 'none';
            if (!view) return;
            if (view.frame != null) window.cancelAnimationFrame(view.frame);
            if (view.settleFrame != null) window.cancelAnimationFrame(view.settleFrame);
            cancelInitialZoom(view);
            if (view.observer) view.observer.disconnect();
            view.listeners.forEach(([target, event, handler, options]) => target.removeEventListener(event, handler, options));
            if (view.panzoom) view.panzoom.destroy();
            view.canvas.style.transform = 'none';
            document.body.style.overflow = view.previousOverflow;
            el('lotDetailModal').inert = view.previousInert;
            if (view.previousFocus && view.previousFocus.isConnected) view.previousFocus.focus();
        }
        function openZoom(initialPoint = null) {
            if (!current || !current.imageReady) return false;
            closeZoom();
            const view = zoom = surface('zoom', el('imageZoomViewport'));
            view.listeners = [];
            view.previousFocus = document.activeElement;
            view.previousOverflow = document.body.style.overflow;
            view.previousInert = el('lotDetailModal').inert;
            document.body.style.overflow = 'hidden';
            el('lotDetailModal').inert = true;
            view.image.src = current.lot.imageUrl;
            view.image.alt = `${current.lot.name}の番号付き図面`;
            el('imageZoomTitle').textContent = `${current.lot.name}の番号付き図面${[3, 7].includes(Number(current.lot.id)) ? '（暫定・位置を確認中）' : ''}`;
            modal.style.display = 'block';
            draw(view); fit(view);
            try {
                view.panzoom = panzoom(view.canvas, { minScale: 1, maxScale: view.maxScale, canvas: true });
                const wheel = event => { cancelInitialZoom(view); view.autoNote = ''; view.panzoom.zoomWithWheel(event); queueUpdate(); };
                view.listeners.push([view.viewport, 'wheel', wheel, { passive: false }],
                    [view.canvas, 'panzoomchange', queueUpdate]);
                trackTaps(view, point => autoZoom(view, point));
                controls.forEach(button => { button.disabled = false; });
            } catch (error) {
                view.zoomUnavailable = true;
                guide.textContent = '拡大機能を読み込めません。画面を開き直してください。';
                controls.forEach(button => { button.disabled = true; });
            }
            if (!current.labels.length) guide.textContent = '番号を表示できません。番号一覧に戻って確認してください。';
            const resize = () => { if (zoom === view) { fit(view); if (view.panzoom) queueUpdate(); } };
            const keydown = event => {
                if (event.key === 'Escape') { event.preventDefault(); closeZoom(); return; }
                if (event.key === 'Tab') {
                    const focusable = [document.querySelector('.close-zoom-modal'), view.viewport, ...controls.filter(button => !button.disabled)];
                    const index = focusable.indexOf(document.activeElement);
                    if (event.shiftKey && index <= 0) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
                    else if (!event.shiftKey && (index === focusable.length - 1 || index < 0)) { event.preventDefault(); focusable[0].focus(); }
                    return;
                }
                if (event.target !== view.viewport || !view.panzoom) return;
                if (['+', '=', '-', '0'].includes(event.key)) {
                    event.preventDefault();
                    if (event.key === '0') { cancelInitialZoom(view); view.autoNote = ''; view.panzoom.reset({ animate: false }); queueUpdate(); }
                    else changeZoom(event.key === '-' ? 1 / 1.5 : 1.5);
                } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    cancelInitialZoom(view);
                    const pan = view.panzoom.getPan(), step = 48 / view.panzoom.getScale();
                    view.panzoom.pan(pan.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
                        pan.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0));
                    queueUpdate();
                }
            };
            view.listeners.push([window, 'resize', resize], [modal, 'keydown', keydown]);
            view.listeners.forEach(([target, event, handler, options]) => target.addEventListener(event, handler, options));
            if (window.ResizeObserver) { view.observer = new window.ResizeObserver(resize); view.observer.observe(view.viewport); }
            document.querySelector('.close-zoom-modal').focus();
            if (Array.isArray(initialPoint) && view.panzoom) {
                // 新しい画面の寸法とPanzoomの初期変形が描画された後に位置を引き継ぐ。
                view.initialFrame = window.requestAnimationFrame(() => {
                    if (zoom !== view) return;
                    view.initialFrame = window.requestAnimationFrame(() => {
                        view.initialFrame = null;
                        if (zoom === view) autoZoom(view, initialPoint);
                    });
                });
            }
            return true;
        }
        function close() {
            revision++;
            closeZoom();
            if (current) {
                if (current.observer) current.observer.disconnect();
                if (current.cancelImage) current.cancelImage();
                (current.listeners || []).forEach(([target, event, handler, options]) => target.removeEventListener(event, handler, options));
                window.removeEventListener('resize', current.resize);
            }
            current = null;
            el('lotDetailNumbers').replaceChildren();
            el('zoomedNumbers').replaceChildren();
        }
        async function show(lot) {
            close();
            const token = revision;
            const view = current = { ...surface('lot', opener), lot, labels: [], imageReady: false, listeners: [] };
            panel.hidden = !lot.imageUrl;
            view.canvas.style.visibility = 'hidden';
            view.image.removeAttribute('src');
            opener.disabled = true;
            if (!lot.imageUrl) return;
            hint.textContent = '番号付き図面を読み込んでいます…';
            const imagePromise = new Promise((resolve, reject) => {
                const image = view.preloader = new window.Image();
                view.cancelImage = () => {
                    image.onload = image.onerror = null;
                    reject(new Error('図面の読み込みを取り消しました。'));
                };
                image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
                    ? resolve(image) : reject(new Error('画像サイズが正しくありません。'));
                image.onerror = () => reject(new Error('図面画像を読み込めません。'));
                image.src = lot.imageUrl;
            });
            const results = await Promise.allSettled([imagePromise,
                Promise.resolve().then(() => fetchCoordinates(mapData.spotFile(lot.id))).then(spots => {
                    const valid = mapData.validateSpots(spots, lot.capacity);
                    const ids = new Set((lot.spaces || []).map(space => Number(space.id)));
                    if (!valid.length || valid.length !== ids.size || valid.some(spot => !ids.has(spot.id))) {
                        throw new Error('図面の番号と番号一覧が一致しません。');
                    }
                    return valid;
                })]);
            if (token !== revision || current !== view) return;
            view.preloader.onload = view.preloader.onerror = null;
            view.cancelImage = null;
            if (results[0].status === 'rejected') { hint.textContent = '図面画像を読み込めません。下の番号一覧は利用できます。'; return; }
            const image = results[0].value;
            view.width = image.naturalWidth; view.height = image.naturalHeight; view.imageReady = true;
            view.image.src = lot.imageUrl;
            view.image.alt = `${lot.name}の図面。番号は拡大して確認できます。`;
            let error = results[1].status === 'rejected' ? results[1].reason : null;
            if (!error) {
                try { view.labels = labelLayout(results[1].value, view.width, view.height); }
                catch (layoutError) { error = layoutError; }
            }
            hint.textContent = error ? '図面の番号を表示できません。下の番号一覧は利用できます。'
                : `見たい場所をタップすると、その周辺の番号を拡大します。${[3, 7].includes(Number(lot.id)) ? '（暫定・位置を確認中）' : ''}`;
            draw(view); fit(view);
            view.canvas.style.visibility = 'visible';
            opener.disabled = false;
            trackTaps(view, point => { if (current === view) openZoom(point); }, true);
            view.listeners.forEach(([target, event, handler, options]) => target.addEventListener(event, handler, options));
            view.resize = () => { if (current === view) fit(view); };
            window.addEventListener('resize', view.resize);
            if (window.ResizeObserver) { view.observer = new window.ResizeObserver(view.resize); view.observer.observe(opener); }
        }
        controls[0].addEventListener('click', () => changeZoom(1.5));
        controls[1].addEventListener('click', () => changeZoom(1 / 1.5));
        controls[2].addEventListener('click', () => { if (zoom && zoom.panzoom) { cancelInitialZoom(zoom); zoom.autoNote = ''; zoom.panzoom.reset({ animate: false }); queueUpdate(); } });
        return { show, close, openZoom, closeZoom };
    }
    const api = { labelLayout, labelVisibility, autoZoomForPoint, create };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ParkingNumberedDiagram = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
