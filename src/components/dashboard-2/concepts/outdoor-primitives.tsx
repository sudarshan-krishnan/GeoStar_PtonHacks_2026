// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/outdoor-primitives.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";
import {useMemo} from "react";
import {Line} from "@react-three/drei";
import type {PropertyConfig} from "./types";
import type {Point3} from "./types";
import {beam,sample,PartBatches,type Part} from "./twin-primitives";
import {ModelSign,partsBuilder} from "./facility-primitives";

export type OutdoorFeature=NonNullable<PropertyConfig["outdoor"]>["features"][number];
export type OutdoorGeometryProps={config:PropertyConfig;floor:number|null;exterior:boolean;colors:Record<string,string>;onPick:(id:string)=>void};
export const equipmentColor=(colors:Record<string,string>,id:string|undefined,normal="#91aaa8")=>id&&["#c08636","#b45445"].includes(colors[id])?colors[id]:normal;

export function addFence(parts:Part[],center:[number,number],size:[number,number],height=1.6,id?:string,gates:Point3[]=[]){
  const add=partsBuilder(parts),[x,z]=center,[w,d]=size;
  const edges:Point3[][]=[[[x-w/2,.4,z-d/2],[x+w/2,.4,z-d/2]],[[x+w/2,.4,z-d/2],[x+w/2,.4,z+d/2]],[[x+w/2,.4,z+d/2],[x-w/2,.4,z+d/2]],[[x-w/2,.4,z+d/2],[x-w/2,.4,z-d/2]]];
  for(const [a,b]of edges){const n=Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])/2.8);for(let i=0;i<n;i++){
    const t=i/n,u=(i+1)/n,px=a[0]+(b[0]-a[0])*t,pz=a[2]+(b[2]-a[2])*t,qx=a[0]+(b[0]-a[0])*u,qz=a[2]+(b[2]-a[2])*u;
    if(gates.some(g=>Math.hypot((px+qx)/2-g[0],(pz+qz)/2-g[2])<3.5))continue;
    add([px,.4+height/2,pz],[.07,height,.07],"#6e8380",id);
    for(const h of [.3,height-.1])beam(parts,[px,.4+h,pz],[qx,.4+h,qz],.025,"#98aaa2",id);
    beam(parts,[px,.7,pz],[qx,.4+height-.1,qz],.012,"#b2bcb1",id);beam(parts,[px,.4+height-.1,pz],[qx,.7,qz],.012,"#a8b6ac",id);
  }}
}
export function addBench(parts:Part[],x:number,z:number,angle=0){
  const add=partsBuilder(parts),wood="#ac8b61";
  for(let i=0;i<4;i++)add([x,.92,z-.24+i*.16],[2.1,.08,.12],wood,undefined,"box",[0,angle,0]);
  add([x,1.28,z-.38],[2.1,.52,.08],wood,undefined,"box",[0,angle,0]);
  for(const dx of [-.78,.78])add([x+Math.cos(angle)*dx,.64,z-Math.sin(angle)*dx],[.08,.65,.55],"#5c7771");
}
export function addTree(parts:Part[],x:number,z:number,height:number,seed:number,conifer=false){
  const add=partsBuilder(parts);add([x,.4+height*.34,z],[.13,height*.68,.13],"#8b7c61",undefined,"cylinder");
  if(conifer)add([x,.4+height*.65,z],[height*.27,height*.82,height*.27],"#66866d",undefined,"cone");
  else for(let k=0;k<3;k++){const a=k*2.1+seed;add([x+Math.cos(a)*height*.1,.4+height*.72+k*.15,z+Math.sin(a)*height*.1],[height*.28,height*.25,height*.27],["#79996c","#89a378","#698865"][k],undefined,"crown");}
}
export function clearSitePoint(config:PropertyConfig,x:number,z:number,margin=2){
  if(config.outdoor!.features.some(f=>Math.abs(x-f.position[0])<f.size[0]/2+margin&&Math.abs(z-f.position[2])<f.size[2]/2+margin))return false;
  for(const p of config.outdoor!.paths)for(let i=1;i<p.points.length;i++){
    const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1)));
    if(Math.hypot(x-a[0]-dx*t,z-a[2]-dz*t)<p.width/2+margin)return false;
  }return true;
}
export function siteBaseParts(config:PropertyConfig){
  const parts:Part[]=[],add=partsBuilder(parts),site=config.outdoor!,[w,d]=site.ground.size;
  add([0,.05,0],[w,.65,d],"#7e8e73","level-1");add([0,.375,0],[w,.05,d],site.ground.color,"level-1");
  for(const p of site.paths){for(let i=1;i<p.points.length;i++){
    const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),color=p.kind==="service"?"#c9c6b2":"#ddd5bd";
    add([(a[0]+b[0])/2,.445,(a[2]+b[2])/2],[length,.07,p.width],color,undefined,"box",[0,-Math.atan2(dz,dx),0]);
    add([b[0],.45,b[2]],[p.width/2,.04,p.width/2],color,undefined,"cylinder");
    if(p.kind==="service")for(let j=3;j<length;j+=7){const t=j/length;add([a[0]+dx*t,.49,a[2]+dz*t],[.07,.018,.65],"#e3dec7",undefined,"box",[0,-Math.atan2(dz,dx),0]);}
  }}
  const park=site.kind==="community-park";
  for(let i=0;i<(park?360:170);i++){
    const x=(sample(i*13+5)-.5)*(w-5),z=(sample(i*17+8)-.5)*(d-5);
    if(!clearSitePoint(config,x,z,park?2:4))continue;
    if(park&&i%4===0)addTree(parts,x,z,4+sample(i+2)*3,i,i%9===0);
    else {const r=.2+sample(i+23)*.7;add([x,.42,z],[r,.07,r*.7],i%2?"#a9bb8d":"#91a47a",undefined,"shrub");}
  }
  if(!park){addFence(parts,[0,0],[w,d],1.7,undefined,config.nodes.filter(n=>n.kind==="entrance").map(n=>n.position));}
  return parts;
}

export function addUtilityFeature(parts:Part[],f:OutdoorFeature,exterior:boolean,colors:Record<string,string>){
  const add=partsBuilder(parts),[x,y,z]=f.position,[w,h,d]=f.size,id=f.assetId??f.id,c=equipmentColor(colors,f.assetId),steel="#596f75";
  if(["cabinet","inverter","switchgear","fire"].includes(f.kind)){
    add([x,y+h/2,z],[w,h,d],f.kind==="fire"?"#b87d69":c,id);for(let i=0;i<(w>3?4:2);i++){
      const px=x-w*.35+(w*.7)/(w>3?3:1)*i;add([px,y+h*.72,z+d/2+.02],[w/(w>3?6:4),h*.2,.03],"#2d4c5c",id);add([px,y+h*.32,z+d/2+.04],[.035,h*.25,.035],"#d7dfd5",id);
    }for(let i=0;i<6;i++)add([x,y+.18+i*.12,z+d/2+.03],[w*.8,.025,.025],steel,id);
    add([x,y+.02,z],[w+.5,.1,d+.5],"#aab6a9",id);
  }else if(f.kind==="pump"){
    add([x,y+.25,z],[w+.5,.5,d+.5],"#afb9ab",id);add([x,y+.8,z],[w,.9,d],c,id);
    for(const dx of [-.4,.4]){add([x+dx,y+1.5,z],[.06,1.2,.06],"#739fa8",id,"cylinder");add([x+dx,y+1.5,z+.1],[.2,.04,.2],"#b38463",id,"cylinder",[Math.PI/2,0,0]);}
  }else if(f.kind==="transformer"){
    add([x,y+.18,z],[w+1,.35,d+1],"#a5aca0",id);add([x,y+h/2+.2,z],[w*.7,h,d*.8],c,id);
    for(const side of [-1,1])for(let i=0;i<9;i++)add([x+side*w*.42,y+h*.48,z-d*.36+i*d*.09],[.14,h*.75,.055],"#6d8586",id);
    for(const dx of [-.27,0,.27]){add([x+dx*w,y+h+.5,z],[.08,.8,.08],steel,id,"cylinder");for(let k=0;k<4;k++)add([x+dx*w,y+h+.15+k*.16,z],[.19,.065,.19],"#bec5af",id,"cylinder");}
  }else if(f.kind==="battery"){
    add([x,y+h/2,z],[w,h,d],"#cad1c9",id);for(let i=0;i<20;i++)add([x-w/2+i*w/20,y+h/2,z+d/2+.02],[.06,h*.9,.05],"#adbab6",id);
    for(const dx of [-w*.3,w*.3]){add([x+dx,y+h*.65,z+d/2+.08],[1.3,.8,.12],c,id);for(let i=0;i<7;i++)add([x+dx,y+h*.4+i*.1,z+d/2+.15],[1.1,.035,.025],steel,id);}
  }else if(f.kind==="vent"){
    add([x,y+h/2,z],[w,h,d],c,id);for(const dx of [-w*.25,w*.25]){add([x+dx,y+h+.04,z],[w*.2,.05,w*.2],"#3e5960",id,"cylinder");for(let k=0;k<3;k++)add([x+dx,y+h+.08,z],[w*.37,.02,.08],"#8ba6a5",id,"box",[0,k*Math.PI/3,0]);}
  }else if(f.kind==="weather"){
    add([x,y+h/2,z],[.1,h,.1],"#9baca7",id,"cylinder");for(const dx of [-1.1,1.1])beam(parts,[x,y+h*.9,z],[x+dx,y+h*.9,z],.035,steel,id);
    for(let k=0;k<3;k++){const a=k*2.1;add([x+Math.cos(a)*.55,y+h+.18,z+Math.sin(a)*.55],[.13,.12,.13],steel,id,"cylinder");beam(parts,[x,y+h+.15,z],[x+Math.cos(a)*.55,y+h+.15,z+Math.sin(a)*.55],.018,steel,id);}
    add([x-.7,y+h*.6,z],[1,.05,.7],"#557e8b",id,"box",[.3,0,0]);
  }else if(f.kind==="building"){
    add([x,y+.08,z],[w+.7,.16,d+.7],"#b1bbaa",id);add([x,y+.2,z],[w,.08,d],"#d5d3c3",id);
    add([x,y+h/2,z-d/2],[w,h,.18],"#b8c6be",id);for(const side of [-1,1])add([x+side*w/2,y+h/2,z],[.16,h,d],"#a7b8b1",id);
    if(exterior){add([x,y+h/2,z+d/2],[w,h,.16],"#b9c7be",id);add([x,y+h+.08,z],[w+1,.18,d+1],"#6f8c86",id);for(const dx of [-w*.3,w*.3])add([x+dx,y+h*.6,z+d/2+.1],[w*.2,h*.35,.06],"#62828b",id);add([x,y+1.2,z+d/2+.11],[1.5,2.4,.1],"#5e7779",id);}
    else{for(let i=0;i<3;i++){const px=x-w*.28+i*w*.28;add([px,y+.8,z],[2.5,.12,1.2],"#a99371",id);add([px,y+1.25,z-.2],[1,.65,.06],"#365f71",id);add([px,y+.45,z+1.2],[.6,.12,.65],steel,id);add([px,y+.8,z+1.4],[.6,.65,.1],steel,id);}for(let i=0;i<4;i++)add([x-w/2+.8,y+.4+i*.55,z-d/2+.6],[1.2,.1,d*.6],"#97a99a",id);}
  }else if(f.kind==="substation"){
    add([x,y+.03,z],[w,.08,d],"#c4c5b1",id);addFence(parts,[x,z],[w,d],2,id);
    for(const dx of [-w*.3,w*.3]){for(const dz of [-d*.28,d*.28])add([x+dx,y+2.6,z+dz],[.17,5.2,.17],steel,id);beam(parts,[x+dx,y+5.2,z-d*.28],[x+dx,y+5.2,z+d*.28],.08,steel,id);for(let i=0;i<3;i++){const pz=z+(i-1)*d*.18;add([x+dx,y+4.4,pz],[.08,1.2,.08],steel,id,"cylinder");for(let k=0;k<5;k++)add([x+dx,y+4+k*.17,pz],[.24,.06,.24],"#c4ccbe",id,"cylinder");}}
  }
}

export function InfrastructureLines({config,colors}:{config:PropertyConfig;colors:Record<string,string>}){
  return <>{config.infrastructureLines.map(l=><Line key={l.id} points={l.points} color={equipmentColor(colors,l.systemId,l.kind==="water"?"#7ba9b0":"#a8a07d")} lineWidth={1.4} dashed dashSize={.5} gapSize={.35}/>)}</>;
}
export function SiteUtilities({config,exterior,colors,onPick}:{config:PropertyConfig;exterior:boolean;colors:Record<string,string>;onPick:(id:string)=>void}){
  const parts=useMemo(()=>{const result:Part[]=[];for(const f of config.outdoor!.features)addUtilityFeature(result,f,exterior,colors);return result;},[config,exterior,colors]);
  return <><PartBatches parts={parts} onPick={onPick}/>{config.outdoor!.features.filter(f=>f.kind==="building").map(f=><ModelSign key={f.id} text={config.nodes.find(n=>n.id===f.id)?.name??f.id} position={[f.position[0],.58,f.position[2]+f.size[2]/2+1]} width={Math.min(17,f.size[0])} floor/>)}</>;
}
