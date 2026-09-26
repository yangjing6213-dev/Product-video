// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';import assert from 'node:assert/strict';
import {sourceMotionPoint,sampleSourceMotion,SOURCE_LANDMARKS} from '../../src/quality/source-motion.ts';
const neutral={head:0,body:0,gesture:0,restArm:0};
test('native original coordinates stay unchanged at neutral and all planted foot points remain fixed',()=>{
 for(const rig of Object.values(SOURCE_LANDMARKS))for(let x=580;x<1330;x+=15)for(let y=24;y<950;y+=15){
  const [px,py]=sourceMotionPoint(x,y,neutral,rig);assert.ok(Math.abs(px-x)<1e-8&&Math.abs(py-y)<1e-8);
  if(y>=rig.footLine)assert.deepEqual(sourceMotionPoint(x,y,{head:3,body:2,gesture:9,restArm:-4},rig),[x,y]);
 }
});
test('source motion is seek deterministic with bounded eased intermediate positions',()=>{
 const keys=[{time:0,pose:neutral},{time:1,pose:{head:2,body:1,gesture:8,restArm:-2}},{time:3,pose:neutral}];
 const a=sampleSourceMotion(keys,.4);sampleSourceMotion(keys,2);assert.deepEqual(sampleSourceMotion(keys,.4),a);
 assert.ok(a.gesture>0&&a.gesture<8);assert.notDeepEqual(a,sampleSourceMotion(keys,.5));assert.deepEqual(sampleSourceMotion(keys,4),neutral);
 assert.throws(()=>sampleSourceMotion([{time:1,pose:neutral},{time:0,pose:neutral}],0),/ordered/);
 assert.throws(()=>sampleSourceMotion([{time:0,pose:{...neutral,head:90}}],0),/bounded/);
});
