// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/data-center-geometry.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import type { PropertyConfig } from "./types";
import { PartBatches, beam, type Part } from "./twin-primitives";
import { addEquipment, addStair, ModelSign, partsBuilder } from "./facility-primitives";

function dataCenterParts(c:PropertyConfig,floor:number|null,exterior:boolean,colors:Record<string,string>){
  const parts:Part[]=[],add=partsBuilder(parts),steel="#485c66",silver="#aab9b9",dark="#263d49";
  // Complete campus: paved service yard, separate generators, truck apron and secured perimeter.
  add([-5,-.25,-3],[88,.5,70],"#b9c6bb");add([-38,-.02,-6],[14,.15,42],"#a5b0ae");add([4,-.01,-28],[58,.15,12],"#a4b4b2");
  add([8,.01,26],[59,.16,8],"#c9cebf");add([-39,.01,20],[12,.16,10],"#a7b0aa");
  for(const x of [-47,36])for(let z=-34;z<=30;z+=4){add([x,1.2,z],[.06,2.4,.06],steel);if(z<30)for(const y of [.5,1.5,2.3])add([x,y,z+2],[.035,.035,4],"#8c9c97");}
  for(const z of [-36,32])for(let x=-47;x<=33;x+=4){if(z===32&&x>15&&x<30)continue;add([x,1.2,z],[.06,2.4,.06],steel);add([x+2,1.4,z],[4,.025,.025],"#8c9c97");}
  for(const x of [-44,-35,29,34]){add([x,2.9,24],[.09,5.8,.09],steel);add([x,5.85,24],[.7,.18,.35],"#d6dacb");}
  for(let i=0;i<6;i++)add([3+i*4,.12,28],[.1,.02,4.2],"#e0e0ce");
  if(floor===null||floor===1){
    const y=.5;
    add([0,y-.24,0],[66,.48,43],"#98a9ab","level-1");
    // Raised-floor tiles and exposed plenum edge make the technical floor legible.
    for(let x=-16;x<24;x+=1.8)for(let z=-15;z<12;z+=1.8){add([x,y-.01,z],[1.76,.045,1.76],(Math.round(x*2+z)%3)?"#ccd9d9":"#bccfd2","level-1");}
    for(let x=-15;x<=24;x+=2){add([x,y-.16,13],[.07,.3,.07],steel);add([x,y-.18,13],[1.5,.06,.08],"#6b9eae");}
    // Rear walls and structural frame; the front elevation is cut away in the working view.
    add([0,y+2.7,-21.5],[66,5.4,.25],"#b7c5c4","level-1");
    for(const x of [-33,-18,3,25,33])for(const z of [-21,13,21])add([x,y+2.7,z],[.28,5.4,.28],silver,"level-1");
    for(const room of c.spatial!.rooms.filter(r=>r.floor===1)){
      const [x,z]=room.center,[w,d]=room.size;
      if(room.kind!=="data-hall")add([x,y+.035,z],[w,.06,d],room.kind==="power"?"#d3ceba":room.kind==="noc"?"#b4c8c4":"#c3cfcb",room.id);
      add([x-w/2,y+(exterior?2.7:1.05),z],[.14,exterior?5.4:2.1,d],"#b5c7c7",room.id);
      if(room.kind!=="data-hall")add([x,y+1.1,z-d/2],[w,2.2,.12],"#cbd5cf",room.id);
    }
    for(const [hall,cx]of[["A",-7],["B",14]] as const){
      // A/B containment: two blue cold aisles per hall, with amber return-air lanes.
      for(const z of [-8.5,3.5]){
        add([cx,y+.06,z],[14.5,.04,3.4],"#8dbdca",`dc-hall-${hall.toLowerCase()}`);
        for(const x of [cx-7.2,cx+7.2]){
          add([x,y+1.4,z],[.12,2.8,3.5],silver,`dc-hall-${hall.toLowerCase()}`);add([x,y+2.85,z],[.16,.12,3.65],"#7198a4");
          for(const dz of [-.82,.82])add([x,y+1.45,z+dz],[.07,2.65,.06],"#93aeb7");
        }
        for(let x=cx-7;x<=cx+7;x+=1.4)add([x,y+2.87,z],[.07,.06,3.5],"#95b0b7");
        // Sparse top ribs preserve visibility into the contained aisle.
        for(const dx of [-5.5,0,5.5])add([cx+dx,y+.08,z],[.12,.02,1.6],"#deedf0");
      }
      add([cx,y+.05,-2.5],[15,.035,2.8],"#cab49a");add([cx,y+.05,9],[15,.035,2.4],"#cab49a");
      for(let row=0;row<4;row++)for(let col=0;col<12;col++){
        const id=`DC-${hall}${row+1}-${String(col+1).padStart(2,"0")}`,node=c.nodes.find(n=>n.id===id.toLowerCase())!,x=node.position[0],z=node.position[2],front=row%2===0?1:-1;
        const status=colors[id],tint=status==="#b45445"||status==="#c08636"?status:dark;
        add([x,y+1.3,z],[.94,2.6,1.25],tint,id);add([x,y+2.65,z],[1,.1,1.3],steel,id);
        add([x,y+1.35,z+front*.646],[.82,2.3,.035],"#405a67",id);
        // 12 distinct server faces, two rail columns and tiny status LEDs per cabinet.
        for(let u=0;u<12;u++){
          const yy=y+.25+u*.186;add([x,yy,z+front*.674],[.74,.12,.025],u%4===0?"#71828b":"#8a9da3",id);
          add([x+.27,yy,z+front*.691],[.055,.035,.015],u%5===0?"#82bd9d":"#83afc9",id);
        }
        for(const dx of [-.41,.41])add([x+dx,y+1.35,z+front*.69],[.025,2.3,.025],"#bac6c6",id);
        for(let vent=0;vent<9;vent++)add([x,y+.3+vent*.24,z-front*.64],[.76,.055,.025],"#4e6875",id);
        add([x+.32,y+1.35,z-front*.66],[.045,2.2,.035],"#8ba08f",id);
        for(const yy of [.7,1.8])add([x-.1,y+yy,z-front*.67],[.19,.025,.19],"#304b57",id,"cylinder",[Math.PI/2,0,0]);
        // Dual feed drops terminate at separate busways above each row.
        for(const dx of [-.3,.3])add([x+dx,y+3.25,z],[.04,1.2,.04],dx<0?"#bba36b":"#769bb7",id);
      }
      // End-of-row cooling cabinets and overhead cable ladders.
      for(const z of [-12,0,10]){
        add([cx+8,y+1.2,z],[.9,2.4,1.5],"#8baeb7",`DC-CDU-${hall}`);
        for(let i=0;i<8;i++)add([cx+8.47,y+.35+i*.24,z],[.03,.09,1.2],"#4b747e",`DC-CDU-${hall}`);
      }
      for(const z of [-11,-6,1,6]){
        for(const dz of [-.28,.28])add([cx,y+4.25,z+dz],[15,.07,.06],silver);
        for(let x=cx-7;x<=cx+7;x+=.8)add([x,y+4.25,z],[.045,.06,.6],silver);
      }
    }
    // NOC wall, consoles, task chairs and a twelve-screen video wall.
    for(let col=0;col<6;col++)for(let row=0;row<2;row++)add([-18+col*2.15,y+1.4+row*.85,13.5],[1.95,.72,.06],(col+row)%3===0?"#5e99a3":"#315c70","dc-noc");
    for(let i=0;i<4;i++){
      const x=-17+i*3.1;add([x,y+.8,18],[2.6,.12,1.1],"#879f9f","dc-noc");add([x,y+.4,18],[.12,.8,.6],steel,"dc-noc");
      for(const dx of [-.6,.6])add([x+dx,y+1.2,17.9],[.9,.55,.05],"#2f5364","dc-noc");add([x,y+.45,19.3],[.65,.13,.65],steel,"dc-noc");add([x,y+.9,19.5],[.65,.8,.12],steel,"dc-noc");
    }
    for(const x of [3,5,7,9,11]){add([x,y+1.25,17],[1,2.5,1.2],dark,"DC-NETWORK");for(let u=0;u<10;u++)add([x,y+.25+u*.22,17.62],[.85,.06,.025],"#6a9caf","DC-NETWORK");}
    for(let i=0;i<6;i++){add([-28+i*.9,y+1.3,-1],[.75,2.6,2.4],"#8b9eaa","DC-BATTERY");for(let j=0;j<6;j++)add([-28+i*.9,y+.3+j*.38,.23],[.6,.2,.04],"#3f5863","DC-BATTERY");}
    for(const x of [20,23]){add([x,y+1.4,18],[.09,2.8,3],"#84aaa9","dc-security");add([x,y+2.85,18],[.2,.16,3.1],steel,"dc-security");}
    add([26,y+.9,15],[2.6,1.8,1.2],"#97aea9","dc-security");add([-26,y+.9,17],[6,.18,2],"#b39b75","dc-service-workshop");
    add([-19,y+2.5,17],[2.5,5,2.8],"#9aafb4","DC-LIFT");add([-19,y+1.7,18.43],[1.7,3.4,.08],colors["DC-LIFT"]??silver,"DC-LIFT");
    addStair(parts,-31,18,y,6.8,"dc-stair-1");
  }
  if(floor===null||floor===2){
    const y=7.3;
    for(const s of c.spatial!.slabs.filter(s=>s.floor===2))add([s.center[0],y-.13,s.center[1]],[s.size[0],.26,s.size[1]],"#b0bfba","level-2");
    // Rooftop service deck only covers utilities and the rear spine, leaving both halls open.
    for(const z of [-17,-6,5,15]){
      add([-25,y+1.1,z],[3.8,2.2,3],"#91a5a4","DC-CHILLER");
      for(const x of [-26,-24])add([x,y+2.25,z],[.72,.12,.72],steel,"DC-CHILLER","cylinder");
      beam(parts,[-27,y+2,z],[-31,y+2,z],.13,"#78a9b6","DC-CHILLER");
    }
    for(let z=-19;z<=19;z+=2.5){add([-32,y+.6,z],[.05,1.2,.05],steel);add([-32,y+1.2,z],[.06,.06,2.5],steel);}
    for(const x of [-10,0,10,20]){
      add([x,y+.65,-18],[5,1.3,2.7],"#99aaa3","DC-AHU");for(const dx of [-1.5,0,1.5])add([x+dx,y+1.36,-18],[.6,.12,.6],"#526b70","DC-AHU","cylinder");
    }
  }
  // Outdoor chillers: visible in both the campus and working cutaway.
  for(const x of [-19,-5,9,23]){
    add([x,.2,-28],[10,.4,6],"#7c9593","DC-CHILLER");add([x,1.8,-28],[9,3,4.2],"#9daead","DC-CHILLER");
    for(const dx of [-2.5,0,2.5]){add([x+dx,3.38,-28],[.85,.13,.85],"#405c65","DC-CHILLER","cylinder");for(let a=0;a<3;a++)add([x+dx,3.47,-28],[1.45,.04,.12],"#83a4a5","DC-CHILLER","box",[0,a*Math.PI/3,0]);}
  }
  addEquipment(parts,c,floor,colors);
  if(exterior){
    // A closed envelope for the exterior view; operational inspection switches to the cutaway.
    for(const z of [-21.6,21.6])add([0,3.3,z],[66,5.6,.22],"#b9c4be");
    for(const x of [-33.1,33.1])add([x,3.3,0],[.22,5.6,43],"#acbab8");
    add([6,6.4,0],[54,.3,43],"#879d9a");
    for(let x=-16;x<=32;x+=2.5)add([x,6.62,0],[.035,.05,42],"#b5c4bd");
    for(const x of [-16,-9,-2,5,12,19,26])add([x,2.5,21.75],[4.4,2,.1],"#668b93");
    add([25,1.8,21.85],[3.2,3.2,.15],"#486e7b");add([25,3.6,23],[6,.18,3.3],"#627c7c");
  }
  return parts;
}

export function DataCenterGeometry({config,floor,exterior,colors,onPick}:{config:PropertyConfig;floor:number|null;exterior:boolean;colors:Record<string,string>;onPick:(id:string)=>void}){
  const parts=useMemo(()=>dataCenterParts(config,floor,exterior,colors),[config,floor,exterior,colors]);
  return <group name="DC_ATLAS_CAMPUS">
    <PartBatches parts={parts} onPick={onPick}/>
    {!exterior&&(floor===null||floor===1)&&<>
      {([[-7,"A"],[14,"B"]] as const).map(([x,hall])=><group key={hall}>
        <ModelSign text={`Data Hall ${hall}`} position={[x,.64,11.4]} width={10} floor/>
        {[-8.5,3.5].map((z,i)=><group key={z}><ModelSign text={`Cold aisle ${hall}${i+1}`} position={[x,.65,z]} width={8} floor/><mesh position={[x,3.38,z]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[14.4,3.3]}/><meshStandardMaterial color="#b1d6df" transparent opacity={.12} depthWrite={false}/></mesh></group>)}
        {[0,1,2,3].map(row=><ModelSign key={row} text={`${hall}${row+1} / 01—12`} position={[x,3.3,[-10.3,-6.7,1.7,5.3][row]]} width={7} color="#b5d2d7"/>)}
      </group>)}
      {config.spatial!.rooms.filter(r=>!["data-hall","plant"].includes(r.kind)).map(r=><ModelSign key={r.id} text={r.name} position={[r.center[0],.66,r.center[1]+r.size[1]/2-.4]} width={r.size[0]-.6} floor/>)}
      {config.infrastructureLines.filter(l=>l.floor===1).map(l=><Line key={l.id} points={l.points} color={l.kind==="water"?"#5996b0":l.systemId==="DC-UPS-A"?"#bc9e52":"#6d8ab5"} lineWidth={l.kind==="water"?3:2}/>)}
    </>}
    {!exterior&&(floor===null||floor===2)&&<ModelSign text="Cooling / pump gallery" position={[-25,7.48,12]} width={10} floor/>}
    {!exterior&&config.infrastructureLines.filter(l=>l.floor===2&&(floor===null||floor===2)).map(l=><Line key={l.id} points={l.points} color="#5996b0" lineWidth={4}/>)}
    <ModelSign text="Atlas / Data Center" position={[4,5.25,exterior?21.8:24]} width={24}/>
    <ModelSign text="A / B Standby Generation" position={[-41,.16,11]} width={11} floor/>
    <ModelSign text="Heat rejection / Chiller yard" position={[4,.16,-22.8]} width={26} floor/>
  </group>;
}
