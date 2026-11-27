import {createHash, timingSafeEqual} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,PutCommand,DeleteCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {validId} from './client/things/world';
const db=DynamoDBDocumentClient.from(new DynamoDBClient({})),table=process.env.TABLE_NAME??'';
const ttl=24*60*60*1000,limit=240;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const eq=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(statusCode:number,data:unknown)=>({statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'},body:JSON.stringify(data)});
type Event={headers?:Record<string,string|undefined>;requestContext?:{http?:{method?:string}};body?:string;isBase64Encoded?:boolean};
const keyOk=(v:unknown)=>v==='root'||v==='seed-a'||v==='seed-b'||v==='seed-c'||validId(v);
const kinds=['start','select','deselect','clear','move','lasso','link-start','link-cancel','link-miss','contribution','enter','return','reveal','hide','unfold','reset','cancel','stop','show-all','name-open','name-cancel','failed'];
const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
function clean(v:any){
 if(!v||!kinds.includes(v.kind)||typeof v.ms!=='number'||!Number.isFinite(v.ms)||v.ms<0||v.ms>ttl||!keyOk(v.context)||!Array.isArray(v.nodes)||v.nodes.length>160||!Array.isArray(v.selected)||v.selected.length>160||!v.selected.every(keyOk))return null;
 const nodes=[];for(const p of v.nodes){if(!p||!keyOk(p.id)||!['thing','relation','collection','composition'].includes(p.kind)||!n(p.x)||!n(p.y)||!Array.isArray(p.refs)||p.refs.length>24||!p.refs.every(keyOk))return null;nodes.push({id:p.id,kind:p.kind,x:Math.round(p.x*1000)/1000,y:Math.round(p.y*1000)/1000,refs:p.refs,...(['round','square','triangle'].includes(p.form)?{form:p.form}:{})})}
 return {kind:v.kind,ms:Math.round(v.ms),context:v.context,nodes,selected:v.selected,...(keyOk(v.target)?{target:v.target}:{}),...(typeof v.duration==='number'&&Number.isFinite(v.duration)&&v.duration>=0?{duration:Math.min(60000,Math.round(v.duration))}:{}),...(['thing','relation','collection','composition','name'].includes(v.factKind)?{factKind:v.factKind}:{})};
}
export async function observeApi(event:Event,token:string){
 if(!validId(token))return json(400,{error:'invalid recording'});
 if(!table)return json(503,{error:'storage unavailable'});
 const key={pk:'THINGS-OBS#'+token,sk:'v1'},method=event.requestContext?.http?.method||'GET';
 if(method!=='GET'&&method!=='POST')return json(405,{error:'method'});
 if(method==='POST'&&event.headers?.origin&&event.headers.origin!=='https://c15r-lab.on.parc.land')return json(403,{error:'origin'});
 let raw:any={};
 if(method==='POST'){if(!event.body||event.body.length>110000)return json(400,{error:'size'});try{raw=JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString():event.body)}catch{return json(400,{error:'invalid JSON'})}if(!raw||!validId(raw.writer))return json(403,{error:'writer required'})}
 try{
 const result=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true})),item=result.Item,now=Date.now();
 if(method==='GET'){if(!item||item.expires<=now)return json(404,{error:'recording unavailable or expired'});return json(200,{events:item.events??[],created:item.created,expires:item.expires,closed:!!item.closed})}
 if(raw.action==='start'){
 if(item)return json(409,{error:'recording exists'});
 await db.send(new PutCommand({TableName:table,Item:{...key,writerHash:hash(raw.writer),created:now,expires:now+ttl,events:[],closed:false,revision:0},ConditionExpression:'attribute_not_exists(pk)'}));
 return json(200,{expires:now+ttl});
 }
 if(!item||!eq(item.writerHash,hash(raw.writer)))return json(403,{error:'not recording owner'});
 if(raw.action==='delete'){await db.send(new DeleteCommand({TableName:table,Key:key}));return json(200,{deleted:true})}
 if(item.expires<=now||item.closed)return json(409,{error:'recording closed or expired'});
 if(raw.action!=='append'&&raw.action!=='stop')return json(400,{error:'action'});
 if(!Array.isArray(raw.events)||raw.events.length>8)return json(400,{error:'batch'});
 const events=raw.events.map(clean);
 if(events.some((v:any)=>!v))return json(400,{error:'invalid event'});
 const combined=[...(item.events??[]),...events];
 // Keep the item below DynamoDB's 400 KB limit; no silent truncation.
 if(combined.length>limit||Buffer.byteLength(JSON.stringify(combined))>230000)return json(409,{error:'recording full; stop or delete'});
 await db.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:'SET events=:events, closed=:closed, revision=:next',ConditionExpression:'revision=:rev',ExpressionAttributeValues:{':events':combined,':closed':raw.action==='stop',':rev':item.revision,':next':item.revision+1}}));
 return json(200,{count:combined.length,closed:raw.action==='stop'});
 }catch(e){if((e as Error).name==='ConditionalCheckFailedException')return json(409,{error:'concurrent recording update'});console.error('things observe',(e as Error).name);return json(503,{error:'storage unavailable'})}
}
