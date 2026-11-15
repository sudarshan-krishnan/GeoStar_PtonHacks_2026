// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/solar-farm-geometry.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";
import {useEffect,useLayoutEffect,useMemo,useRef} from "react";
import {CanvasTexture,Color,Object3D,SRGBColorSpace,type InstancedMesh} from "three";
import {PartBatches,type Part} from "./twin-primitives";
import {ModelSign,partsBuilder} from "./facility-primitives";
import {equipmentColor,siteBaseParts,SiteUtilities,InfrastructureLines,type OutdoorGeometryProps} from "./outdoor-primitives";

function moduleTexture(){
  const canvas=document.createElement("canvas");canvas.width=384;canvas.height=640;const ctx=canvas.getContext("2d")!;
  ctx.fillStyle="#b9c7cf";ctx.fillRect(0,0,384,640);
  for(let y=0;y<10;y++)for(let x=0;x<6;x++){
    const px=5+x*62.5,py=5+y*63;ctx.fillStyle=["#244b69","#2c5472","#254e6d","#315b77"][(x+y*3)%4];
    ctx.beginPath();ctx.roundRect(px,py,59,59,5);ctx.fill();
    ctx.strokeStyle="#8daec0";ctx.lineWidth=.75;for(let j=1;j<4;j++){ctx.beginPath();ctx.moveTo(px+j*14,py);ctx.lineTo(px+j*14,py+59);ctx.stroke();}
    ctx.fillStyle="#91aabe";ctx.fillRect(px,py+28,59,1.1);
  }
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.anisotropy=4;return texture;
}
function PVModules({config,colors,onPick}:{config:OutdoorGeometryProps["config"];colors:Record<string,string>;onPick:(id:string)=>void}){
  const tables=config.outdoor!.features.filter(f=>f.kind==="solar-row"),mesh=useRef<InstancedMesh>(null),texture=useMemo(moduleTexture,[]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  useLayoutEffect(()=>{if(!mesh.current)return;const dummy=new Object3D(),color=new Color();let i=0;for(const table of tables)for(let panel=0;panel<16;panel++){
    dummy.position.set(table.position[0]-10.1+panel*1.35,table.position[1]+table.size[1]+.06,table.position[2]);dummy.rotation.set(-Math.PI/2+(table.rotation?.[0]??.3),0,0);dummy.scale.set(1.29,2.13,1);dummy.updateMatrix();mesh.current.setMatrixAt(i,dummy.matrix);
    const c=equipmentColor(colors,table.assetId,"#ffffff");mesh.current.setColorAt(i++,color.set(c));
  }mesh.current.instanceMatrix.needsUpdate=true;if(mesh.current.instanceColor)mesh.current.instanceColor.needsUpdate=true;mesh.current.computeBoundingSphere();},[tables,colors]);
  return <instancedMesh ref={mesh} args={[undefined,undefined,tables.length*16]} castShadow onClick={e=>{const row=tables[Math.floor((e.instanceId??0)/16)];if(row){e.stopPropagation();onPick(row.assetId??row.id);}}}><planeGeometry args={[1,1]}/><meshStandardMaterial map={texture} roughness={.32} metalness={.18} side={2}/></instancedMesh>;
}
function solarParts(config:OutdoorGeometryProps["config"]){
  const parts=siteBaseParts(config),add=partsBuilder(parts);
  for(const table of config.outdoor!.features.filter(f=>f.kind==="solar-row")){
    const [x,y,z]=table.position,id=table.assetId??table.id,tilt=table.rotation?.[0]??.3;
    add([x,y+table.size[1],z],[21.75,.09,2.25],"#5a747d",id,"box",[tilt,0,0]);
    for(const dx of [-9,-3,3,9]){
      add([x+dx,y+.58,z],[.12,1.2,.12],"#8c9c9a",id);add([x+dx,y+.05,z],[.55,.12,.55],"#c2c4b2",id);
      add([x+dx,y+1.2,z],[.08,.12,2.1],"#a2afaa",id,"box",[tilt,0,0]);
    }
    for(let panel=0;panel<=16;panel++)add([x-10.8+panel*1.35,y+table.size[1]+.055,z],[.035,.07,2.25],"#b4c3c6",id,"box",[tilt,0,0]);
    add([x+11.1,y+.85,z],[.5,.6,.5],"#8eaaa9",id);add([x,y+1.1,z],[21,.06,.06],"#6c827f",id);
  }
  // Drainage swales and ballast edges remain distinct from the staff paths.
  for(const x of [-69,69])add([x,.42,-8],[1.1,.06,77],"#849979");
  // Utility van and charging/service bay at the workshop.
  add([-20,1.1,53],[4.7,1.4,2.2],"#e2e4d6");add([-18.1,1.95,53],[1.5,.7,2],"#c9d4ce");add([-17.3,1.95,53],[.05,.5,1.6],"#62838d");
  for(const x of [-21.3,-18.8])for(const z of [51.85,54.15])add([x,.72,z],[.43,.12,.43],"#50615f",undefined,"cylinder",[Math.PI/2,0,0]);
  return parts;
}
export function SolarFarmGeometry({config,exterior,colors,onPick}:OutdoorGeometryProps){
  const parts=useMemo(()=>solarParts(config),[config]);
  return <group name="SF_SUNRIDGE_ARRAYS"><PartBatches parts={parts} onPick={onPick}/><PVModules config={config} colors={colors} onPick={onPick}/><SiteUtilities config={config} exterior={exterior} colors={colors} onPick={onPick}/>
    <InfrastructureLines config={config} colors={colors}/>
    {Array.from({length:8},(_,i)=>{const cx=[-45,-15,15,45][i%4],z=i<4?-38:1;return <ModelSign key={i} text={`Array ${String(i+1).padStart(2,"0")} / 80 modules`} position={[cx,.62,z]} width={21} floor/>;})}
    <ModelSign text="Main staff access" position={[0,.55,53]} width={19} floor/><ModelSign text="Transformer / grid yard" position={[28,.57,28]} width={22} floor/>
  </group>;
}
