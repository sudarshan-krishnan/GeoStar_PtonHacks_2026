// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/facility-primitives.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { PropertyConfig } from "./types";
import type { Point3 } from "./types";
import { beam, type Part, type ShapeKind } from "./twin-primitives";

export function partsBuilder(parts: Part[]) {
  return (p: Point3, s: Point3, color: string, id?: string, shape: ShapeKind = "box", rotation?: Point3) => parts.push({p,s,color,id,shape,rotation});
}

/** Local canvas labels avoid font downloads and remain part of the imported-model overlay layer. */
export function ModelSign({text,position,width=5,color="#425c61",floor=false}: {text:string;position:Point3;width?:number;color?:string;floor?:boolean}) {
  const texture=useMemo(()=>{
    const canvas=document.createElement("canvas");canvas.width=768;canvas.height=128;
    const ctx=canvas.getContext("2d")!;ctx.clearRect(0,0,768,128);
    ctx.fillStyle=color;ctx.font="600 36px Arial";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(text.toUpperCase(),384,64,744);
    const t=new CanvasTexture(canvas);t.colorSpace=SRGBColorSpace;return t;
  },[text,color]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <mesh position={position} rotation={floor?[-Math.PI/2,0,0]:[0,0,0]} renderOrder={3}><planeGeometry args={[width,width/6]}/><meshBasicMaterial map={texture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2}/></mesh>;
}

export function addStair(parts:Part[],x:number,z:number,y:number,height:number,id:string){
  const add=partsBuilder(parts),count=16,run=4.2;
  for(let i=0;i<count;i++)add([x,y+.12+i*height/count,z+run/2-i*run/count],[1.8,.14,run/count+.04],"#b8c6c6",id);
  for(const side of [-1,1]){
    beam(parts,[x+side,y+1,z+run/2],[x+side,y+height+.85,z-run/2],.035,"#607c7c",id);
    for(let i=0;i<=4;i++)add([x+side,y+.5+i*height/4,z+run/2-i*run/4],[.045,1,.045],"#728c8b",id);
  }
}

export function addEquipment(parts:Part[],config:PropertyConfig,floor:number|null,colors:Record<string,string>){
  const add=partsBuilder(parts);
  for(const a of config.assets.filter(a=>(floor===null||a.floor===floor)&&!/^DC-[AB]\d-/.test(a.id)&&!["route","access","elevator"].includes(a.kind))){
    const [x,,z]=a.position,y=config.levels.find(l=>l.id===a.floor)!.y,c=colors[a.id]??"#88a6a4";
    if(a.kind==="water"){
      add([x,y+.8,z],[1.15,1.6,.8],c,a.id);add([x,y+1.3,z+.42],[.7,.5,.04],"#d1e1df",a.id);
      for(const dx of [-.3,.3]){add([x+dx,y+2,z],[.07,1,.07],dx<0?"#75aaba":"#b68c78",a.id,"cylinder");add([x+dx,y+1.7,z+.15],[.18,.05,.18],"#b46f55",a.id,"cylinder",[Math.PI/2,0,0]);}
    }else if(a.kind==="hvac"){
      add([x,y+.65,z],[3.5,1.3,2],c,a.id);
      for(const dx of [-.9,.9]){add([x+dx,y+1.34,z],[.65,.08,.65],"#3d565c",a.id,"cylinder");for(let i=0;i<4;i++)add([x+dx,y+1.4,z],[1.05,.025,.07],"#8caaab",a.id,"box",[0,i*Math.PI/4,0]);}
      for(let i=0;i<7;i++)add([x-1.72,y+.2+i*.14,z],[.03,.055,1.6],"#c5d4ce",a.id);
    }else if(a.id.includes("GEN")){
      add([x,y+.3,z],[5,.6,9],"#8c9b96",a.id);add([x,y+1.9,z],[4.3,2.6,7],c,a.id);
      for(let i=0;i<12;i++)add([x+2.18,y+1+i*.14,z],[.05,.06,5.5],"#43595d",a.id);
      add([x,y+3.6,z-2],[.25,1.6,.25],"#55666a",a.id,"cylinder");add([x,y+4.45,z-2],[.42,.1,.42],"#788681",a.id,"cylinder");
    }else{
      const fire=a.kind==="fire",w=fire?.65:1.7,h=fire?1.2:2.2;
      add([x,y+h/2,z],[w,h,.75],fire?"#b97965":c,a.id);
      for(const dx of fire?[0]:[-.42,.42]){add([x+dx,y+h*.7,z+.39],[fire?.3:.38,.28,.025],"#233e49",a.id);add([x+dx,y+h*.3,z+.4],[.04,.3,.03],"#ccd8d1",a.id);}
      if(!fire)for(let i=0;i<5;i++)add([x,y+.2+i*.13,z+.4],[1.4,.025,.025],"#415b62",a.id);
    }
  }
}
