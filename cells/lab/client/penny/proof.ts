// Scan-convert the same engraved plate for viewers without a GPU context.
export function paperProof(canvas:HTMLCanvasElement, mesh:{vertices:Float32Array,indices:Uint16Array}, ink:Uint8ClampedArray, turn:number, focus:number, separation:number, mode:number){
  const ctx=canvas.getContext('2d')!, w=canvas.width,h=canvas.height;
  const scale=1.65*Math.min(w,h), data=ctx.createImageData(w,h);
  const v=mesh.vertices, indices=mesh.indices, projected=new Float32Array(v.length);
  const cy=Math.cos(turn),sy=Math.sin(turn),cx=Math.cos(-.22),sx=Math.sin(-.22);
  const zbuf=new Float32Array(w*h);
  function impression(eye:number, channel:number){
    zbuf.fill(-Infinity);
    for(let i=0;i<v.length;i+=8){
      const x=cy*v[i]+sy*v[i+2], z0=-sy*v[i]+cy*v[i+2];
      const y=cx*v[i+1]-sx*z0,z=sx*v[i+1]+cx*z0;
      const nx=cy*v[i+3]+sy*v[i+5], nz0=-sy*v[i+3]+cy*v[i+5];
      const ny=cx*v[i+4]-sx*nz0,nz=sx*v[i+4]+cx*nz0;
      projected[i]=w/2+scale*((x-eye)/(4.6-z)+eye/focus);
      projected[i+1]=h/2-scale*y/(4.6-z);projected[i+2]=z;
      projected[i+3]=.46+.25*(-.48*nx+.72*ny+.65*nz)/1.08+.10*nz+.055*z;
    }
    for(let j=0;j<indices.length;j+=3){
      const a=indices[j]*8,b=indices[j+1]*8,c=indices[j+2]*8;
      const ax=projected[a],ay=projected[a+1],bx=projected[b],by=projected[b+1],px=projected[c],py=projected[c+1];
      const det=(by-py)*(ax-px)+(px-bx)*(ay-py);
      if(Math.abs(det)<.0001)continue;
      const right=Math.min(w-1,Math.ceil(Math.max(ax,bx,px))),bottom=Math.min(h-1,Math.ceil(Math.max(ay,by,py)));
      const left=Math.max(0,Math.floor(Math.min(ax,bx,px)));
      for(let y=Math.max(0,Math.floor(Math.min(ay,by,py)));y<=bottom;y++)for(let x=left;x<=right;x++){
        const u=((by-py)*(x+.5-px)+(px-bx)*(y+.5-py))/det,t=((py-ay)*(x+.5-px)+(ax-px)*(y+.5-py))/det,s=1-u-t;
        if(u<0||t<0||s<0)continue;
        const idx=y*w+x,z=u*projected[a+2]+t*projected[b+2]+s*projected[c+2];
        if(z<=zbuf[idx])continue;
        zbuf[idx]=z;
        const longitudinal=u*v[a+6]+t*v[b+6]+s*v[c+6], circum=u*v[a+7]+t*v[b+7]+s*v[c+7];
        let value=u*projected[a+3]+t*projected[b+3]+s*projected[c+3]+.09*Math.max(0,Math.cos(2*Math.PI*(circum*24+.3*Math.sin(longitudinal*18.85))));
        if(circum>.16&&circum<.34){
          const col=Math.floor(longitudinal*2048)%512,row=Math.min(63,Math.floor((.34-circum)*64/.18));
          value=.08*value+.92*(.25+.49*ink[(row*512+col)*4]/255);
        }
        const k=idx*4;
        if(channel!==2)data.data[k]=value*255;
        if(channel!==1){data.data[k+2]=value*255;if(mode%2===0)data.data[k+1]=value*255}
      }
    }
  }
  for(let k=0;k<data.data.length;k+=4){data.data[k]=data.data[k+2]=34;data.data[k+1]=mode%2===0?34:0;data.data[k+3]=255}
  if(mode===4||!separation)impression(0,0);
  else{const sign=mode>=2?-1:1;impression(-sign*separation/2,1);impression(sign*separation/2,2)}
  ctx.putImageData(data,0,0);
}
