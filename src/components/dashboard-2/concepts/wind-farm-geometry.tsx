// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/wind-farm-geometry.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";
import {useEffect,useMemo,useRef} from "react";
import {useFrame} from "@react-three/fiber";
import {BufferGeometry,Float32BufferAttribute,type Group} from "three";
import {PartBatches,beam,type Part} from "./twin-primitives";
import {ModelSign,partsBuilder} from "./facility-primitives";
import {equipmentColor,siteBaseParts,SiteUtilities,InfrastructureLines,type OutdoorGeometryProps,type OutdoorFeature} from "./outdoor-primitives";

function bladeGeometry(){
  const positions:number[]=[],spans=[.65,1.4,3,5.2,7.7],chords=[.28,.83,.7,.4,.045],twists=[.43,.3,.19,.09,0];
  const section=(row:number,side:number,back:number)=>{
    const x=side*chords[row]*.64,z=back*.07*(1-row*.18),angle=twists[row];return [x*Math.cos(angle)-z*Math.sin(angle),spans[row],x*Math.sin(angle)+z*Math.cos(angle)];
  };
  for(let row=0;row<spans.length-1;row++)for(const face of [[[-1,-1],[1,-1],[1,1],[-1,1]],[[1,-1],[1,1],[-1,1],[-1,-1]]].slice(0,1)){
    for(let edge=0;edge<4;edge++){
      const a=face[edge],b=face[(edge+1)%4];for(const v of[section(row,a[0],a[1]),section(row+1,a[0],a[1]),section(row,b[0],b[1]),section(row,b[0],b[1]),section(row+1,a[0],a[1]),section(row+1,b[0],b[1])])positions.push(...v);
    }
  }
  const g=new BufferGeometry();g.setAttribute("position",new Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
}
function Rotor({feature,geometry,animate,normal,onPick}:{feature:OutdoorFeature;geometry:BufferGeometry;animate:boolean;normal:boolean;onPick:(id:string)=>void}){
  const group=useRef<Group>(null),seed=Number(feature.id.slice(-2))*.71;
  const initialRotation=useMemo<[number,number,number]>(()=>[0,0,seed],[seed]);
  useFrame(({invalidate,gl},delta)=>{
    if(!animate||!normal||!group.current||!gl.domElement.getClientRects().length)return;
    group.current.rotation.z+=Math.min(delta,.06)*.35;invalidate();
  });
  return <group ref={group} name={`${feature.assetId}_ROTOR`} position={[feature.position[0],feature.position[1]+feature.size[1],feature.position[2]+2]} rotation={initialRotation} onClick={e=>{e.stopPropagation();onPick(feature.assetId??feature.id);}}>
    {[0,1,2].map(i=><mesh key={i} geometry={geometry} rotation={[0,0,i*Math.PI*2/3]} castShadow><meshStandardMaterial color={normal?"#e8eeea":"#c39365"} roughness={.57} side={2}/></mesh>)}
    <mesh rotation={[Math.PI/2,0,0]}><coneGeometry args={[.57,1.5,12]}/><meshStandardMaterial color="#d4dfdb" roughness={.5}/></mesh>
  </group>;
}
function windParts(config:OutdoorGeometryProps["config"],colors:Record<string,string>,selected:string){
  const parts=siteBaseParts(config),add=partsBuilder(parts);
  for(const f of config.outdoor!.features.filter(f=>f.kind==="turbine")){
    const [x,y,z]=f.position,h=f.size[1],id=f.assetId??f.id,c=equipmentColor(colors,f.assetId,"#dce4dd"),inspect=selected===id||selected===f.id;
    add([x,y+.12,z],[5.5,.24,5.5],"#b9c2b3",id,"cylinder");add([x,y+.33,z],[2,.42,2],"#aab8ae",id,"cylinder");
    // Stacked tapered tower courses, rings and the service door.
    for(let i=0;i<8;i++){const radius=1.05-i*.065;add([x,y+(i+.5)*h/8,z],[radius,h/8,radius],c,id,"cylinder");add([x,y+i*h/8,z],[radius+.025,.07,radius+.025],"#bdcec8",id,"cylinder");}
    add([x,y+1.2,z+1.06],[.65,1.8,.035],"#a3b9ba",id);add([x+.28,y+1.2,z+1.1],[.04,.12,.025],"#5d7b80",id);
    if(inspect){
      // Expose the working deck instead of drawing the drivetrain over an opaque shell.
      add([x,y+h-.63,z-.35],[1.9,.17,3.65],"#a7bbb6",id);add([x+.9,y+h-.1,z-.35],[.07,1.1,3.5],"#c2ccc6",id);add([x,y+h-.1,z-2.08],[1.8,1.1,.07],"#b5c4bf",id);
      beam(parts,[x,y+h,z-1.65],[x,y+h,z+1.9],.12,"#7b8f90",id);
      // Generator cylinder with visible cooling ribs / copper end ring.
      add([x,y+h,z-1.05],[.46,1,.46],"#6e9297",id,"cylinder",[Math.PI/2,0,0]);
      for(let k=0;k<7;k++)add([x,y+h,z-1.48+k*.14],[.5,.045,.5],"#97b0ac",id,"cylinder",[Math.PI/2,0,0]);
      add([x,y+h,z-.5],[.37,.09,.37],"#b2976e",id,"cylinder",[Math.PI/2,0,0]);
      // Gearcase, brake disc, bearing pedestals and an exposed toothed rim.
      add([x,y+h-.12,z+.35],[.84,.78,.65],"#9aab9d",id);add([x,y+h,z+.72],[.46,.08,.46],"#6e8586",id,"cylinder",[Math.PI/2,0,0]);
      for(let k=0;k<16;k++){const a=k/16*Math.PI*2;add([x+Math.cos(a)*.44,y+h+Math.sin(a)*.44,z+.78],[.12,.12,.12],"#c0c9bd",id,"box",[0,0,a]);}
      for(const dz of [-1.6,.95]){add([x,y+h-.35,z+dz],[.7,.35,.24],"#859e97",id);add([x,y+h,z+dz],[.25,.1,.25],"#b8c5b9",id,"cylinder",[Math.PI/2,0,0]);}
      for(const dz of [-1.8,-.5,.8])add([x-.85,y+h+.1,z+dz],[.035,1.1,.035],"#8caaa5",id);beam(parts,[x-.85,y+h+.65,z-1.8],[x-.85,y+h+.65,z+.8],.025,"#8caaa5",id);
    }else{add([x,y+h,z-.35],[1.7,1.55,3.5],c,id);add([x,y+h+.8,z-.35],[1.85,.12,3.65],"#edf0e6",id);}
    add([x,y+h+1.2,z-1.2],[.045,.7,.045],"#667d7f",id);for(const dx of [-.35,.35])beam(parts,[x,y+h+1.5,z-1.2],[x+dx,y+h+1.5,z-1.2],.025,"#667d7f",id);
    add([x,y+h+.87,z+1.2],[.14,.12,.14],"#d0aa77",id,"cylinder");
    for(const dx of [-1.5,1.5])for(const dz of [-1.5,1.5])add([x+dx,y+.56,z+dz],[.09,.18,.09],"#617571",id,"cylinder");
  }
  // Low boundary mounds and hedgerows give the flat access network landscape context.
  for(const [x,z]of[[-58,-52],[38,-56],[64,17],[-62,7]])add([x,-1,z],[14,2.5,8],"#90a47a",undefined,"crown");
  return parts;
}
export function WindFarmGeometry({config,exterior,colors,onPick,animate,selected}:{animate:boolean;selected:string}&OutdoorGeometryProps){
  const inspection=config.sensors.find(s=>s.id===selected)?.assetId??selected;
  const parts=useMemo(()=>windParts(config,colors,inspection),[config,colors,inspection]),blade=useMemo(bladeGeometry,[]);
  useEffect(()=>()=>blade.dispose(),[blade]);
  return <group name="WF_RIDGEWAY_TURBINES"><PartBatches parts={parts} onPick={onPick}/><SiteUtilities config={config} exterior={exterior} colors={colors} onPick={onPick}/>
    {config.outdoor!.features.filter(f=>f.kind==="turbine").map(f=><Rotor key={f.id} feature={f} geometry={blade} animate={animate} normal={colors[f.assetId!]==="#6c9991"} onPick={onPick}/>)}
    <InfrastructureLines config={config} colors={colors}/>
    {config.outdoor!.features.filter(f=>f.kind==="turbine").map(f=><ModelSign key={f.id} text={f.assetId!} position={[f.position[0],.65,f.position[2]+8.8]} width={9} floor/>)}
    <ModelSign text="Collector / grid yard" position={[50,.57,36]} width={24} floor/>
  </group>;
}
