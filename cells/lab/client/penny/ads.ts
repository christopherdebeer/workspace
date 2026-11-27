// Binary optical classifieds: an experimental anti-periodic stereogram and a conventional control.
export function startAds(){
 const q=new URLSearchParams(location.search);
 const formats:Record<string,[number,number]>={'social':[1080,1350],'story':[1080,1920],'rectangle':[300,250],'leaderboard':[728,90],'skyscraper':[160,600]};
 document.body.innerHTML='';
 document.body.className='';
 document.body.style.cssText='margin:0;background:#171717;color:#ddd;font:13px monospace;overflow:auto;display:block;min-height:100vh';
 const root=document.createElement('main');root.style.cssText='display:grid;justify-items:center;gap:14px;padding:18px;box-sizing:border-box';document.body.append(root);
 const bar=document.createElement('div');bar.style.cssText='display:flex;flex-wrap:wrap;justify-content:center;gap:8px;align-items:center';root.append(bar);
 const select=(items:string[],value:string)=>{const e=document.createElement('select');for(const k of items)e.add(new Option(k,k));e.value=items.includes(value)?value:items[0];bar.append(e);return e};
 const format=select(Object.keys(formats),q.get('format')||'social');
 const mode=select(['graphic','two plates','binary','stereo','depth','red lens','cyan lens'],q.get('mode')||'graphic');
 const density=select(['fine','coarse'],q.get('grain')||'fine');
 const save=document.createElement('button');save.textContent='Download PNG';bar.append(save);
 const back=document.createElement('a');back.href=location.pathname;back.textContent='Penny / viewer';back.style.color='#ddd';bar.append(back);
 const canvas=document.createElement('canvas');canvas.style.cssText='display:block;max-width:100%;height:auto;image-rendering:pixelated';root.append(canvas);
 const caption=document.createElement('div');caption.style.cssText='max-width:68ch;line-height:1.5';root.append(caption);
 const ctx=canvas.getContext('2d')!;
 function draw(){
 const [w,h]=formats[format.value];canvas.width=w;canvas.height=h;
 const plate=document.createElement('canvas');plate.width=w;plate.height=h;const p=plate.getContext('2d')!;
 const narrow=w/h<.55, wide=w/h>3, W=wide?1000:narrow?320:800,H=W*h/w;
 p.scale(w/W,h/H);
 p.fillStyle='#444';p.fillRect(0,0,W,H);
 const rect=(x:number,y:number,a:number,b:number,g:number)=>{p.fillStyle='rgb('+g+','+g+','+g+')';p.fillRect(x,y,a,b)};
 function type(s:string,x:number,y:number,a:number,size:number,g=220,f='900 sans-serif'){
 p.save();p.translate(x,y);p.font=f.replace(' sans-serif',' '+size+'px sans-serif');
 if(!p.font.includes(size+'px'))p.font=size+'px '+f;
 const m=p.measureText(s).width;p.scale(a/Math.max(1,m),1);p.fillStyle='rgb('+g+','+g+','+g+')';p.textBaseline='top';p.fillText(s,0,0);p.restore();
 }
 function line(x:number,y:number,x2:number,y2:number,g:number,weight=1){p.strokeStyle='rgb('+g+','+g+','+g+')';p.lineWidth=weight;p.beginPath();p.moveTo(x,y);p.lineTo(x2,y2);p.stroke()}
 function glasses(x:number,y:number,a:number,b:number){p.save();p.translate(x,y);p.scale(a/300,b/110);p.fillStyle='#ddd';p.beginPath();p.moveTo(0,18);p.lineTo(38,0);p.lineTo(280,0);p.lineTo(300,16);p.lineTo(286,89);p.lineTo(180,89);p.lineTo(151,58);p.lineTo(125,89);p.lineTo(20,89);p.closePath();p.fill();rect(29,15,99,53,100);rect(173,15,99,53,100);p.restore()}
 const m=W*.035;
 // The depth artwork is deliberately composed as cheap optical newsprint.
 for(let i=0;i<48;i++){const a=i*Math.PI/24;line(W/2,H*.49,W/2+Math.cos(a)*W*2,H*.49+Math.sin(a)*H*2, i%2?64:82,2)}
 if(wide){
 rect(0,0,W,H*.15,155);type('PENNY VISION / OPTICAL CLASSIFIEDS',m,1,W*.92,H*.12,235);
 type('THE THIRD DIMENSION',m,H*.20,W*.60,H*.35,238);
 type('VIRTUAL REALITY FOR SMALL CHANGE',m,H*.65,W*.62,H*.22,182);
 glasses(W*.68,H*.22,W*.28,H*.65);
 }else{
 rect(m,m,W-2*m,H*.043,155);type('OPTICAL CLASSIFIEDS  /  ISSUE 003',m*1.3,m*1.15,W-2.6*m,H*.028,230);
 type('PENNY',m,H*.08,W-2*m,H*.135,238);
 type('VISION',m,H*.20,W-2*m,H*.135,215);
 rect(m,H*.335,W-2*m,H*.049,100);type('VIRTUAL REALITY',m*1.2,H*.34,W-2.4*m,H*.041,235);
 type('FOR SMALL CHANGE.',m,H*.389,W-2*m,H*.05,190);
 glasses(m,H*.465,W-2*m,H*.19);
 type('TWO LENSES.',m,H*.65,W-2*m,H*.062,230);
 type('NO ELECTRONICS.',m,H*.711,W-2*m,H*.055,192);
 line(m,H*.78,W-m,H*.78,230,3);
 const rows=['THE FUTURE IS MADE OF CARDBOARD.','YOUR SCREEN. ANOTHER DIMENSION.','NO BATTERIES. NO DOWNLOADS.','INCLUDES BOTH EYES.'];
 rows.forEach((s,i)=>type(s,m,H*(.79+i*.029),W-2*m,H*.024,155+i*20,'monospace'));
 rect(m,H*.918,W-2*m,H*.06,104);type('SEE WHAT YOU’RE MISSING.',m*1.2,H*.93,W-2.4*m,H*.038,240);
 }
 // Additional commercial engraving: checker borders, orbit diagrams, coupon, browser chrome.
 if(!wide){
 for(let i=0;i<24;i++){rect(i*W/24,0,W/24,H*.012,i%2?210:35);rect(i*W/24,H*.988,W/24,H*.012,i%2?35:210)}
 for(let j=0;j<5;j++){
 const x=W*.82,y=H*.52; p.strokeStyle='rgb(135,135,135)';p.lineWidth=2;p.beginPath();p.ellipse(x,y,W*(.07+j*.026),H*(.022+j*.009),-.5,0,Math.PI*2);p.stroke();
 }
 for(let i=0;i<20;i++)line(m+i*(W-2*m)/20,H*.906,m+i*(W-2*m)/20+W*.012,H*.906,220,2);
 type('✦  NEW!  /  REAL 3-D  /  BY MAIL  ✦',m,H*.435,W-2*m,H*.023,160,'bold monospace');
 }
 const depth=p.getImageData(0,0,w,h).data;
 const out=ctx.createImageData(w,h);const step=density.value==='coarse'?Math.max(1,Math.round(w/220)):Math.max(1,Math.round(w/540));
 const cols=Math.ceil(w/step),rows=Math.ceil(h/step),bits=new Uint8Array(cols),right=new Uint8Array(cols);
 let seed=1733;function rand(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&1}
 // Graphic proof: pattern orientation, rather than a large luminance difference,
 // defines the marks. Local screen phase is horizontally displaced between plates.
 if(mode.value==='graphic'||mode.value==='two plates'){
 const strict=mode.value==='graphic', g=Math.max(1,Math.round(w/420))*(density.value==='coarse'?2:1);
 const sample=(x:number,y:number)=>depth[(y*w+Math.max(0,Math.min(w-1,x)))*4]/255;
 const hash=(x:number,y:number)=>{let n=Math.imul(x+137,374761393)+Math.imul(y+251,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296};
 const fract=(x:number)=>x-Math.floor(x);
 const screen=(x:number,y:number,v:number,phase:number)=>{
 const a=x/g,b=y/g, band=Math.floor(y/(h*.065+1));
 const jitter=hash(Math.floor(a/11),Math.floor(b/5))-.5;
 const angle=v>.68?-.62:v>.40?.75:1.6;
 const wave=fract((a*Math.cos(angle)+b*Math.sin(angle))*.29+phase+jitter*.55);
 const cross=fract((a*Math.sin(angle)-b*Math.cos(angle))*.18+jitter*.4);
 const threshold=.5+(v-.5)*.38;
 return (wave<threshold)!==(cross<.16&&band%3===0)?1:0;
 };
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const k=(y*w+x)*4, v=sample(x,y);
 const shift=Math.round(g*(1+v*3)), l=sample(x+shift,y), r=sample(x-shift,y);
 let a=screen(x+shift,y,l,0),b=screen(x-shift,y,r,.18);
 // Small optical classifieds seal: encoded relief rather than whole-page noise.
 if(!wide&&x>w*.72&&x<w*.95&&y>h*.79&&y<h*.89){
 const xx=Math.floor(x/g),yy=Math.floor(y/g),d=3+Math.round(v*4);
 a=hash(xx%(2*d),yy)>.5?1:0;
 if(xx%(2*d)>=d)a=1-(hash(xx%(2*d)-d,yy)>.5?1:0);
 b=1-a;
 }
 if(strict){
 // Preserve macro forms through the two screen orientations; no third ink.
 const choose=hash(Math.floor(x/(g*5)),Math.floor(y/(g*3)))>.5;
 a=choose?a:1-b;b=1-a;
 }
 out.data[k]=a*255;out.data[k+1]=out.data[k+2]=b*255;out.data[k+3]=255;
 }
 ctx.putImageData(out,0,0);
 caption.textContent=strict?'GRAPHIC / two colours only. Displaced directional screens and a local optical seal. Not a guaranteed binocular reconstruction.':'TWO PLATES / independent binary red and cyan impressions; overlap and gaps yield white and black. Experimental optical proof.';
 return;
 }
 const binary=mode.value==='binary'||mode.value==='red lens'||mode.value==='cyan lens';
 for(let j=0;j<rows;j++){
 const y=Math.min(h-1,j*step);
 for(let i=0;i<cols;i++){
 const x=Math.min(w-1,i*step),v=depth[(y*w+x)*4],d=4+Math.round((255-v)/64);
 // Opposite polarity at a depth-dependent horizontal offset gives positive correlation
 // at that offset through complementary filters. Experimental; not ordinary stereo.
 bits[i]=binary?(i<d?rand():1-bits[i-d]):rand();
 }
 for(let i=0;i<cols;i++){
 const x=Math.min(w-1,i*step),v=depth[(y*w+x)*4],d=Math.round((255-v)/50);
 right[i]=binary?1-bits[i]:(i>=d?bits[i-d]:rand());
 }
 for(let yy=y;yy<Math.min(h,y+step);yy++)for(let i=0;i<cols;i++)for(let xx=i*step;xx<Math.min(w,(i+1)*step);xx++){
 const k=(yy*w+xx)*4;let r=bits[i]*255,c=right[i]*255;
 if(mode.value==='depth')r=c=depth[k];
 if(mode.value==='red lens')c=r;
 if(mode.value==='cyan lens')r=c;
 out.data[k]=r;out.data[k+1]=out.data[k+2]=c;out.data[k+3]=255;
 }
 }
 ctx.putImageData(out,0,0);
 caption.textContent=mode.value==='binary'?'BINARY / exactly two RGB colours. Experimental depth-dependent anti-periodic texture; physical fusion is not yet validated.':mode.value==='stereo'?'STEREO CONTROL / independently encoded eye views; black and white are permitted by the composite.':mode.value==='depth'?'DEPTH PROOF / intended classified typography and illustration relief.':'MONOCULAR PROOF / one channel only; the complementary eye is not represented.';
 }
 for(const e of [format,mode,density])e.onchange=draw;
 save.onclick=()=>{const a=document.createElement('a');a.download='penny-'+format.value+'-'+mode.value+'.png';a.href=canvas.toDataURL('image/png');a.click()};
 draw();
}
