// SPDX-License-Identifier: Apache-2.0
/** Runtime SVG compositing over immutable source pixels with explicit hidden joint fills. */
export interface SourcePart {name:'head'|'body'|'leftArm'|'rightArm'|'leftLeg'|'rightLeg';clip:string;pivot:[number,number]}
export interface SourceSocket {part:'leftArm'|'rightArm';cx:number;cy:number;rx:number;ry:number;color:string}
export interface SourceRig {sourceAssetId:string;sourceWidth:number;sourceHeight:number;bounds:[number,number,number,number];maskPath:string;parts:SourcePart[];sockets?:SourceSocket[]}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const PATH=/^[MmLlHhVvCcSsQqTtAaZz0-9., +\-]+$/;
export function validateSourceRig(rig:SourceRig):void {
 if(!rig||!rig.sourceAssetId||![rig.sourceWidth,rig.sourceHeight].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16000)||rig.sourceWidth*rig.sourceHeight>30_000_000)throw Error('Invalid source rig canvas');
 const [l,t,r,b]=rig.bounds;if(![l,t,r,b].every(Number.isFinite)||l<0||t<0||r<=l||b<=t||r>rig.sourceWidth||b>rig.sourceHeight)throw Error('Invalid source rig bounds');
 if(!PATH.test(rig.maskPath)||rig.maskPath.length>1_000_000)throw Error('Invalid source silhouette');
 const names=['head','body','leftArm','rightArm','leftLeg','rightLeg'];
 if(rig.parts.length!==6||new Set(rig.parts.map(p=>p.name)).size!==6||rig.parts.some(p=>!names.includes(p.name)||!PATH.test(p.clip)||p.clip.length>10000||p.pivot.length!==2||!p.pivot.every(Number.isFinite)||p.pivot[0]<l||p.pivot[0]>r||p.pivot[1]<t||p.pivot[1]>b))throw Error('Source rig needs six explicit original-pixel part regions');
 if(rig.sockets?.some(s=>!['leftArm','rightArm'].includes(s.part)||![s.cx,s.cy,s.rx,s.ry].every(Number.isFinite)||s.cx<l||s.cx>r||s.cy<t||s.cy>b||s.rx<=0||s.ry<=0||s.rx>24||s.ry>24||!/^#[0-9a-f]{6}$/i.test(s.color)))throw Error('Hidden source sockets must be small explicit reviewed fills');
}
/** Only exterior-connected near-paper pixels are hidden; enclosed white details remain. */
export function sourceSilhouette(pixels:Uint8ClampedArray,width:number,height:number,bounds:[number,number,number,number],backgroundHoles:readonly [number,number][]=[],matteFloor=180):{path:string;exteriorPixels:number;retainedPixels:number}{
 if(pixels.length!==width*height*4)throw Error('Source pixel buffer dimensions differ');
 if(!Number.isInteger(matteFloor)||matteFloor<64||matteFloor>240)throw Error('Invalid reviewed matte threshold');
 const [left,top,right,bottom]=bounds;
 if(!bounds.every(Number.isSafeInteger)||left<0||top<0||right>width||bottom>height||right<=left||bottom<=top)throw Error('Invalid source crop');
 const w=right-left,h=bottom-top,seen=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
 const paper=(x:number,y:number)=>{const p=((y+top)*width+x+left)*4,r=pixels[p]!,g=pixels[p+1]!,b=pixels[p+2]!;return pixels[p+3]===0||(Math.min(r,g,b)>=matteFloor&&Math.max(r,g,b)-Math.min(r,g,b)<=24);};
 const add=(x:number,y:number)=>{if(x<0||y<0||x>=w||y>=h)return;const i=y*w+x;if(!seen[i]&&paper(x,y)){seen[i]=1;queue[tail++]=i;}};
 for(let x=0;x<w;x++){add(x,0);add(x,h-1);}for(let y=0;y<h;y++){add(0,y);add(w-1,y);}
 for(const [x,y] of backgroundHoles){if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x<left||x>=right||y<top||y>=bottom||!paper(x-left,y-top))throw Error('Explicit background hole must be a reviewed paper pixel within crop');add(x-left,y-top);}
 while(head<tail){const i=queue[head++]!,x=i%w,y=Math.floor(i/w);add(x-1,y);add(x+1,y);add(x,y-1);add(x,y+1);}
 // Trace the outer contour once. Scan-line rectangles create antialiased stripes when rotated.
 const edges=new Map<number,number[]>(),stride=w+1;let retainedPixels=0;
 const vertex=(x:number,y:number)=>y*stride+x,edge=(a:number,b:number)=>{const list=edges.get(a)??[];list.push(b);edges.set(a,list);};
 const kept=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&!seen[y*w+x];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(kept(x,y)){retainedPixels++;if(!kept(x,y-1))edge(vertex(x,y),vertex(x+1,y));if(!kept(x+1,y))edge(vertex(x+1,y),vertex(x+1,y+1));if(!kept(x,y+1))edge(vertex(x+1,y+1),vertex(x,y+1));if(!kept(x-1,y))edge(vertex(x,y+1),vertex(x,y));}
 const paths:string[]=[];
 while(edges.size){const start=edges.keys().next().value!,points:[number,number][]=[];let current=start;
  do{points.push([current%stride,Math.floor(current/stride)]);const next=edges.get(current);if(!next?.length)throw Error('Source silhouette has an open boundary');const end=next.pop()!;if(!next.length)edges.delete(current);current=end;}while(current!==start);
  const corners=points.filter((p,i)=>{const a=points[(i+points.length-1)%points.length]!,b=points[(i+1)%points.length]!;return (p[0]-a[0])*(b[1]-p[1])!==(p[1]-a[1])*(b[0]-p[0]);});
  paths.push(corners.map((p,i)=>`${i?'L':'M'}${p[0]+left} ${p[1]+top}`).join('')+'Z');
 }
 return {path:paths.join(''),exteriorPixels:tail,retainedPixels};
}
export function renderSourceRig(rig:SourceRig,source:string,id:string):string {
 validateSourceRig(rig);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('Unsafe source rig ID');
 if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)&&(/(^[\/\\]|(^|[\/\\])\.{1,2}([\/\\]|$)|:|[%?#\x00-\x1f])/.test(source)||! /\.(png|jpe?g|webp)$/i.test(source)))throw Error('Source rig requires a frozen local raster or an embedded raster');
 const [l,t,r,b]=rig.bounds;
 const order=['leftLeg','rightLeg','leftArm','rightArm','body','head'];
 // A small original-pixel overlap keeps the planted legs connected during shallow torso turns.
 const bodyMask=`<mask id="${id}-body-mask" maskUnits="userSpaceOnUse" x="${l}" y="${t}" width="${r-l}" height="${b-t}"><rect x="${l}" y="${t}" width="${r-l}" height="${b-t}" fill="white"/>${rig.parts.filter(p=>p.name!=='body').map(p=>`<path d="${p.clip}" fill="black" stroke="white" stroke-width="${p.name.endsWith('Leg')?8:1.5}"/>`).join('')}</mask>`;
 const layers=order.map(name=>rig.parts.find(p=>p.name===name)!).map(p=>`<g id="${id}-${p.name}" inkscape:groupmode="layer" inkscape:label="${p.name}" data-source-part="${p.name}" data-pivot="${p.pivot.join(' ')}"><g ${p.name==='body'?`mask="url(#${id}-body-mask)"`:`clip-path="url(#${id}-${p.name}-clip)"`}><g clip-path="url(#${id}-silhouette)"><use href="#${id}-original"/></g></g></g>`);
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${r-l}" height="${b-t}" viewBox="${l} ${t} ${r-l} ${b-t}" data-source-rig="${id}"><metadata>Original raster pixels in individually named editable SVG layers. Not a newly vectorized mascot. Marked socket fills reconstruct hidden overlap only.</metadata><defs><image id="${id}-original" href="${escape(source)}" width="${rig.sourceWidth}" height="${rig.sourceHeight}"/><clipPath id="${id}-silhouette"><path d="${rig.maskPath}"/></clipPath>${bodyMask}${rig.parts.map(p=>`<clipPath id="${id}-${p.name}-clip"><path d="${p.clip}" clip-rule="evenodd"/></clipPath>`).join('')}</defs>${layers.slice(0,2).join('')}<g id="${id}-upper" data-source-upper="true">${rig.sockets?.map((s,i)=>`<ellipse data-reconstructed-socket="${s.part}" id="${id}-socket-${i}" cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${s.color}"/>`).join('')??''}${layers.slice(2).join('')}</g></svg>`;
}
