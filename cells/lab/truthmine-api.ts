import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { validInstrument, OPS, type Artifact, type Instrument, type Op } from './client/truthmine/world';
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table=process.env.TABLE_NAME??'';
const re=/^[a-f0-9]{32}$/;
const safeId=(v:unknown):v is string=>typeof v==='string'&&re.test(v);
type Event={rawPath?:string;rawQueryString?:string;headers?:Record<string,string|undefined>;requestContext?:{http?:{method?:string}};body?:string;isBase64Encoded?:boolean};
const json=(statusCode:number,data:unknown)=>({statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(data)});
export async function truthmineApi(event:Event,roomPath?:string){
 const room=roomPath||new URLSearchParams(event.rawQueryString||'').get('room')||'';
 if(!safeId(room))return json(400,{error:'invalid invitation'});
 if(!table)return json(503,{error:'storage unavailable'});
 const key={pk:'TRUTHMINE#'+room,sk:'v1'},method=event.requestContext?.http?.method||'GET';
 if(method!=='GET'&&method!=='POST')return json(405,{error:'method'});
 if(method==='POST'&&event.headers?.origin&&event.headers.origin!=='https://c15r-lab.on.parc.land')return json(403,{error:'origin'});
 let a:any;
 if(method==='POST'){if(!event.body||event.body.length>4096)return json(400,{error:'size'});try{a=JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString():event.body)}catch{return json(400,{error:'invalid JSON'})}if(!a||!safeId(a.id)||!safeId(a.by))return json(400,{error:'invalid identity'})}
 for(let attempt=0;attempt<3;attempt++)try{
 const result=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true})),artifacts=(result.Item?.artifacts??[]) as Artifact[];
 if(method==='GET'||artifacts.some(x=>x.id===a.id))return json(200,{artifacts});
 if(artifacts.length>=160)return json(409,{error:'room full'});
 const base={id:a.id,by:a.by,at:Date.now()};let item:Artifact;
 if(a.kind==='mark'&&typeof a.t==='number'&&Number.isFinite(a.t)&&Math.abs(a.t)<1e9)item={...base,kind:'mark',t:Math.round(a.t*100)/100};
 else if(a.kind==='instrument'&&typeof a.op==='string'&&Object.prototype.hasOwnProperty.call(OPS,a.op)&&Array.isArray(a.marks)&&a.marks.every(safeId)){
 const op=a.op as Op,leaf=op==='interval'||op==='change';
 if(!leaf&&(!Array.isArray(a.parts)||a.parts.length!==2||!a.parts.every(safeId)))return json(400,{error:'invalid constituents'});
 if(a.derivedFrom!==undefined&&!safeId(a.derivedFrom))return json(400,{error:'invalid origin'});
 const i:Instrument={...base,kind:'instrument',op,name:OPS[op].label+(op==='interval'?' ruler':''),marks:a.marks,...(!leaf?{parts:a.parts}:{}),...(a.derivedFrom?{derivedFrom:a.derivedFrom}:{})};
 if(!validInstrument(i,artifacts))return json(400,{error:'incompatible or unresolved definition'});
 item=i;
 }else return json(400,{error:'invalid artifact'});
 const u=await db.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:'SET artifacts=list_append(if_not_exists(artifacts,:empty),:one), revision=if_not_exists(revision,:zero)+:inc',ConditionExpression:'attribute_not_exists(revision) OR revision=:rev',ExpressionAttributeValues:{':empty':[],':one':[item],':zero':0,':inc':1,':rev':result.Item?.revision??0},ReturnValues:'ALL_NEW'}));
 return json(200,{artifacts:u.Attributes?.artifacts??[]});
 }catch(e){if((e as Error).name==='ConditionalCheckFailedException')continue;console.error('truthmine storage',(e as Error).name);return json(503,{error:'storage unavailable'})}
 return json(409,{error:'concurrent contribution; retry'});
}
