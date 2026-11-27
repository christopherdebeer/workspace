// Two pictorial anaglyphs, drawn as independent opaque/transparent printing plates.
// All tones are spatial coverage of binary ink, not RGB colour.
type Part='headline'|'product'|'copy'|'ornament'|'coupon'|'background';
type Paint=(c:CanvasRenderingContext2D,W:number,H:number)=>void;
type Surface=(part:Part,x:number,y:number,z:number,w:number,h:number,paint:Paint,tilt?:number)=>void;
function path(c:CanvasRenderingContext2D,d:string,fill='#111'){c.fillStyle=fill;c.fill(new Path2D(d))}
function label(c:CanvasRenderingContext2D,s:string,x:number,y:number,w:number,size:number,font='900 sans-serif'){
 c.save();c.font=font.replace(/(sans-serif|serif|monospace)$/,size+'px $1');c.textBaseline='top';c.translate(x,y);c.scale(w/Math.max(1,c.measureText(s).width),1);c.fillStyle='#111';c.fillText(s,0,0);c.restore()
}
function square(c:CanvasRenderingContext2D,W:number,H:number){c.scale(W/100,H/100)}
// Use a clipped, locally modulated dot screen so even mid-tones remain binary.
function dots(c:CanvasRenderingContext2D,d:string,shade:(x:number,y:number)=>number,step=1.45){
 c.save();c.clip(new Path2D(d));c.fillStyle='#111';for(let y=0;y<100;y+=step)for(let x=0;x<100;x+=step){
 const v=Math.max(0,Math.min(1,shade(x,y)));if(v<.025)continue;
 c.beginPath();c.arc(x+(Math.floor(y/step)%2)*step*.5,y,step*.65*Math.sqrt(v),0,Math.PI*2);c.fill()
 }c.restore()
}
export function pictorial(surface:Surface,n:number){
 const flight=n===3;
 surface('headline',0,.86,0,2.05,.15,(c,W,H)=>{
 label(c,'P E N N Y   /   V I S I O N',0,0,W*.54,H*.45,'bold monospace');
 label(c,flight?'FIG. 07 / FLIGHT':'FIG. 06 / APPARITION',W*.70,0,W*.30,H*.40,'monospace');
 c.fillStyle='#111';c.fillRect(0,H*.75,W,3);
 });
 surface('copy',0,-.86,.06,2.05,.27,(c,W,H)=>{
 label(c,flight?'A LITTLE MORE REAL.':'LOOK AGAIN.',0,0,W,H*.63);
 label(c,'VIRTUAL REALITY FOR SMALL CHANGE.',0,H*.74,W*.79,H*.20,'bold monospace');
 label(c,'01 p',W*.88,H*.74,W*.12,H*.20,'bold monospace')
 });
 surface('coupon',.84,-.56,0,.36,.14,(c,W,H)=>{label(c,'RED / CYAN',0,0,W,H*.42,'bold monospace');label(c,'2 EYES / 0 WATTS',0,H*.57,W,H*.30,'monospace')});
 if(!flight){
 // An anatomical engraving constructed from a rear cranial shell, face and jaw.
 const skull='M50 4 C25 3 13 17 12 38 C10 53 16 60 24 67 L28 79 L38 83 L62 83 L72 79 L76 67 C86 58 90 51 88 37 C87 16 73 4 50 4 Z';
 surface('product',0,.14,-.44,1.46,1.35,(c,W,H)=>{square(c,W,H);path(c,skull,'#fff');dots(c,skull,(x,y)=>.05+.8*Math.pow(Math.abs(x-47)/42,2)+.22*Math.max(0,(y-44)/42),1.15);c.strokeStyle='#111';c.lineWidth=1.25;c.stroke(new Path2D(skull))});
 surface('product',0,-.10,.24,1.26,.91,(c,W,H)=>{
 square(c,W,H);
 const face='M6 27 Q8 9 26 10 Q43 9 50 24 Q57 9 74 10 Q92 9 94 27 L91 48 L78 60 L73 77 L27 77 L22 60 L9 48 Z';
 path(c,face,'#fff');dots(c,face,(x,y)=>.13+.55*Math.abs(x-50)/50+.24*y/100,1.25);
 for(const a of [-1,1]){c.save();c.translate(50,0);c.scale(a,1);
 path(c,'M7 26 Q12 12 31 16 Q45 20 43 35 Q41 50 24 52 Q8 50 7 26 Z');
 dots(c,'M10 25 Q17 17 31 20 Q42 24 40 36 Q36 48 23 48 Q12 44 10 25 Z',(x,y)=>.6,1.1);
 c.restore()}
 path(c,'M50 36 Q43 46 42 56 Q43 63 48 60 L50 54 L52 60 Q57 63 58 56 Q57 46 50 36 Z');
 path(c,'M24 64 Q50 56 76 64 L71 77 Q50 82 29 77 Z');
 for(let i=0;i<9;i++){c.fillStyle='#fff';c.fillRect(30+i*4.5,64+Math.abs(i-4)*.35,3.8,8)}
 },.04);
 surface('product',0,-.42,.06,.94,.36,(c,W,H)=>{square(c,W,H);const jaw='M4 10 L15 14 L22 53 Q50 69 78 53 L85 14 L96 10 L91 64 Q79 91 50 94 Q21 91 9 64 Z';path(c,jaw,'#fff');dots(c,jaw,(x,y)=>.22+.55*y/100,1.5);c.strokeStyle='#111';c.lineWidth=1.8;c.stroke(new Path2D(jaw));for(let i=0;i<9;i++){c.fillStyle='#111';c.fillRect(30+i*4.7,51,1,12)}});
 // Fragmented ruled evidence surrounds the subject; not a full-bleed noise field.
 surface('ornament',-.54,.16,.83,.70,.98,(c,W,H)=>{square(c,W,H);c.strokeStyle='#111';c.lineWidth=.65;for(let i=0;i<25;i++){const y=8+i*3.4;c.beginPath();c.moveTo(2+(i*17)%24,y);c.lineTo(35+(i*13)%50,y);c.stroke()}});
 surface('ornament',.54,.18,-.85,.70,.88,(c,W,H)=>{square(c,W,H);c.strokeStyle='#111';c.lineWidth=.65;for(let i=0;i<17;i++){c.beginPath();c.arc(0,48,20+i*4,-1.1,1.1);c.stroke()}});
 }else{
 // Original bird silhouette, perched on a separate cardboard optical apparatus.
 surface('product',0,-.34,.32,1.63,.61,(c,W,H)=>{square(c,W,H);path(c,'M3 12 L97 12 L94 54 Q91 88 72 89 Q58 88 53 63 L47 63 Q42 88 28 89 Q9 88 6 54 Z');
 for(const s of [-1,1]){c.save();c.translate(50,0);c.scale(s,1);path(c,'M8 25 L39 25 L36 55 Q33 74 23 73 Q12 73 10 51 Z','#fff');dots(c,'M8 25 L39 25 L36 55 Q33 74 23 73 Q12 73 10 51 Z',(x,y)=>.08+.32*y/100,1.7);c.restore()}
 },.25);
 for(const s of [-1,1])surface('product',s*.69,-.19,-.26,.68,.12,(c,W,H)=>{path(c,'M0 0', '#111');c.fillStyle='#111';c.fillRect(0,H*.25,W,H*.48)},s*.70);
 surface('product',-.05,.28,-.12,1.58,.91,(c,W,H)=>{square(c,W,H);
 const bird='M6 79 L36 48 Q45 28 63 25 Q68 6 83 11 Q92 14 95 25 L100 29 L94 32 Q87 51 72 55 Q63 70 42 72 L8 91 L29 72 Z';
 path(c,bird,'#fff');dots(c,bird,(x,y)=>.15+.6*(1-y/100)+.18*x/100,1.35);path(c,'M67 25 Q68 6 83 11 Q92 14 95 25 L100 29 L93 32 L82 38 Q73 37 67 25 Z');c.fillStyle='#fff';c.beginPath();c.arc(84,21,2.1,0,Math.PI*2);c.fill();
 path(c,'M6 79 L39 56 L47 64 L8 91 L29 72 Z');
 },-.14);
 surface('product',-.13,.23,.35,.99,.55,(c,W,H)=>{square(c,W,H);const wing='M4 78 Q32 8 68 12 Q88 13 96 33 Q81 60 47 70 L4 88 L24 67 Z';path(c,wing,'#fff');dots(c,wing,(x,y)=>.17+.52*x/100,1.4);for(let i=0;i<9;i++){const y=22+i*6;path(c,'M'+(69-i*3)+' '+y+' Q45 '+(y+3)+' '+(8+i*3)+' '+(y+21)+' L'+(16+i*3)+' '+(y+18)+' Q56 '+(y+7)+' '+(81-i*3)+' '+(y+2)+' Z')}},-.25);
 surface('product',.27,-.04,.20,.46,.31,(c,W,H)=>{square(c,W,H);c.strokeStyle='#111';c.lineWidth=4;c.beginPath();c.moveTo(36,0);c.lineTo(31,63);c.lineTo(17,84);c.moveTo(70,0);c.lineTo(65,62);c.lineTo(48,82);c.moveTo(31,63);c.lineTo(46,77);c.moveTo(65,62);c.lineTo(81,77);c.stroke()});
 surface('ornament',-.56,.26,.78,.77,.70,(c,W,H)=>{square(c,W,H);c.strokeStyle='#111';c.lineWidth=.65;for(let i=0;i<23;i++){let y=8+i*3.5;c.beginPath();c.moveTo(4,y);c.lineTo(60+(i*19)%35,y-12);c.stroke()}});
 surface('ornament',.49,.23,-.76,.72,.74,(c,W,H)=>{square(c,W,H);c.strokeStyle='#111';c.lineWidth=.7;for(let i=0;i<13;i++){c.beginPath();c.ellipse(41,48,10+i*3,13+i*3,-.3,0,Math.PI*2);c.stroke()}});
 }
 surface('background',0,0,-1.0,2.12,1.72,(c,W,H)=>{c.strokeStyle='#111';c.lineWidth=2;for(const x of [0,W-1])for(const y of [0,H-1]){const a=x? -1:1,b=y?-1:1;c.beginPath();c.moveTo(x+a*35,y);c.lineTo(x,y);c.lineTo(x,y+b*35);c.stroke()}});
}
