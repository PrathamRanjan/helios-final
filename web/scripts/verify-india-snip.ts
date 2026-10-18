import assert from 'node:assert/strict';
import { snipRectangle, snipCorners } from '../lib/india/snipping';
const size={width:400,height:300};
assert.deepEqual(snipRectangle({x:20,y:30},{x:120,y:80},size),{left:20,top:30,width:100,height:50});
assert.deepEqual(snipRectangle({x:120,y:80},{x:20,y:30},size),{left:20,top:30,width:100,height:50});
assert.deepEqual(snipRectangle({x:20,y:30},{x:500,y:-20},size),{left:20,top:0,width:380,height:30});
const project=(p:{x:number;y:number})=>({lat:13-p.y*.00001,lng:77+p.x*.00001});
assert.deepEqual(snipCorners({x:20,y:30},{x:120,y:80},size,project),[
 project({x:20,y:30}),project({x:120,y:30}),project({x:120,y:80}),project({x:20,y:80}),
]);
assert.throws(()=>snipCorners({x:20,y:30},{x:22,y:32},size,project),/drag/i);
assert.throws(()=>snipRectangle({x:NaN,y:0},{x:20,y:20},size));
assert.throws(()=>snipRectangle({x:0,y:0},{x:20,y:20},{width:0,height:300}));
console.log('Map snipping: drag directions, screen bounds, geographic corners, accidental clicks and invalid coordinates passed.');
