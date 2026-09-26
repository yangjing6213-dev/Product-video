// SPDX-License-Identifier: Apache-2.0
import {curve,rotate,type Point,type ActingGeometry,type ActingPose} from './source-acting.ts';
/** An intentionally limited cutout performance. Original hands are never mesh-bent. */
export function rigidSourcePoint(p:Point,part:string,rig:ActingGeometry,pose:ActingPose):Point {
 let q=p;
 if(part==='leftArm'||part==='rightArm')q=rotate(q,rig.arms[part].root,pose[part]);
 if(part==='head')q=rotate(q,rig.head,pose.head);
 return rotate(q,[rig.hip[0],rig.footLine],pose.lean);
}
/** One anticipatory gesture per shot, followed by a hold; no periodic pose swapping. */
export function limitedGesture(t:number,id:'tuotuo'|'xinbi',view:'front'|'present'):ActingPose {
 const delay=id==='xinbi'?.22:0,q=t-delay,present=view==='present',amount=present?5:2;
 const gesture=curve([[0,0],[.35,-.25],[.9,1],[1.8,.65],[2.7,0],[6,0]],q);
 const blink=Math.max(0,1-Math.abs(q-2.2)/.13);
 return{lean:curve([[0,0],[.35,-.25],[1,.55],[2,.2],[3.2,0],[6,0]],q),breath:0,head:id==='tuotuo'?curve([[0,0],[.7,-1.6],[1.2,1],[2.6,0],[6,0]],q):0,
 lookX:curve([[0,0],[.7,id==='tuotuo'?-2:2],[2,0],[6,0]],q),lookY:0,blink,
 leftArm:id==='tuotuo'?-amount*gesture:0,rightArm:id==='xinbi'?amount*gesture:0,leftBend:0,rightBend:0};
}
export function limitedActingRuntime():string{return `${rigidSourcePoint.toString()};${limitedGesture.toString()};`;}
