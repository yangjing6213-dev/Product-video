// SPDX-License-Identifier: Apache-2.0
/** Small, source-pixel deformations. The face stays rigid and feet stay planted. */
export interface SourceMotion {head:number;body:number;gesture:number;restArm:number}
export interface SourceLandmarks {face:[number,number];body:[number,number];gesture:[number,number];restArm:[number,number];gestureCenter:[number,number];restArmCenter:[number,number];headLine:number;headLeft:number;footLine:number;star:boolean}
export const SOURCE_LANDMARKS:Record<'tuotuo'|'xinbi',SourceLandmarks>={
 tuotuo:{face:[1180,298],body:[1185,418],gesture:[1098,330],restArm:[1260,348],gestureCenter:[1027,334],restArmCenter:[1275,393],headLine:293,headLeft:1037,footLine:481,star:false},
 xinbi:{face:[758,756],body:[756,826],gesture:[861,745],restArm:[632,764],gestureCenter:[908,728],restArmCenter:[620,806],headLine:0,headLeft:0,footLine:886,star:true}
};
const smooth=(v:number)=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x);};
function turn(x:number,y:number,pivot:[number,number],angle:number):[number,number]{const r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r),dx=x-pivot[0],dy=y-pivot[1];return[pivot[0]+dx*c-dy*s,pivot[1]+dx*s+dy*c];}
export function sourceMotionPoint(x:number,y:number,pose:SourceMotion,rig:SourceLandmarks):[number,number]{
 const anchored=1-smooth((y-(rig.footLine-54))/54);
 if(anchored===0)return[x,y];
 let px=x,py=y;
 const head=rig.star?0:smooth((rig.headLine+14-y)/24)*smooth((x-rig.headLeft)/20);
 const headPoint=turn(px,py,rig.face,pose.head*head);px=headPoint[0];py=headPoint[1];
 const influence=(center:[number,number],rx:number,ry:number)=>Math.exp(-(((x-center[0])/rx)**4+((y-center[1])/ry)**4));
 const hand=turn(px,py,rig.gesture,pose.gesture*influence(rig.gestureCenter,rig.star?65:78,rig.star?49:54)*(1-head));px=hand[0];py=hand[1];
 const rest=turn(px,py,rig.restArm,pose.restArm*influence(rig.restArmCenter,44,49)*(1-head));px=rest[0];py=rest[1];
 const body=turn(px,py,rig.body,pose.body);
 return [x+(body[0]-x)*anchored,y+(body[1]-y)*anchored];
}
export interface SourceMotionKey {time:number;pose:SourceMotion}
export function sampleSourceMotion(keys:readonly SourceMotionKey[],time:number):SourceMotion{
 if(!keys.length||keys.some((k,i)=>!Number.isFinite(k.time)||(i>0&&k.time<=keys[i-1]!.time)||!Object.values(k.pose).every(n=>Number.isFinite(n)&&Math.abs(n)<=12)))throw Error('Source motion needs ordered bounded key poses');
 const after=keys.findIndex(k=>k.time>=time);if(after===0)return {...keys[0]!.pose};if(after<0)return {...keys.at(-1)!.pose};
 const left=keys[after-1]!,right=keys[after]!,p=smooth((time-left.time)/(right.time-left.time));
 return Object.fromEntries(Object.keys(left.pose).map(k=>[k,(left.pose[k as keyof SourceMotion])+(right.pose[k as keyof SourceMotion]-left.pose[k as keyof SourceMotion])*p])) as unknown as SourceMotion;
}
/** Invoked synchronously by a GSAP property setter, including suppressed-event seeks. */
export function drawSourceMesh(canvas:HTMLCanvasElement,texture:HTMLCanvasElement,bounds:[number,number,number,number],pose:SourceMotion,rig:SourceLandmarks):void {
 const ctx=canvas.getContext('2d')!,[l,t,r,b]=bounds,w=r-l,h=b-t,pad=24;
 ctx.clearRect(0,0,canvas.width,canvas.height);
 if(Object.values(pose).every(n=>n===0)){ctx.drawImage(texture,pad,pad);return;}
 const point=(x:number,y:number)=>{const p=sourceMotionPoint(x+l,y+t,pose,rig);return[p[0]-l+pad,p[1]-t+pad];};
 const triangle=(s:number[][])=>{
  const d=s.map(p=>point(p[0]!,p[1]!)),[a,b,c]=s as [number[],number[],number[]];
  const den=(b[0]!-a[0]!)*(c[1]!-a[1]!)-(c[0]!-a[0]!)*(b[1]!-a[1]!);
  const affine=(k:number)=>{const da=d[1]![k]!-d[0]![k]!,db=d[2]![k]!-d[0]![k]!;const x=(da*(c[1]!-a[1]!)-db*(b[1]!-a[1]!))/den,y=((b[0]!-a[0]!)*db-(c[0]!-a[0]!)*da)/den;return[x,y,d[0]![k]!-x*a[0]!-y*a[1]!];};
  const [ax,ay,at]=affine(0),[bx,by,bt]=affine(1),cx=d.reduce((sum,p)=>sum+p[0]!,0)/3,cy=d.reduce((sum,p)=>sum+p[1]!,0)/3;
  ctx.save();ctx.beginPath();d.forEach((p,i)=>{const dx=p[0]!-cx,dy=p[1]!-cy,scale=1+1.6/Math.hypot(dx,dy);if(i===0)ctx.moveTo(cx+dx*scale,cy+dy*scale);else ctx.lineTo(cx+dx*scale,cy+dy*scale);});ctx.closePath();ctx.clip();
  ctx.transform(ax!,bx!,ay!,by!,at!,bt!);ctx.drawImage(texture,0,0);ctx.restore();
 };
 const step=18;for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){const xx=Math.min(w,x+step),yy=Math.min(h,y+step);triangle([[x,y],[xx,y],[x,yy]]);triangle([[xx,y],[xx,yy],[x,yy]]);}
}
/** Browser runtime comes from the exact tested functions; no duplicate animation implementation. */
export function sourceMotionRuntime():string{
 return `const smooth=${smooth.toString()};${turn.toString()};${sourceMotionPoint.toString()};${sampleSourceMotion.toString()};${drawSourceMesh.toString()};`;
}
