const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCapture } = require('../desktop/capture.cjs');
function fixture(options = {}) {
 const events = [], actions = [];
 const win = { isDestroyed: () => false, isVisible: () => true, hide: () => actions.push('hide'), showInactive: () => actions.push('restore') };
 const target = { id: 42, bounds: { x: 0, y: 0, width: 1440, height: 900 } };
 const scan = createCapture({ capturer: { getSources: async () => [{ display_id: '42', name: 'Display', thumbnail: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,eA==' } }] }, screen: { getDisplayNearestPoint: () => target, getCursorScreenPoint: () => ({x:0,y:0}) }, windows: () => [win], platform: 'darwin', permission: () => 'granted', delay: async () => {}, log: e => events.push(e), ...options });
 return {scan,events,actions};
}
test('capture chooses the cursor display and restores the overlay without stealing focus', async () => {
 const f = fixture(); assert.equal((await f.scan()).name, 'Display'); assert.deepEqual(f.actions, ['hide','restore']); assert.equal(f.events.at(-1).method,'electron');
});
test('macOS enumeration failure uses native fallback and records the original reason', async () => {
 const f = fixture({ capturer: {getSources: async () => {throw new Error('Failed to get sources.')}}, fallback: async target => ({name:'Fallback',dataUrl:String(target.id)}) });
 assert.equal((await f.scan()).dataUrl,'42'); assert.equal(f.events[1].message,'Failed to get sources.'); assert.deepEqual(f.actions,['hide','restore']);
});
test('denied permissions produce actionable errors, no fallback, and restore windows', async () => {
 let fallback = false;
 const f = fixture({ permission: () => 'denied', capturer:{getSources:async()=>{throw new Error('Failed to get sources.')}}, fallback:async()=>{fallback=true} });
 await assert.rejects(f.scan(), /permission: denied.*Enable Cue.*Technical reason: Failed to get sources/s); assert.equal(fallback,false); assert.deepEqual(f.actions,['hide','restore']);
});
test('capture failure releases the busy slot for retry', async () => {
 const f = fixture({platform:'linux',capturer:{getSources:async()=>[]}});
 await assert.rejects(f.scan(),/No usable thumbnail/); await assert.rejects(f.scan(),/No usable thumbnail/);
});
