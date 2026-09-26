// SPDX-License-Identifier: Apache-2.0
import type { Asset, Scene, ProductDetails } from '../contracts.ts';
export type RigKind='tuotuo'|'xinbi'|'stickman'|'custom';
export type RigPart='head'|'body'|'upperArm'|'forearm'|'hand'|'thigh'|'shin'|'foot';
export interface RigVector {color:string;head:string;body:string}
export interface CharacterRig {kind:RigKind;parts?:Record<RigPart,string>;vector?:RigVector}
export interface Performance {
 version:'performance-v1';fact:string;sourceField:'product.primaryProblem'|'product.features'|'product.valueProposition';
 objective:string;obstacle:string;outcome:string;roles:Array<{actor:number;role:string}>;
 props:Array<{id:string;kind:'document'|'image'|'audio'|'timeline'|'archive'|'link';textIndices:number[];x:number;y:number}>;
 cues:Array<{startFrame:number;endFrame:number;actor:number;verb:'search'|'walk'|'gather'|'handoff'|'place'|'connect'|'point'|'celebrate';propId:string;fromX:number;toX:number;receiver?:number;destination?:{x:number;y:number};meaning:string}>;
}
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const num=(n:number)=>String(Math.round(n*100000)/100000);
export const RIG_PARTS:RigPart[]=['head','body','upperArm','forearm','hand','thigh','shin','foot'];

function vectorFragment(value:string):string {
 if(typeof value!=='string'||value.length>24000)throw Error('Invalid vector fragment');
 const tags=value.match(/<[^>]+>/g)??[];
 if(!tags.length||value.replace(/<[^>]+>/g,'').trim())throw Error('Vector fragments contain shapes only');
 const open:string[]=[];
 for(const tag of tags){
  if(!/^<\/?(?:path|rect|circle|ellipse|g|line|polyline|polygon)(?:\s|\/?>)/.test(tag))throw Error('Unsupported vector shape');
  const name=tag.match(/^<\/?([a-z]+)/)![1]!;
  if(tag.startsWith('</')){if(open.pop()!==name)throw Error('Unbalanced vector geometry');}
  else if(!tag.endsWith('/>'))open.push(name);
  const tail=tag.replace(/^<\/?[a-z]+/,'').replace(/\/?\s*>$/,'');
  if(tail.replace(/\s+[a-z-]+="[^"]*"/g,'').trim())throw Error('Invalid vector attributes');
  for(const [,key,val] of tail.matchAll(/\s+([a-z-]+)="([^"]*)"/g)){
   if(!['d','x','y','cx','cy','r','rx','ry','width','height','fill','stroke','stroke-width','transform','points'].includes(key!))throw Error('Unsafe vector attribute');
   if(['fill','stroke'].includes(key!)?!/^(#[0-9a-f]{3,8}|none|white|black)$/i.test(val!):key==='d'?!/^[MmLlHhVvCcSsQqTtAaZz0-9., +\-]*$/.test(val!):key==='transform'?!/^(translate|rotate|scale)\([-+0-9., ]+\)$/.test(val!):!/^[-+0-9., ]+$/.test(val!))throw Error('Unsafe vector attribute value');
  }
 }
 if(open.length)throw Error('Unbalanced vector geometry');
 return value;
}

export function validatePerformance(scene:Scene,assets:readonly Asset[],frames:number,product?:ProductDetails):void {
 const p=scene.character?.performance;if(!p)return;
 if(p.version!=='performance-v1'||![p.fact,p.objective,p.obstacle,p.outcome].every(s=>typeof s==='string'&&s.trim()))throw Error('Performance requires a product fact, goal, obstacle and observable outcome');
 if(!['product.primaryProblem','product.features','product.valueProposition'].includes(p.sourceField))throw Error('Performance needs a known product fact field');
 if(product){
  const facts=p.sourceField==='product.features'?product.features.flatMap(f=>[f.name,f.benefit]):[product[p.sourceField==='product.primaryProblem'?'primaryProblem':'valueProposition']];
  if(!facts.includes(p.fact))throw Error('Performance fact must match the cited product evidence exactly; put dramatic adaptation in objective and meaning');
 }
 if(!scene.backgroundAssetId||!scene.assetRefs.includes(scene.backgroundAssetId)||!assets.some(a=>a.id===scene.backgroundAssetId&&['image','screenshot'].includes(a.type)&&a.license!=='unknown'))throw Error('Performance requires an authorized real scene background');
 const actors=scene.character!.actors;
 if(p.roles.length!==actors.length||new Set(p.roles.map(r=>r.actor)).size!==actors.length||p.roles.some(r=>!actors[r.actor]||!r.role.trim()))throw Error('Performance requires a distinct dramatic role for every actor');
 for(const actor of actors){
  const rig=assets.find(a=>a.id===actor.assetId)?.characterRig;
  if(!rig||!['tuotuo','xinbi','stickman','custom'].includes(rig.kind))throw Error('Performance actor requires a prepared articulated rig');
  if(rig.kind==='tuotuo'||rig.kind==='xinbi'){
   if(!rig.vector||!/^#[0-9a-f]{6}$/i.test(rig.vector.color))throw Error('Company performance rig requires its reviewed private vector definition');
   vectorFragment(rig.vector.head);vectorFragment(rig.vector.body);
  }
  if(rig.kind==='custom'&&RIG_PARTS.some(k=>!rig.parts?.[k]||!assets.some(a=>a.id===rig.parts![k]&&a.type==='image'&&a.license!=='unknown'&&scene.assetRefs.includes(a.id))))throw Error('Custom performance requires all reviewed transparent articulated parts; a single uploaded image is not a rig');
 }
 if(!p.props.length||p.props.length>5||new Set(p.props.map(q=>q.id)).size!==p.props.length)throw Error('Performance requires one to five distinct story objects');
 const used=new Set<number>();
 for(const prop of p.props){
  if(!ID.test(prop.id)||!['document','image','audio','timeline','archive','link'].includes(prop.kind)||![prop.x,prop.y].every(Number.isFinite)||prop.x<0||prop.x>1450||prop.y<0||prop.y>430)throw Error('Performance prop geometry is invalid');
  if(!prop.textIndices.length||prop.textIndices.some(i=>!Number.isInteger(i)||i<1||i>=scene.onScreenText.length))throw Error('Performance copy must reference reviewed screen lines');
  prop.textIndices.forEach(i=>used.add(i));
 }
 if(used.size!==scene.onScreenText.length-1)throw Error('Performance must present all reviewed bilingual screen lines');
 const ends=new Map<number,number>(),positions=new Map<number,number>(),propEnds=new Map<string,number>();
 if(!p.cues.length)throw Error('Performance requires staged actions');
 for(const cue of p.cues){
  if(!actors[cue.actor]||!p.props.some(q=>q.id===cue.propId))throw Error('Performance action target is missing');
  if(!['search','walk','gather','handoff','place','connect','point','celebrate'].includes(cue.verb)||!cue.meaning?.trim())throw Error('Performance cue requires a meaningful action');
  if(![cue.startFrame,cue.endFrame].every(Number.isSafeInteger)||cue.startFrame<0||cue.endFrame-cue.startFrame<12||cue.endFrame>frames||cue.startFrame<(ends.get(cue.actor)??0))throw Error('Performance cue timing overlaps or exceeds the scene');
  if(![cue.fromX,cue.toX].every(x=>Number.isFinite(x)&&x>=0&&x<=1400))throw Error('Performance actor leaves the safe stage');
  if(positions.has(cue.actor)&&positions.get(cue.actor)!==cue.fromX)throw Error('Performance actor position jumps between cues');
  if(cue.verb==='handoff'&&(!actors[cue.receiver??-1]||cue.receiver===cue.actor))throw Error('Performance handoff requires another real actor');
  if(cue.destination&&(!['place','connect'].includes(cue.verb)||![cue.destination.x,cue.destination.y].every(Number.isFinite)||cue.destination.x<0||cue.destination.x>1450||cue.destination.y<0||cue.destination.y>430))throw Error('Performance placement destination is invalid');
  ends.set(cue.actor,cue.endFrame);
  positions.set(cue.actor,cue.toX);
 }
 for(const cue of [...p.cues].sort((a,b)=>a.startFrame-b.startFrame)){
  if(cue.startFrame<(propEnds.get(cue.propId)??0))throw Error('Performance prop has competing simultaneous actions');
  propEnds.set(cue.propId,cue.endFrame);
 }
 if(ends.size!==actors.length)throw Error('Every performance actor requires a authored action');
}

/** Code-native vector rig. It has no canvas rectangle or embedded raster background. */
export function renderPuppetSvg(kind:RigKind,custom?:Record<RigPart,string>,vector?:RigVector):string {
 if(kind==='custom'&&(!custom||RIG_PARTS.some(k=>!custom[k])))throw Error('Custom rig requires prepared parts');
 const star=kind==='xinbi',stick=kind==='stickman';
 const fill=stick?'none':vector?.color??'#FFFFFF';
 const image=(part:RigPart,x:number,y:number,w:number,h:number)=>`<image href="${esc(custom![part])}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
 const body=kind==='custom'?image('body',68,185,105,118):stick?'<path d="M120 180L120 296M77 199H164M96 287H147"/>':vectorFragment(vector?.body??'');
 const head=kind==='custom'?image('head',33,12,176,175):stick?'<ellipse cx="120" cy="126" rx="48" ry="51"/><path d="M103 120v4m33-4v4M109 144q12 10 23-1"/>':vectorFragment(vector?.head??'');
 const limb=(d:string,width:number)=>stick?`<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="8"/>`:`<path d="${d}" fill="none" stroke="#10151A" stroke-width="${width+6}"/><path d="${d}" fill="none" stroke="${fill}" stroke-width="${width}"/>`;
 const arm=(side:string,x:number)=>`<g transform="translate(${x} 199)"><g data-joint="${side}-shoulder">${kind==='custom'?image('upperArm',-13,-5,26,64):limb('M0 0L0 55',27)}<g transform="translate(0 55)"><g data-joint="${side}-elbow">${kind==='custom'?image('forearm',-12,-5,24,58):limb('M0 0L0 45',25)}<g data-grip="${side}">${kind==='custom'?image('hand',-18,33,36,32):`<ellipse cx="0" cy="47" rx="${stick?7:16}" ry="${stick?7:18}" fill="${stick?'none':star?'#FFFFFF':fill}" stroke-width="4"/>`}</g></g></g></g></g>`;
 const leg=(side:string,x:number)=>`<g transform="translate(${x} 287)"><g data-joint="${side}-hip">${kind==='custom'?image('thigh',-16,-2,32,66):limb('M0 0L0 58',31)}<g transform="translate(0 58)"><g data-joint="${side}-knee">${kind==='custom'?image('shin',-14,-3,28,65):limb('M0 0L0 53',29)}${kind==='custom'?image('foot',-23,41,55,29):`<path d="M-15 48Q-37 67-18 68H24Q37 65 24 52L12 44" fill="${star?'#FFFFFF':fill}" stroke-width="4"/>`}</g></g></g></g>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="420" viewBox="-12 -8 270 440" data-rig-kind="${kind}" fill="${fill}" stroke="${stick?'#FFFFFF':'#10151A'}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${leg('left',96)}${leg('right',147)}<g data-joint="torso">${body}${arm('left',77)}${arm('right',164)}<g data-joint="head">${head}</g></g></svg>`;
}

function propIcon(kind:string):string {
 const paths:Record<string,string>={document:'M28 12H92L120 40V125H28ZM91 12V43H120M43 61H103M43 78H96M43 96H103',image:'M15 23H134V114H15ZM22 102L62 64L91 91L109 72L130 98M101 47a8 8 0 1 0 1 0',audio:'M24 54V90M43 31V110M64 14V125M85 43V103M106 28V113M127 58V84',timeline:'M9 30H139M9 69H139M9 108H139M35 15V126M70 39H117V59H70ZM46 78H100V98H46',archive:'M17 35H134V120H17ZM8 15H143V37H8ZM60 57H96V75H60',link:'M60 50L85 25Q110 8 130 29Q148 48 127 69L102 94M92 85L68 110Q45 132 24 111Q3 90 25 68L47 47M53 92L99 47'};
 return `<svg viewBox="0 0 150 140" aria-hidden="true"><path d="${paths[kind]}" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
export function renderPerformance(scene:Scene,assets:ReadonlyMap<string,Asset>):string {
 const p=scene.character!.performance!;
 const pair=(i:number)=>`<div class="performance-copy-pair" data-bilingual-pair="${i}"><p lang="zh-CN">${esc(scene.onScreenText[i]!)}</p>${scene.onScreenText[i]===scene.bilingual!.onScreenText[i]?'':`<p lang="en">${esc(scene.bilingual!.onScreenText[i]!)}</p>`}</div>`;
 const actors=scene.character!.actors.map((actor,i)=>{
  const a=assets.get(actor.assetId)!,custom=a.characterRig!.parts?Object.fromEntries(RIG_PARTS.map(k=>[k,assets.get(a.characterRig!.parts![k])!.path])) as Record<RigPart,string>:undefined;
  return `<div class="performance-actor" data-performance-actor="${i}" data-asset-id="${esc(a.id)}" data-source="${esc(a.path)}" style="left:${p.cues.find(c=>c.actor===i)?.fromX??(i?1260:90)}px">${renderPuppetSvg(a.characterRig!.kind,custom,a.characterRig!.vector)}</div>`;
 }).join('');
 const props=p.props.map(prop=>`<div class="performance-prop" data-performance-prop="${prop.id}" style="left:${prop.x}px;top:${prop.y}px">${propIcon(prop.kind)}</div>`).join('');
 const text=p.props.map((prop,i)=>`<div class="performance-kinetic-copy" data-performance-copy="${prop.id}" style="opacity:${i===0?1:0}">${prop.textIndices.map(pair).join('')}</div>`).join('');
 return `<div class="performance-heading">${pair(0)}</div><div class="performance-stage" data-performance-stage data-product-fact="${esc(p.fact)}">${actors}${props}${text}</div>`;
}

type Cue=Performance['cues'][number];
const JOINTS=['left-shoulder','right-shoulder','left-elbow','right-elbow','left-hip','right-hip','left-knee','right-knee','head'] as const;
type Pose={x:number;joints:Record<string,number>};
const clamp=(v:number)=>Math.min(1,Math.max(0,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const neutral=(x:number):Pose=>({x,joints:Object.fromEntries(JOINTS.map(j=>[j,0]))});
function heldBefore(p:Performance,frame:number){
 const held=new Map<string,{actor:number;side:'left'|'right'}>();
 for(const c of [...p.cues].sort((a,b)=>a.endFrame-b.endFrame)){
  if(c.endFrame>frame)continue;
  if(c.verb==='gather')held.set(c.propId,{actor:c.actor,side:'right'});
  if(c.verb==='handoff')held.set(c.propId,{actor:c.receiver!,side:'left'});
  if(c.verb==='place'||c.verb==='connect')held.delete(c.propId);
 }
 return held;
}
function cuePose(c:Cue,t:number,initial:Pose,held:ReturnType<typeof heldBefore>):Pose {
 const r=neutral(mix(c.fromX,c.toX,smooth(t/.65))),j=r.joints,settle=smooth(t/.2);
 for(const key of JOINTS)j[key]=mix(initial.joints[key]!,0,settle);
 const holding=[...held.values()].filter(h=>h.actor===c.actor);
 const moving=c.fromX!==c.toX&&t<.65;
 if(moving){
  const stride=Math.sin(t/.65*Math.PI*2*3)*Math.sin(Math.PI*t/.65)*18;
  j['left-hip']=stride;j['right-hip']=-stride;
  j['left-knee']=Math.max(0,stride)*.65;j['right-knee']=Math.max(0,-stride)*.65;
  j['left-shoulder']=-stride*.7;j['right-shoulder']=stride*.7;
 }
 for(const h of holding){j[`${h.side}-shoulder`]=h.side==='right'?-78:78;j[`${h.side}-elbow`]=h.side==='right'?-9:9;}
 if(c.verb==='search'){
  const envelope=Math.sin(Math.PI*t);j.head=Math.sin(t*Math.PI*2)*10;
  j['left-shoulder']=55*envelope;j['left-elbow']=-78*envelope;
  j['right-shoulder']=-35*envelope;j['right-elbow']=-22*envelope;
 }
 if(['gather','handoff','connect','point'].includes(c.verb)){
  const reach=c.verb==='handoff'?1:smooth((t-.45)/.3);
  j['right-shoulder']=mix(j['right-shoulder']!,-78,reach);j['right-elbow']=mix(j['right-elbow']!,-9,reach);
  j.head=mix(j.head!,c.verb==='handoff'?5:-3,reach);
 }
 if(c.verb==='place')for(const h of holding){const release=smooth((t-.65)/.35);j[`${h.side}-shoulder`]*=1-release;j[`${h.side}-elbow`]*=1-release;}
 if(c.verb==='celebrate'){
  const e=Math.sin(Math.PI*clamp(t/.9));j['left-shoulder']=125*e;j['right-shoulder']=-125*e;
  j['left-elbow']=-20*e;j['right-elbow']=20*e;j.head=-5*e;
 }
 return r;
}
function actorPose(p:Performance,actor:number,frame:number):Pose {
 let pose=neutral(p.cues.find(c=>c.actor===actor)!.fromX);
 for(const c of p.cues.filter(c=>c.actor===actor)){
  if(frame<c.startFrame)break;
  pose=cuePose(c,clamp((frame-c.startFrame)/(c.endFrame-c.startFrame)),pose,heldBefore(p,c.startFrame));
  if(frame<c.endFrame)break;
 }
 for(const h of heldBefore(p,frame).values())if(h.actor===actor){
  const placing=p.cues.some(c=>c.actor===actor&&c.verb==='place'&&frame>=c.startFrame&&frame<c.endFrame);
  if(!placing){pose.joints[`${h.side}-shoulder`]=h.side==='right'?-78:78;pose.joints[`${h.side}-elbow`]=h.side==='right'?-9:9;}
 }
 for(const c of p.cues.filter(c=>c.verb==='handoff'&&c.receiver===actor&&frame>=c.startFrame&&frame<c.endFrame)){
  const q=smooth((frame-c.startFrame)/(c.endFrame-c.startFrame)/.6);
  pose.joints['left-shoulder']=mix(pose.joints['left-shoulder']!,78,q);pose.joints['left-elbow']=mix(pose.joints['left-elbow']!,9,q);
 }
 return pose;
}
/** Exact forward kinematics in the 250x430 actor viewport; matches SVG meet transform. */
export function performanceGrip(pose:Pose,side:'left'|'right'):{x:number;y:number}{
 const a=pose.joints[`${side}-shoulder`]!*Math.PI/180,b=a+pose.joints[`${side}-elbow`]!*Math.PI/180;
 const x=(side==='left'?77:164)-55*Math.sin(a)-47*Math.sin(b),y=199+55*Math.cos(a)+47*Math.cos(b),scale=250/270;
 return {x:pose.x+(x+12)*scale,y:115+(430-440*scale)/2+(y+8)*scale};
}
export function performanceFrame(p:Performance,frame:number){
 const actors=[...p.roles].sort((a,b)=>a.actor-b.actor).map(({actor})=>actorPose(p,actor,frame));
 const props=p.props.map(prop=>{
  let free={x:prop.x+75,y:prop.y+70,scale:1},owner:{actor:number;side:'left'|'right'}|undefined;
  const grip=(h:NonNullable<typeof owner>)=>({...performanceGrip(actors[h.actor]!,h.side),scale:.55});
  for(const c of p.cues.filter(c=>c.propId===prop.id).sort((a,b)=>a.startFrame-b.startFrame)){
   if(frame<c.startFrame)break;
   const t=clamp((frame-c.startFrame)/(c.endFrame-c.startFrame));
   const start=owner?grip(owner):free,dest={x:(c.destination?.x??prop.x)+75,y:(c.destination?.y??prop.y)+70,scale:1};
   if(frame>=c.endFrame){
    if(c.verb==='gather')owner={actor:c.actor,side:'right'};
    if(c.verb==='handoff')owner={actor:c.receiver!,side:'left'};
    if(c.verb==='place'||c.verb==='connect'){owner=undefined;free=dest;}
    continue;
   }
   let end=start,q=0;
   if(c.verb==='search')return {...free,id:prop.id,x:free.x+Math.sin(t*Math.PI*2)*12,owner:null};
   if(c.verb==='gather'){end=grip({actor:c.actor,side:'right'});q=smooth((t-.55)/.45);}
   if(c.verb==='handoff'){end=grip({actor:c.receiver!,side:'left'});q=smooth((t-.55)/.45);}
   if(c.verb==='place'||c.verb==='connect'){end=dest;q=smooth((t-.65)/.35);}
   return {id:prop.id,x:mix(start.x,end.x,q),y:mix(start.y,end.y,q),scale:mix(start.scale,end.scale,q),owner:owner??null};
  }
  return {id:prop.id,...(owner?grip(owner):free),owner:owner??null};
 });
 return {actors,props};
}
/** Sample finite choreography into ordinary GSAP curves. No callbacks, random or pose atlas swaps. */
export function compilePerformance(p:Performance,sceneId:string,startFrame:number,fps:number,timeline='tl'):string {
 const frames=Math.max(...p.cues.map(c=>c.endFrame)),step=Math.max(1,Math.floor(fps/15));
 const states=[];for(let frame=0;frame<=frames;frame+=step)states.push({frame,...performanceFrame(p,frame)});
 if(states.at(-1)!.frame!==frames)states.push({frame:frames,...performanceFrame(p,frames)});
 const scope=JSON.stringify(`#${sceneId}`),initial=[...p.roles].sort((a,b)=>a.actor-b.actor).map(({actor})=>p.cues.find(c=>c.actor===actor)!.fromX);
 const out=[`{const scope=${scope},states=${JSON.stringify(states)},initial=${JSON.stringify(initial)},jointNames=${JSON.stringify(JOINTS)};`,
 `${timeline}.set(scope+' [data-joint]',{svgOrigin:'0 0',rotation:0},${num(startFrame/fps)});`,
 `${timeline}.set(scope+' [data-joint="head"]',{svgOrigin:'120 175'},${num(startFrame/fps)});`,
 `states.forEach((state,i)=>{const duration=i?(state.frame-states[i-1].frame)/${fps}:0,time=${num(startFrame/fps)}+(i?states[i-1].frame:0)/${fps};`,
 `state.actors.forEach((actor,a)=>{const sel=scope+' [data-performance-actor="'+a+'"]';${timeline}.to(sel,{x:actor.x-initial[a],duration,ease:'none'},time);jointNames.forEach(j=>${timeline}.to(sel+' [data-joint="'+j+'"]',{rotation:actor.joints[j],duration,ease:'none'},time));});`,
 `state.props.forEach(prop=>{const homes=${JSON.stringify(Object.fromEntries(p.props.map(o=>[o.id,{x:o.x+75,y:o.y+70}])))};${timeline}.to(scope+' [data-performance-prop="'+prop.id+'"]',{x:prop.x-homes[prop.id].x,y:prop.y-homes[prop.id].y,scale:prop.scale,duration,ease:'none'},time);});});}`];
 // One global explanation track avoids competing actors cross-fading text over each other.
 let active=p.props[0]!.id;
 for(const cue of [...p.cues].sort((a,b)=>a.startFrame-b.startFrame)){
  const time=(startFrame+cue.startFrame)/fps;
  for(const prop of p.props)out.push(`${timeline}.fromTo(${JSON.stringify(`#${sceneId} [data-performance-copy="${prop.id}"]`)},{opacity:${active===prop.id?1:0}},{opacity:${cue.propId===prop.id?1:0},duration:0,immediateRender:false},${num(time)});`);
  active=cue.propId;
  if(cue.startFrame>0){
   out.push(`${timeline}.fromTo(${JSON.stringify(`#${sceneId} [data-performance-copy="${cue.propId}"]`)},{y:0},{y:14,duration:0,immediateRender:false},${num(time)});`);
   out.push(`${timeline}.fromTo(${JSON.stringify(`#${sceneId} [data-performance-copy="${cue.propId}"]`)},{y:14},{y:0,duration:.32,ease:'power2.out',immediateRender:false},${num(time+.001)});`);
  }
 }
 return out.join('\n');
}


export const performanceCss=`
.sketch-v1 .performance-scene .scene-content:before{content:none!important;display:none!important}
.sketch-v1 .performance-scene .scene-background{opacity:1;filter:brightness(.52) saturate(.82)}
.sketch-v1 .performance-scene .scene-content{display:block;padding:64px 120px 160px;background:none}
.sketch-v1 .performance-scene .brand-header{height:64px}
.sketch-v1 .performance-scene .brand-header .logo{filter:none}
.performance-heading{position:absolute;left:120px;right:120px;top:150px;color:white;text-shadow:0 2px 5px #000}
.performance-heading .performance-copy-pair p{margin:0;font-size:58px;font-weight:700;line-height:1.35}
.performance-heading .performance-copy-pair p[lang=en]{font-size:28px;font-weight:400;margin-top:9px}
.performance-stage{position:absolute;left:120px;right:120px;top:320px;height:560px;background:none;border:0}
.performance-actor{position:absolute;top:115px;width:250px;height:430px;z-index:4;transform-origin:center bottom}
.performance-actor svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 4px 4px #0005)}
.performance-actor svg[data-rig-kind=stickman]{stroke:#FFF;filter:drop-shadow(0 2px 3px #000)}
.performance-prop{position:absolute;width:150px;height:140px;z-index:5;color:#F7FCFF;transform-origin:50% 50%;filter:drop-shadow(0 3px 5px #000)}
.performance-prop svg{width:100%;height:100%;overflow:visible}
.performance-kinetic-copy{position:absolute;left:380px;right:50px;top:0;color:white;text-shadow:0 2px 5px #000;pointer-events:none}
.performance-copy-pair p{margin:0;font-size:34px;line-height:1.4;font-weight:600}
.performance-copy-pair p[lang=en]{font-size:23px;font-weight:400;margin-top:8px}
.performance-copy-pair+.performance-copy-pair{margin-top:10px}
`;
