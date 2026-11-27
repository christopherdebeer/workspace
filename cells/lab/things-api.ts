import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {accept,validId,type Fact} from './client/things/world';
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table=process.env.TABLE_NAME??'';
type Event={headers?:Record<string,string|undefined>;requestContext?:{http?:{method?:string}};body?:string;isBase64Encoded?:boolean};
const json=(statusCode:number,data:unknown)=>({statusCode,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify(data)});
export async function thingsApi(event:Event,room:string){
 if(!validId(room))return json(400,{error:'invalid invitation'});
 if(!table)return json(503,{error:'storage unavailable'});
 const key={pk:'THINGS#'+room,sk:'v1'},method=event.requestContext?.http?.method||'GET';
 if(method!=='GET'&&method!=='POST')return json(405,{error:'method'});
 if(method==='POST'&&event.headers?.origin&&event.headers.origin!=='https://c15r-lab.on.parc.land')return json(403,{error:'origin'});
 let raw:any;
 if(method==='POST'){if(!event.body||event.body.length>4096)return json(400,{error:'size'});try{raw=JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString():event.body)}catch{return json(400,{error:'invalid JSON'})}if(!raw||!validId(raw.id)||!validId(raw.by))return json(400,{error:'invalid identity'})}
 for(let attempt=0;attempt<3;attempt++)try{
 const result=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true})),facts=(result.Item?.facts??[]) as Fact[];
 if(method==='GET')return json(200,{facts});
 if(facts.some(x=>x.id===raw.id))return json(200,{facts});
 if(facts.length>=160)return json(409,{error:'room full'});
 const f=accept(raw,facts,Date.now());if(!f)return json(400,{error:'invalid or unresolved contribution'});
 const u=await db.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:'SET facts=list_append(if_not_exists(facts,:empty),:one), revision=if_not_exists(revision,:zero)+:inc',ConditionExpression:'attribute_not_exists(revision) OR revision=:rev',ExpressionAttributeValues:{':empty':[],':one':[f],':zero':0,':inc':1,':rev':result.Item?.revision??0},ReturnValues:'ALL_NEW'}));
 return json(200,{facts:u.Attributes?.facts??[]});
 }catch(e){if((e as Error).name==='ConditionalCheckFailedException')continue;console.error('things storage',(e as Error).name);return json(503,{error:'storage unavailable'})}
 return json(409,{error:'concurrent contribution; retry'});
}
