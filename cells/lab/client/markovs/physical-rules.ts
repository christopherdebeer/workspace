// Square junction cards. Directions: north, east, south, west; -1 stays.
export const PATHS = [
 {name:'STRAIGHT',faces:[0,0,0,2,2,2]},
 {name:'ELBOW',faces:[0,0,0,1,1,1]},
 {name:'FORK',faces:[0,0,0,1,1,3]},
 {name:'CROSS',faces:[0,1,1,2,3,3]},
 {name:'DRIFT',faces:[1,1,1,1,2,2]},
 {name:'RETURN',faces:[3,3,3,3,0,0]},
 {name:'LOOP',faces:[-1,-1,-1,0,0,0]},
 {name:'BRIDGE',faces:[1,1,1,3,3,3]},
];
export const DIRS=[[0,-1],[1,0],[0,1],[-1,0]];
export const key=(x:number,y:number)=>`${x},${y}`;
export function exits(tile:any){return PATHS[tile.card].faces.map(d=>d<0?-1:(d+tile.rotation)%4);}
export function destination(board:any,at:string,face:number){const tile=board[at];if(!tile||tile.goal!==undefined)return {at,reason:'goal',direction:-1};const d=exits(tile)[face-1];if(d===-1)return {at,reason:'loop',direction:d};const [x,y]=at.split(',').map(Number),[dx,dy]=DIRS[d],next=key(x+dx,y+dy);return board[next]?{at:next,reason:'move',direction:d}:{at,reason:'open',direction:d};}
export function canPlace(board:any,k:string,repairs:number){const [x,y]=k.split(',').map(Number);if(x<0||y<0||x>=5||y>=5)return false;if(board[k])return board[k].goal===undefined&&repairs>0;return DIRS.some(([dx,dy])=>{const t=board[key(x+dx,y+dy)];return t&&t.goal===undefined;});}
export function setup(){return {'2,2':{card:0,rotation:0,start:true},'0,0':{goal:0},'4,4':{goal:1}};}
// Bot compares only visible placements, with routes fixed during its forecast.
export function forecast(board:any,at:string,hops=8){let mass:any={[at]:1},wins=[0,0];for(let h=0;h<hops;h++){const next:any={};for(const [k,m] of Object.entries(mass)){if(board[k]?.goal!==undefined){wins[board[k].goal]+=Number(m);continue;}for(let die=1;die<=6;die++){const d=destination(board,k,die).at;next[d]=(next[d]||0)+Number(m)/6;}}mass=next;}for(const [k,m] of Object.entries(mass))if(board[k]?.goal!==undefined)wins[board[k].goal]+=Number(m);let utility=wins[1]-wins[0];for(const [k,m] of Object.entries(mass)){if(board[k]?.goal!==undefined)continue;const [x,y]=k.split(',').map(Number);utility+=Number(m)*((x+y-4)*.025);}return utility;}
export function chooseBot(board:any,hand:number[],at:string,repairs:number){let best:any=null;for(let y=0;y<5;y++)for(let x=0;x<5;x++){const k=key(x,y);if(!canPlace(board,k,repairs))continue;for(let card=0;card<hand.length;card++)for(let rotation=0;rotation<4;rotation++){const trial={...board,[k]:{card:hand[card],rotation,start:board[k]?.start}},value=forecast(trial,at)-(board[k] ? .01 : 0);if(!best||value>best.value+1e-9)best={k,card,rotation,value};}}return best;}
