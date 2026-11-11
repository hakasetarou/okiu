const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const search = require('../public/map-search');
const geometry = require('../public/parking-map-data');

test('search accepts normalized digits and rejects empty, zero, negatives, decimals and partial numbers', () => {
    for (const value of ['', ' ', '0', '-1', '1.5', '100a', '1e2', 'Infinity', '9007199254740992']) {
        assert.throws(() => search.parseNumber(value));
    }
    assert.equal(search.parseNumber(' １２８ '),128);
    assert.equal(search.parseNumber('001'),1);
});
test('existence uses registered numbers rather than the capacity or an assumed sequence', () => {
    const lot={id:2,name:'第2駐車場',capacity:205,spaces:[{id:1},{id:100}]};
    const spots=[{id:1},{id:99},{id:100}];
    assert.equal(search.findSpot(lot,spots,'100').id,100);
    assert.throws(()=>search.findSpot(lot,spots,'99'),/99番はありません/);
    assert.throws(()=>search.findSpot(lot,spots,'206'),/第2駐車場に206番はありません/);
    assert.throws(()=>search.findSpot(lot,[{id:1}],'100'),/100番は存在しますが/);
});
test('fresh occupancy, own-space priority and departure time match the existing map contract', () => {
    const rows=[{lot_id:'2',spot_number:100,status:'occupied',end_time:'15:30'}];
    assert.equal(search.spaceState(2,100,rows,null).kind,'occupied');
    assert.equal(search.spaceState(2,100,rows,null).endTime,'15:30');
    assert.equal(search.spaceState(2,101,rows,null).action,'checkin');
    assert.equal(search.spaceState(2,100,rows,{lot_id:2,space_id:100}).action,'checkout');
    assert.equal(search.spaceState(2,100,rows,{lot_id:5,space_id:100}).kind,'occupied');
    for(const bad of [null,{},[{lot_id:2,spot_number:100,status:'unknown'}],[...rows,...rows]]) assert.throws(()=>search.validateStatus(bad),/空き情報/);
    assert.deepEqual(search.validateStatus([]),[]);
});
for(const [id,count] of [[1,530],[2,205],[3,706],[4,78],[5,61],[7,104]]) {
    test(`lot ${id}: every registered coordinate supports bounded search and a new target at sufficient zoom`,()=>{
        const spec=JSON.parse(fs.readFileSync(`docs/lot-${id}-map-rows.json`));
        const spots=JSON.parse(fs.readFileSync(`public/data/parking-spots/lot-${id}.json`));
        const metrics=geometry.measureSpots(spots,spec.width,spec.height);
        const lot={id,capacity:count,spaces:spots.map(s=>({id:s.id}))};
        for(const [width,height] of [[393,650],[360,600],[852,250],[1366,600]]) {
            const fit=Math.min(width/spec.width,height/spec.height),max=geometry.mapSizing(metrics,fit).maxScale;
            for(const spot of spots) {
                assert.equal(search.findSpot(lot,spots,String(spot.id)).id,spot.id);
                const result=search.focusPosition(metrics,spot.id,fit,max,max,width,height,id);
                assert.equal(result.scale,max);
                assert.ok(geometry.containsPoint(metrics.spots.find(s=>s.id===spot.id).polygon,result.point));
                assert.ok(Math.abs(result.pan.x)<=Math.max(0,(spec.width*fit-width/max)/2)+1e-8);
                assert.ok(Math.abs(result.pan.y)<=Math.max(0,(spec.height*fit-height/max)/2)+1e-8);
            }
            const a=search.focusPosition(metrics,1,fit,max,max,width,height,id);
            const b=search.focusPosition(metrics,count,fit,max,max,width,height,id);
            assert.ok(Math.hypot(a.pan.x-b.pan.x,a.pan.y-b.pan.y)>0);
        }
    });
}
