export const MOTIFS = [
 {name:'DRIFT',weights:[1,3,0,0],note:'One part stays. Three move clockwise.'},
 {name:'RETURN',weights:[1,0,0,3],note:'One part stays. Three move anticlockwise.'},
 {name:'BRIDGE',weights:[1,0,3,0],note:'One part stays. Three cross the table.'},
 {name:'FORK',weights:[0,2,1,1],note:'Half clockwise. A quarter across. A quarter back.'},
 {name:'ANCHOR',weights:[3,1,0,0],note:'Three parts stay. One moves clockwise.'},
 {name:'SCATTER',weights:[1,1,1,1],note:'Every destination is equally likely.'},
 {name:'PASSAGE',weights:[0,3,1,0],note:'Three parts clockwise. One crosses.'},
 {name:'REVERSE',weights:[0,1,0,3],note:'One part clockwise. Three move back.'},
];
export function rng(seed:number){let t=seed>>>0;return()=>{t+=0x6D2B79F5;let n=Math.imul(t^(t>>>15),t|1);n^=n+Math.imul(n^(n>>>7),n|61);return((n^(n>>>14))>>>0)/4294967296;};}
export function row(m:number,s:number){const w=MOTIFS[m].weights;return Array.from({length:4},(_,d)=>w[(d-s+4)%4]/4);}
export function advance(stage:number,state:number){return stage===0&&state===2?1:stage===1&&state===1?2:stage;}
export function odds(board:number[],hops=8){let dist=Array(12).fill(0);dist[0]=1;for(let h=0;h<hops;h++){const next=Array(12).fill(0);for(let k=0;k<12;k++){const stage=Math.floor(k/4),s=k%4;if(stage===2){next[k]+=dist[k];continue;}row(board[s],s).forEach((p,d)=>{next[advance(stage,d)*4+d]+=dist[k]*p;});}dist=next;}return dist.slice(8).reduce((a,b)=>a+b,0);}
export function step(board:number[],state:number,random:()=>number){let x=random();const p=row(board[state],state);for(let d=0;d<4;d++){x-=p[d];if(x<0)return d;}return 3;}
/** First-hit duel: clubs wins for the player, spades for the bot; neither is a draw. */
export function raceOdds(board:number[],start=0,hops=8){if(start===2)return {you:1,bot:0,draw:0};if(start===3)return {you:0,bot:1,draw:0};let dist=[0,0,0,0],you=0,bot=0;dist[start]=1;for(let h=0;h<hops;h++){const next=[0,0,0,0];for(let s=0;s<4;s++)row(board[s],s).forEach((p,d)=>{const mass=dist[s]*p;if(d===2)you+=mass;else if(d===3)bot+=mass;else next[d]+=mass;});dist=next;}return {you,bot,draw:dist.reduce((a,b)=>a+b,0)};}
export function botMove(board:number[],hand:number[],start:number,hops:number){let best={card:0,state:0,value:-Infinity};hand.forEach((m,card)=>{for(let state=0;state<4;state++){const next=[...board];next[state]=m;const o=raceOdds(next,start,hops),value=o.bot-o.you;if(value>best.value+1e-10)best={card,state,value};}});return best;}
