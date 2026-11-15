// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/princeton-geometry.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import type { PropertyConfig } from "./types";
import { PartBatches, beam, type Part } from "./twin-primitives";
import { addEquipment, addStair, ModelSign, partsBuilder } from "./facility-primitives";

function princetonParts(c:PropertyConfig,floor:number|null,exterior:boolean,colors:Record<string,string>){
  const parts:Part[]=[],add=partsBuilder(parts),stone="#aaa997",trim="#ddd5bd",metal="#52666b",wood="#ac906c";
  add([-3,-.25,2],[66,.5,58],"#c2cbb9");
  // Washington Road, the entrance court and the Scudder Plaza bridge approach.
  add([-35,-.08,1],[6,.16,53],"#8a9691");add([-29,-.02,0],[6,.18,11],"#d5d0be");add([10,-.02,27],[31,.18,9],"#d3cbb8");
  for(const z of [-20,-12,12,20]){add([-30,.3,z],[2.6,.5,2.6],"#a9b6a1");add([-30,1.8,z],[.1,3,.1],"#7d7767","", "cylinder");add([-30,3.5,z],[1.6,1.7,1.6],"#71876a",undefined,"crown");}
  for(const x of [-26,-18,-9,1,23])for(const z of [-24,29]){add([x,1.5,z],[.18,3,.18],"#877861",undefined,"cylinder");for(let k=0;k<3;k++)add([x+(k-1)*.65,3.5+k*.25,z],[2,1.9,1.8],["#7c946e","#829767","#91a17a"][k],undefined,"crown");}
  for(const x of [-20,-12,0,23]){add([x,.1,26],[4,.2,1.2],"#b9b29a");add([x,.52,26],[3.8,.2,.6],wood);for(const dx of [-1.3,1.3])add([x+dx,.3,26],[.1,.5,.4],metal);}
  const visible=c.levels.filter(l=>floor===null||l.id===floor);
  for(const level of visible){
    const y=level.y,f=level.id,id=`level-${f}`;
    for(const slab of c.spatial!.slabs.filter(s=>s.floor===f)){
      const [x,z]=slab.center,[w,d]=slab.size;add([x,y-.13,z],[w,.26,d],f===4?"#bbc6c2":"#d7d6c9",id);add([x,y-.25,z+d/2],[w,.18,.15],"#9ba69e",id);
    }
    // The historic western elevation has regular stone mullions and deep window recesses.
    if(f<=3){
      for(const x of [-26.1,-8.1,-1.9]){
        const west=x<-20;
        if(!exterior&&!west)continue;
        for(let z=-16;z<=16;z+=2.65){
          const h=exterior?3.9:2.7;add([x,y+h/2,z],[.35,h,.32],stone,id);
          add([x,y+1.7,z+1.3],[.13,2.3,1.85],"#718d92",id);
          add([x-.1,y+1.7,z+1.3],[.18,2.5,.09],trim,id);add([x-.1,y+1.6,z+1.3],[.18,.1,1.92],trim,id);
          add([x,y+3.3,z+1.3],[.48,.18,2.4],trim,id);
        }
        add([x,y+.18,0],[.5,.35,35],stone,id);add([x,y+4.45,0],[.52,.22,35],trim,id);
      }
      for(const z of [-19.5,19.5]){add([-20,y+1.9,z],[14,3.8,.22],stone,id);for(let x=-26;x<-13;x+=2.1){add([x,y+2,z+.13],[1.25,2,.1],"#7c9695",id);add([x,y+.85,z+.15],[1.6,.12,.22],trim,id);}}
      // Simpson's contemporary eastern bar: horizontal fins, slender mullions, warm soffits.
      for(let z=-5;z<=21;z+=2.5){add([24.7,y+1.9,z],[.18,3.7,.12],metal,id);add([24.65,y+2,z+1.2],[.05,3.2,2.2],"#90aaa8",id);}
      for(const yy of [.4,3.9,4.3])add([24.9,y+yy,8],[.7,.12,28],yy===3.9?wood:metal,id);
      add([21,y+4.35,8],[7.6,.2,28.4],"#b5b9aa",id);
      for(const x of [-24,22])addStair(parts,x,x<0?14:19,y,4.8,x<0?`jrr-stairs-${f}`:`las-stairs-${f}`);
      // Lift core and split doors, visibly aligned between floors.
      add([-5,y+2,-3],[2.2,4,2.3],"#b9c6c2","JRR-LIFT-1");for(const dx of [-.43,.43])add([-5+dx,y+1.4,-1.82],[.81,2.8,.08],colors["JRR-LIFT-1"]??metal,"JRR-LIFT-1");
    }
    for(const room of c.spatial!.rooms.filter(r=>r.floor===f)){
      const [x,z]=room.center,[w,d]=room.size;
      add([x,y+.025,z],[w,.045,d],room.kind==="library"?"#bdab8b":room.kind==="office"?"#d8d4c4":room.kind==="atrium"?"#d9ddcd":"#d7cab0",room.id);
      if(!["atrium","forum","pavilion"].includes(room.kind)){
        add([x+w/2,y+.72,z],[.09,1.4,d],"#deded0",room.id);add([x,y+.72,z-d/2],[w,1.4,.09],"#e3e0d1",room.id);
        add([x-w/2,y+.75,z+d*.3],[.09,1.45,d*.35],"#d2d8d0",room.id);
      }
      if(room.kind==="library"){
        for(const zz of [-6,-3,3,6]){add([x+1.5,y+1.1,z+zz],[.7,2.1,2],wood,room.id);for(let k=0;k<6;k++)for(let b=0;b<7;b++)add([x+1.05,y+.2+k*.31,z+zz-.8+b*.23],[.15,.23,.14],["#637d79","#b09269","#a66854","#7d8b9c"][b%4],room.id);}
      }
      const office=room.kind==="office",rows=office||d<3?1:room.kind==="library"?2:3;
      for(let row=0;row<rows;row++)for(let col=0;col<(w>7?3:1);col++){
        const tx=x+(col-((w>7?3:1)-1)/2)*2.55,tz=z+(row-(rows-1)/2)*(d>8?3:1.8);
        add([tx,y+.78,tz],[office?1.5:1.8,.1,.85],wood,room.id);for(const dx of [-.62,.62])add([tx+dx,y+.38,tz],[.06,.75,.55],metal,room.id);
        for(const dz of [-.72,.72]){add([tx,y+.43,tz+dz],[.55,.09,.5],"#7c9591",room.id);add([tx,y+.7,tz+dz*1.18],[.55,.5,.06],"#66827e",room.id);}
        add([tx,y+.89,tz],[.46,.035,.3],"#6d858b",room.id);add([tx,y+1.06,tz-.12],[.45,.32,.025],"#3f616f",room.id);
      }
      if(room.kind==="pavilion"){
        add([x,y+3.3,z],[w+.3,.2,d+.3],"#758c8a",room.id);
        for(const dx of [-w/2,w/2])for(const dz of [-d/2,d/2])add([x+dx,y+1.6,z+dz],[.13,3.2,.13],metal,room.id);
      }
    }
  }
  // International atrium's double-height glass ribs and suspended meeting-room bridge.
  if(floor===null||floor===2||floor===3){
    const y=c.levels[1].y;
    for(let z=7;z<=21;z+=2){add([3.4,y+4.2,z],[.11,8.4,.11],metal,"las-171");beam(parts,[3.4,y+8.4,z],[16.2,y+9.2,z],.06,"#758a88","las-171");}
    for(const z of [7,21])add([9.8,y+8.8,z],[13,.12,.13],metal,"las-171");
    add([17,y+1,12],[1.4,2,4],wood,"las-cafe-water");add([16.8,y+2.05,12],[2,.16,4.2],"#e5dfce","las-cafe-water");
  }
  if(exterior){
    // Roofs keep the courts open; the rooftop pavilions remain identifiable.
    for(const s of c.spatial!.slabs.filter(s=>s.floor===4)){const [x,z]=s.center;add([x,14.6,z],[s.size[0]+.3,.28,s.size[1]+.3],"#9daba5");}
    add([-28,6.8,0],[.8,3.1,3.2],trim,"jrr-front-exit");add([-28.45,6.35,0],[.12,2.3,1.8],"#50696b","jrr-front-exit");
    // Historic stone bands, projecting buttresses and a stepped entry surround.
    for(const y of [1.1,4.8,9.6,14.4])add([-26.35,y,0],[.28,.22,35.5],trim);
    for(const z of [-17,-8,8,17]){add([-26.45,7.2,z],[.72,13.8,.52],stone);add([-26.5,14.25,z],[.85,.3,.65],trim);}
    for(let y=1;y<14;y+=.55)for(let z=-16;z<17;z+=2.65)add([-26.31,y,z],[.035,.025,.31],"#a6a593");
    // A continuous stone parapet and pale coping follow the heritage facade's silhouette.
    add([-26.2,14.9,0],[.35,.9,35.5],stone);add([-26.2,15.4,0],[.48,.14,35.7],trim);
    for(const zz of [-19.55,19.55]){add([-20,14.9,zz],[14.4,.9,.3],stone);add([-20,15.4,zz],[14.6,.14,.48],trim);}
    // Paired pointed entrance surrounds read clearly from the Washington Road viewpoint.
    for(const center of [-.8,.8])for(const side of [-1,1])for(let i=0;i<8;i++){
      const t=i/8,u=(i+1)/8;beam(parts,[-28.55,5.5+t*2.7,center+side*.65*(1-t*t)],[-28.55,5.5+u*2.7,center+side*.65*(1-u*u)],.105,trim,"jrr-front-exit");
    }
  }
  addEquipment(parts,c,floor,colors);return parts;
}

export function PrincetonGeometry({config,floor,exterior,colors,onPick}:{config:PropertyConfig;floor:number|null;exterior:boolean;colors:Record<string,string>;onPick:(id:string)=>void}){
  const parts=useMemo(()=>princetonParts(config,floor,exterior,colors),[config,floor,exterior,colors]);
  return <group name="JRR_CONNECTED_COMPLEX">
    <PartBatches parts={parts} onPick={onPick}/>
    {(floor===null||floor===2)&&<><mesh position={[3.5,9.4,14]} rotation={[0,Math.PI/2,0]}><planeGeometry args={[14,8.3]}/><meshStandardMaterial color="#adcac9" transparent opacity={exterior?.25:.1} roughness={.25} depthWrite={false} side={2}/></mesh><mesh position={[9.8,14.15,14]} rotation={[-Math.PI/2,0,.06]}><planeGeometry args={[12.8,14]}/><meshStandardMaterial color="#b9d0ca" transparent opacity={.16} roughness={.2} depthWrite={false} side={2}/></mesh></>}
    {(floor===null||floor===4)&&config.spatial!.rooms.filter(r=>r.kind==="pavilion").map(r=><mesh key={r.id} position={[r.center[0],16.2,r.center[1]+r.size[1]/2]}><planeGeometry args={[r.size[0],2.8]}/><meshStandardMaterial color="#a8c4c5" transparent opacity={.32} depthWrite={false}/></mesh>)}
    {!exterior&&config.spatial!.rooms.filter(r=>(floor===null?r.floor===2:r.floor===floor)&&r.kind!=="office").map(r=><ModelSign key={r.id} text={r.name.split(" · ")[0]} position={[r.center[0],config.levels.find(l=>l.id===r.floor)!.y+.12,r.center[1]+r.size[1]/2-.55]} width={Math.min(r.size[0]-.4,8)} floor/>)}
    {!exterior&&config.infrastructureLines.filter(l=>floor!==null&&l.floor===floor).map(l=><Line key={l.id} points={l.points} color={l.kind==="water"?"#6a9fae":"#b99c65"} lineWidth={2}/>) }
    {exterior&&<><ModelSign text="Julis Romo Rabinowitz" position={[-26.5,13.4,0]} width={16}/><ModelSign text="Louis A. Simpson" position={[21,14.3,22.1]} width={14}/></>}
  </group>;
}
