// SPDX-License-Identifier: Apache-2.0
import {test} from 'node:test';import assert from 'node:assert/strict';
import {rigidSourcePoint,limitedGesture} from '../../src/quality/limited-acting.ts';
import {armPoint,type ActingGeometry} from '../../src/quality/source-acting.ts';
const rig:ActingGeometry={hip:[334,418],footLine:509,head:[335,291],facePart:'head',eyes:[],arms:{leftArm:{root:[257,324],joint:[226,370],grip:[228,410]},rightArm:{root:[405,328],joint:[431,369],grip:[435,410]}}};
test('original limbs and hands stay rigid; rejected weighted bend elongates the forearm',()=>{
 const points:[[number,number],[number,number]]=[[205,397],[249,395]],distance=(p:typeof points)=>Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1]);
 const before=distance(points),forearm:typeof points=[[253,356],[228,410]],old=forearm.map(p=>armPoint(p,rig.arms.leftArm,43,35)) as typeof points;assert.ok(Math.abs(distance(old)-distance(forearm))>10,'baseline must reproduce the elongated forearm');
 for(let t=0;t<6;t+=.1){const pose=limitedGesture(t,'tuotuo','present');const after=points.map(p=>rigidSourcePoint(p,'leftArm',rig,pose)) as typeof points;assert.ok(Math.abs(distance(after)-before)<1e-8);}
});
test('limited acting is deterministic and holds after its authored gesture instead of looping',()=>{
 const a=limitedGesture(2.2,'xinbi','present');limitedGesture(5,'tuotuo','front');assert.deepEqual(limitedGesture(2.2,'xinbi','present'),a);
 assert.deepEqual(limitedGesture(9,'tuotuo','front'),limitedGesture(12,'tuotuo','front'));
 for(let t=0;t<6;t+=.05){const p=limitedGesture(t,'tuotuo','front');assert.ok(Math.abs(p.leftArm)<=3&&Math.abs(p.rightArm)<=3);assert.equal(p.leftBend,0);assert.equal(p.rightBend,0);}
});
