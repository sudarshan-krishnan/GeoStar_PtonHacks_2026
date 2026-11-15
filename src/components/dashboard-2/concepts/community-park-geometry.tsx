// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/community-park-geometry.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";
import {useEffect,useMemo} from "react";
import {BufferGeometry,Float32BufferAttribute,Shape} from "three";
import {Line} from "@react-three/drei";
import {PartBatches,beam,sample,type Part} from "./twin-primitives";
import {ModelSign,partsBuilder} from "./facility-primitives";
import {addBench,addFence,addTree,siteBaseParts,SiteUtilities,InfrastructureLines,type OutdoorGeometryProps} from "./outdoor-primitives";

function parkParts(config:OutdoorGeometryProps["config"],exterior:boolean){
  const parts=siteBaseParts(config),add=partsBuilder(parts),wood="#af8d63",metal="#597a76";
  for(const f of config.outdoor!.features){
    const [x,y,z]=f.position,[w,h,d]=f.size,id=f.assetId??f.id;
    if(f.kind==="playground"){
      add([x,y+.05,z],[w,.1,d],"#c39372",id);add([x-5,y+.13,z-1],[8,.05,13],"#a2bbb1",id);add([x+6,y+.13,z+1],[9,.05,11],"#deb56e",id);
      for(const dx of [-3,3])for(const dz of [-2,2]){add([x+dx,y+1.4,z+dz],[.18,2.8,.18],wood,id);beam(parts,[x+dx,y+2.8,z+dz],[x,y+3.8,z+dz],.08,metal,id);}
      add([x,y+2,z],[6,.18,4],wood,id);for(const dx of [-3,3])add([x+dx,y+2.7,z],[.08,1.4,4],metal,id);
      for(let i=0;i<7;i++)add([x+4+i*.28,y+.16+i*.28,z-1],[.35,.2,1.3],"#d1ad70",id);
      // A four-bay swing frame with actual hanging seats and chains.
      for(const sx of [-8,-1])for(const sz of [4,7])beam(parts,[x+sx,y,z+sz],[x+sx,y+3.3,z+5.5],.075,metal,id);
      beam(parts,[x-8,y+3.3,z+5.5],[x-1,y+3.3,z+5.5],.1,metal,id);
      for(let k=0;k<3;k++){const sx=x-6.5+k*2;add([sx,y+.6,z+5.5],[1,.1,.55],"#66877e",id);for(const dx of [-.4,.4])beam(parts,[sx+dx,y+.65,z+5.5],[sx+dx,y+3.3,z+5.5],.017,"#bdc6bb",id);}
      // Accessible low play / sensory panel, a roundabout and balancing logs.
      add([x+7,y+.9,z-5],[.15,1.8,2.5],"#6c9294",id);for(let k=0;k<4;k++)add([x+7.15,y+1,z-5.8+k*.55],[.12,.3,.3],"#d8ac69",id,"cylinder",[0,0,Math.PI/2]);
      add([x+7,y+.25,z+5],[1.8,.25,1.8],"#6c9994",id,"cylinder");for(let k=0;k<6;k++){const a=k*Math.PI/3;beam(parts,[x+7,y+.5,z+5],[x+7+Math.cos(a)*1.5,y+1,z+5+Math.sin(a)*1.5],.04,metal,id);}
    }else if(f.kind==="court"){
      add([x,y+.04,z],[w,.08,d],"#b67f66",id);add([x,y+.09,z],[w-2,.02,d-2],"#6c9597",id);
      for(const dx of [-w/2+1,w/2-1])add([x+dx,y+.12,z],[.07,.02,d-2],"#e4e2c7",id);
      for(const dz of [-d/2+1,0,d/2-1])add([x,y+.12,z+dz],[w-2,.02,.07],"#e4e2c7",id);
      for(const side of [-1,1]){add([x+side*(w/2-1),y+1.8,z],[.12,3.6,.12],metal,id);add([x+side*(w/2-2),y+3.3,z],[.12,1,2],"#dbded1",id);beam(parts,[x+side*(w/2-1),y+3.3,z],[x+side*(w/2-2),y+3.3,z],.07,metal,id);}
      addFence(parts,[x,z],[w+.6,d+.6],2.3,id);
    }else if(f.kind==="garden"){
      add([x,y+.04,z],[w,.08,d],"#c3c2a0",id);
      for(let r=0;r<3;r++)for(let col=0;col<3;col++){
        const gx=x+(col-1)*5.6,gz=z+(r-1)*4.8;
        add([gx,y+.4,gz],[4.2,.8,3.1],wood,id);add([gx,y+.82,gz],[3.9,.08,2.8],"#7d8061",id);
        for(let k=0;k<12;k++){const px=gx-1.5+(k%4),pz=gz-.9+Math.floor(k/4)*.8;add([px,y+1.05,pz],[.32,.3,.3],["#6e925e","#8a9d5b","#a89c64"][r],id,"shrub");if(r===2)add([px,y+1.3,pz],[.07,.1,.07],"#c99472",id,"crown");}
        if(col===2)for(const dx of [-1.8,1.8]){add([gx+dx,y+1.5,gz],[.04,2.2,.04],metal,id);for(let h=0;h<3;h++)add([gx,y+1+h*.6,gz],[3.6,.035,.035],metal,id);}
      }
      add([x+w/2,y+.9,z+d/2],[.2,1.8,.2],wood,id);
    }else if(f.kind==="pavilion"){
      add([x,y+.07,z],[w,.14,d],"#d3c6aa",id);
      for(const dx of [-w/2+.7,w/2-.7])for(const dz of [-d/2+.7,d/2-.7])add([x+dx,y+h/2,z+dz],[.24,h,.24],wood,id);
      for(const dz of [-d/2+.7,d/2-.7]){beam(parts,[x-w/2,y+h,z+dz],[x,y+h+1.4,z+dz],.13,wood,id);beam(parts,[x,y+h+1.4,z+dz],[x+w/2,y+h,z+dz],.13,wood,id);}
      if(exterior){for(const side of [-1,1])add([x+side*w/4,y+h+.7,z],[w*.53,.15,d+.5],"#7c9385",id,"box",[0,0,side*-.15]);}
      else for(let dx=-w/2;dx<=w/2;dx+=1.1)beam(parts,[x+dx,y+h+.3,z-d/2],[x+dx,y+h+.3,z+d/2],.035,"#b1a17b",id);
      for(const dx of [-5,0,5])for(const dz of [-2.5,2.5]){
        add([x+dx,y+.82,z+dz],[3,.12,1.25],wood,id);for(const side of [-1,1]){add([x+dx,y+.48,z+dz+side*1.05],[3,.12,.4],wood,id);for(const end of [-1,1])add([x+dx+end,y+.35,z+dz+side*.6],[.08,.7,1.8],metal,id);}
      }
      for(let i=0;i<12;i++)add([x-w/2+1+i*(w-2)/11,y+h-.2,z+d/2-.8],[.07,.12,.07],"#eee1b0",id,"cylinder");
    }else if(f.kind==="bridge"){
      for(let dx=-w/2;dx<=w/2;dx+=.28)add([x+dx,y+.45,z],[.24,.12,d],wood,id);
      for(const side of [-1,1]){beam(parts,[x-w/2,y+1.5,z+side*d/2],[x+w/2,y+1.5,z+side*d/2],.045,metal,id);for(let dx=-w/2;dx<=w/2;dx+=1.5)add([x+dx,y+.9,z+side*d/2],[.06,1.3,.06],metal,id);}
    }else if(f.kind==="dog-park"){
      add([x,y+.03,z],[w,.06,d],"#a3b184",id);addFence(parts,[x,z],[w,d],1.25,id,[[x,y,z+d/2]]);
      for(let k=0;k<6;k++)add([x-6+k*2.2,y+.65,z-4],[.1,1.3,.1],"#7d9991",id,"cylinder");
      add([x,y+.7,z+3],[4,.16,1],wood,id,"box",[0,0,.22]);add([x+4,y+.7,z+3],[4,.16,1],wood,id,"box",[0,0,-.22]);addBench(parts,x-6,z+5);
    }else if(f.kind==="amphitheater"){
      for(let r=0;r<4;r++)for(let k=0;k<13;k++){const a=(k/12)*Math.PI+.1,rad=3+r*1.4;add([x+Math.cos(a)*rad,y+.15+r*.18,z+Math.sin(a)*rad],[1.7,.2,.65],r%2?"#a6b48c":"#9caf81",id,"box",[0,-a+Math.PI/2,0]);}
      add([x,y+.12,z],[9,.24,3],"#bdc2a0",id);
    }else if(f.kind==="rain-garden"){
      add([x,y+.02,z],[w,.04,d],"#7b997a",id);
      for(let i=0;i<45;i++){const px=x+(sample(i+18)-.5)*w,pz=z+(sample(i+67)-.5)*d;for(let j=0;j<3;j++)add([px+j*.06,y+.4+j*.08,pz],[.035,.8,.035],"#a6ad75",id,"rod");}
    }else if(f.kind==="lamp"){
      add([x,y+h/2,z],[.1,h,.1],metal,id,"cylinder");add([x,y+h,z],[.65,.14,.65],"#e5dfbd",id);add([x,y+h+.12,z],[.8,.08,.8],metal,id);
    }
  }
  for(const [x,z]of[[-10,7],[-35,10],[10,30],[38,9],[-16,-34]]){addBench(parts,x,z);add([x+1.8,1,z],[.5,1.2,.5],"#7a9180",undefined,"cylinder");}
  for(let i=0;i<14;i++){const x=-50+i*7.7;addTree(parts,x,-40,4.5+sample(i)*2,i+3,i%3===0);}
  for(let i=0;i<30;i++){const a=i/30*Math.PI*2;add([-25+Math.cos(a)*12.5,.75,-12+Math.sin(a)*9],[.6,.45,.45],"#a8b38c",undefined,"shrub");}
  return parts;
}

export function CommunityParkGeometry({config,exterior,colors,onPick}:OutdoorGeometryProps){
  const parts=useMemo(()=>parkParts(config,exterior),[config,exterior]);
  const pond=useMemo(()=>{const s=new Shape();s.absellipse(0,0,11.4,7.8,0,Math.PI*2,false,0);return s;},[]);
  const slide=useMemo(()=>{const positions:number[]=[];for(let i=0;i<18;i++){const t=i/18,u=(i+1)/18;const p=(v:number,dx:number)=>[24+dx,3.1-2.3*Math.sin(v*Math.PI/2),-11+v*5.8];for(const pnt of[p(t,-.6),p(u,-.6),p(t,.6),p(t,.6),p(u,-.6),p(u,.6)])positions.push(...pnt);}const g=new BufferGeometry();g.setAttribute("position",new Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;},[]);
  useEffect(()=>()=>slide.dispose(),[slide]);
  return <group name="MP_COMMUNITY_LANDSCAPE"><PartBatches parts={parts} onPick={onPick}/><SiteUtilities config={config} exterior={exterior} colors={colors} onPick={onPick}/>
    <mesh name="MP_POND" position={[-25,.49,-12]} rotation={[-Math.PI/2,0,0]} onClick={e=>{e.stopPropagation();onPick("mp-pond");}}><shapeGeometry args={[pond,32]}/><meshStandardMaterial color="#779f9e" metalness={.15} roughness={.24}/></mesh>
    <mesh geometry={slide} onClick={e=>{e.stopPropagation();onPick("mp-play");}}><meshStandardMaterial color="#d3a15f" side={2} roughness={.45}/></mesh>
    <Line points={Array.from({length:33},(_,i)=>[26+Math.cos(i/32*Math.PI*2)*2.6,.55,-32+Math.sin(i/32*Math.PI*2)*2.6] as [number,number,number])} color="#eeebd5" lineWidth={1.2}/>
    <InfrastructureLines config={config} colors={colors}/>
    {[["Central plaza",0,8],["Community gardens",1,-36],["Play & sport",25,-22],["Picnic pavilion",28,26]].map(([text,x,z])=><ModelSign key={text} text={String(text)} position={[Number(x),.57,Number(z)]} width={18} floor/>)}
  </group>;
}
