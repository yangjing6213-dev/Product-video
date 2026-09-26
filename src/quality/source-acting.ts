// SPDX-License-Identifier: Apache-2.0
/** Original-pixel acting: articulated bends, attention and authored, seekable timing. */
export type Point=[number,number];
export interface ArmLandmarks {root:Point;joint:Point;grip:Point}
export interface EyeRegion {cx:number;cy:number;rx:number;ry:number}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>{const p=clamp(v);return p*p*(3-2*p);};
export function rotate(p:Point,c:Point,degrees:number):Point {const a=degrees*Math.PI/180,x=p[0]-c[0],y=p[1]-c[1];return[c[0]+x*Math.cos(a)-y*Math.sin(a),c[1]+x*Math.sin(a)+y*Math.cos(a)];}
export function curve(keys:readonly Point[],t:number):number {
 if(!Number.isFinite(t)||!keys.length||keys.some((k,i)=>k.length!==2||!k.every(Number.isFinite)||(i>0&&k[0]<=keys[i-1]![0])))throw Error('Acting needs finite ordered time keys');
 if(t<=keys[0]![0])return keys[0]![1];if(t>=keys.at(-1)![0])return keys.at(-1)![1];
 const i=keys.findIndex(k=>k[0]>t)-1,a=keys[i]!,b=keys[i+1]!,dt=b[0]-a[0],p=(t-a[0])/dt;
 const slope=(j:number)=>{if(j===0||j===keys.length-1)return 0;const before=keys[j-1]!,at=keys[j]!,after=keys[j+1]!,l=(at[1]-before[1])/(at[0]-before[0]),r=(after[1]-at[1])/(after[0]-at[0]);return l*r<=0?0:2*l*r/(l+r);};
 return (2*p**3-3*p*p+1)*a[1]+(p**3-2*p*p+p)*dt*slope(i)+(-2*p**3+3*p*p)*b[1]+(p**3-p*p)*dt*slope(i+1);
}
export function armPoint(p:Point,arm:ArmLandmarks,shoulder:number,bend:number):Point {
 const dx=arm.grip[0]-arm.root[0],dy=arm.grip[1]-arm.root[1],length2=dx*dx+dy*dy;
 if(length2===0)throw Error('Arm landmarks need a nonzero length');
 const along=((p[0]-arm.root[0])*dx+(p[1]-arm.root[1])*dy)/length2;
 return rotate(rotate(p,arm.joint,bend*ease((along-.30)/.42)),arm.root,shoulder*ease((along+.2)/.75));
}
export function solveArm(arm:ArmLandmarks,target:Point):{shoulder:number;bend:number;reachable:boolean} {
 const a=Math.hypot(arm.joint[0]-arm.root[0],arm.joint[1]-arm.root[1]),b=Math.hypot(arm.grip[0]-arm.joint[0],arm.grip[1]-arm.joint[1]);
 if(!a||!b||!target.every(Number.isFinite))throw Error('Arm solver needs finite landmarks and target');
 const rest=Math.atan2(arm.joint[1]-arm.root[1],arm.joint[0]-arm.root[0]),restB=Math.atan2(arm.grip[1]-arm.joint[1],arm.grip[0]-arm.joint[0])-rest;
 const x=target[0]-arm.root[0],y=target[1]-arm.root[1],r=Math.hypot(x,y),safe=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.001,r)),angle=Math.acos(Math.max(-1,Math.min(1,(safe*safe-a*a-b*b)/(2*a*b))))*(restB<0?-1:1);
 const shoulder=(Math.atan2(y,x)-Math.atan2(b*Math.sin(angle),a+b*Math.cos(angle))-rest)*180/Math.PI;
 return{shoulder:((shoulder+540)%360)-180,bend:(angle-restB)*180/Math.PI,reachable:r<=a+b&&r>=Math.abs(a-b)};
}
export function bodyPoint(p:Point,hip:Point,footLine:number,lean:number,breath:number):Point {
 const w=1-ease((p[1]-hip[1])/(footLine-hip[1])),q=rotate(p,hip,lean);
 return[p[0]+(q[0]-p[0])*w,p[1]+(q[1]-p[1]+breath)*w];
}
/** Inverse-sample the original eye pixels: no mesh folds or triangular blink seams. */
export function faceTexture(source:HTMLCanvasElement,bounds:[number,number,number,number],eyes:readonly EyeRegion[],lookX:number,lookY:number,blink:number,output?:HTMLCanvasElement):HTMLCanvasElement {
 const canvas=output??document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d')!,raw=source.getContext('2d',{willReadFrequently:true})!;
 ctx.drawImage(source,0,0);for(const eye of eyes){const left=Math.max(0,Math.floor(eye.cx-eye.rx-bounds[0])),top=Math.max(0,Math.floor(eye.cy-eye.ry-bounds[1])),right=Math.min(source.width,Math.ceil(eye.cx+eye.rx-bounds[0])),bottom=Math.min(source.height,Math.ceil(eye.cy+eye.ry-bounds[1]));if(right<=left||bottom<=top)continue;
  const patch=raw.getImageData(left,top,right-left,bottom-top),out=ctx.createImageData(patch.width,patch.height),cx=eye.cx-bounds[0]-left,cy=eye.cy-bounds[1]-top;
  for(let y=0;y<patch.height;y++)for(let x=0;x<patch.width;x++){
   const wx=1-ease((Math.abs((x-cx)/eye.rx)-.78)/.22),k=1-.94*clamp(blink)*wx,offset=Math.max(-eye.ry*.09,Math.min(eye.ry*.09,lookY))*wx,inner=.9*eye.ry,d=y-cy,lo=offset-inner*k,hi=offset+inner*k;
   const sy=cy+(d<lo?-eye.ry+(d+eye.ry)*(eye.ry-inner)/(lo+eye.ry):d>hi?inner+(d-hi)*(eye.ry-inner)/(eye.ry-hi):(d-offset)/k);
   const wy=1-ease((Math.abs((sy-cy)/eye.ry)-.78)/.22),sx=x-lookX*wx*wy;
   const u=Math.max(0,Math.min(patch.width-1,sx)),v=Math.max(0,Math.min(patch.height-1,sy)),a=Math.floor(u),b=Math.floor(v),aa=Math.min(a+1,patch.width-1),bb=Math.min(b+1,patch.height-1),fx=u-a,fy=v-b;
   for(let c=0;c<4;c++)out.data[(y*patch.width+x)*4+c]=patch.data[(b*patch.width+a)*4+c]!*(1-fx)*(1-fy)+patch.data[(b*patch.width+aa)*4+c]!*fx*(1-fy)+patch.data[(bb*patch.width+a)*4+c]!*(1-fx)*fy+patch.data[(bb*patch.width+aa)*4+c]!*fx*fy;
  }ctx.putImageData(out,left,top);
 }return canvas;
}
/** The map is shared by the texture vertices and the prop contact point. */
export function paintWarp(ctx:CanvasRenderingContext2D,texture:HTMLCanvasElement,bounds:[number,number,number,number],map:(p:Point)=>Point,step=12):void {
 const [l,t,r,b]=bounds,w=r-l,h=b-t;
 const triangle=(src:[Point,Point,Point])=>{
  const dst=src.map(([x,y])=>map([x+l,y+t])),[a,b,c]=src,den=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
  const affine=(k:number)=>{const da=dst[1]![k]!-dst[0]![k]!,db=dst[2]![k]!-dst[0]![k]!,x=(da*(c[1]-a[1])-db*(b[1]-a[1]))/den,y=((b[0]-a[0])*db-(c[0]-a[0])*da)/den;return[x,y,dst[0]![k]!-x*a[0]-y*a[1]];};
  const [ax,ay,at]=affine(0),[bx,by,bt]=affine(1),cx=dst.reduce((n,p)=>n+p[0]!,0)/3,cy=dst.reduce((n,p)=>n+p[1]!,0)/3;
  ctx.save();ctx.beginPath();dst.forEach((p,i)=>{const dx=p[0]!-cx,dy=p[1]!-cy,k=1+1.8/Math.max(.001,Math.hypot(dx,dy));if(i)ctx.lineTo(cx+dx*k,cy+dy*k);else ctx.moveTo(cx+dx*k,cy+dy*k);});ctx.closePath();ctx.clip();ctx.transform(ax!,bx!,ay!,by!,at!,bt!);ctx.drawImage(texture,0,0);ctx.restore();
 };
 for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){const xx=Math.min(w,x+step),yy=Math.min(h,y+step);triangle([[x,y],[xx,y],[x,yy]]);triangle([[xx,y],[xx,yy],[x,yy]]);}
}
export interface ActingGeometry {hip:Point;footLine:number;head:Point;arms:{leftArm:ArmLandmarks;rightArm:ArmLandmarks};eyes:EyeRegion[];facePart:'head'|'body'}
export interface ActingPose {lean:number;breath:number;head:number;lookX:number;lookY:number;blink:number;leftArm:number;rightArm:number;leftBend:number;rightBend:number}
export function actingPoint(p:Point,part:string,rig:ActingGeometry,pose:ActingPose):Point {
 let q=p;
 if(part==='leftArm'||part==='rightArm')q=armPoint(q,rig.arms[part],pose[part],part==='leftArm'?pose.leftBend:pose.rightBend);
 if(part==='head')q=rotate(q,rig.head,pose.head);
 return bodyPoint(q,rig.hip,rig.footLine,pose.lean,pose.breath);
}
export interface PartTexture {name:string;texture:HTMLCanvasElement;bounds:[number,number,number,number]}
/** Build transparent runtime textures from approved SVG pixels; writes no source images. */
export async function prepareActingTextures(svg:string):Promise<PartTexture[]> {
 const documentSvg=new DOMParser().parseFromString(svg,'image/svg+xml');
 if(documentSvg.querySelector('parsererror'))throw Error('Invalid source SVG');
 const view=documentSvg.documentElement.getAttribute('viewBox')!.split(' ').map(Number),[l,t,w,h]=view as [number,number,number,number],out:PartTexture[]=[];
 for(const name of ['leftLeg','rightLeg','leftArm','rightArm','body','head']){
  const copy=documentSvg.cloneNode(true) as Document;copy.querySelectorAll('[data-source-part]').forEach(p=>{if(p.getAttribute('data-source-part')!==name)p.remove();});copy.querySelectorAll('[data-reconstructed-socket]').forEach(p=>p.remove());
  const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));await image.decode();
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(image,0,0);const data=context.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=0,y1=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(data[(y*w+x)*4+3]!>0){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
  if(x1<=x0||y1<=y0)continue;
  const texture=document.createElement('canvas');texture.width=x1-x0;texture.height=y1-y0;texture.getContext('2d',{willReadFrequently:true})!.drawImage(canvas,x0,y0,x1-x0,y1-y0,0,0,x1-x0,y1-y0);out.push({name,texture,bounds:[l+x0,t+y0,l+x1,t+y1]});
 }
 return out;
}
export function actingRuntime():string {return `const clamp=${clamp.toString()},ease=${ease.toString()};${rotate.toString()};${curve.toString()};${armPoint.toString()};${solveArm.toString()};${bodyPoint.toString()};${faceTexture.toString()};${paintWarp.toString()};${actingPoint.toString()};${prepareActingTextures.toString()};`;}
