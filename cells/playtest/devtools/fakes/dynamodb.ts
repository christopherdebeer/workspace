// In-memory stand-ins for @aws-sdk/client-dynamodb + lib-dynamodb (devtools only):
// Get / Put / Query (begins_with, ScanIndexForward, Limit) / Update (SET incl.
// if_not_exists, ADD for numbers and string sets; ConditionExpression attribute_not_exists;
// ReturnValues ALL_NEW) — exactly what lib/store uses.
const table = new Map<string, Map<string, Record<string, unknown>>>();
export const __table = table;
const clone = <T,>(x: T): T => (x instanceof Set ? (new Set(x) as unknown as T) : x && typeof x === 'object' ? (Array.isArray(x) ? (x.map(clone) as unknown as T) : (Object.fromEntries(Object.entries(x).map(([k, v]) => [k, clone(v)])) as T)) : x);
export class DynamoDBClient { constructor(_: unknown) {} }
class Cmd { constructor(readonly input: any) {} }
export class GetCommand extends Cmd {}
export class PutCommand extends Cmd {}
export class QueryCommand extends Cmd {}
export class UpdateCommand extends Cmd {}
function part(pk: string) { if (!table.has(pk)) table.set(pk, new Map()); return table.get(pk)!; }
export const DynamoDBDocumentClient = {
  from: () => ({
    async send(c: Cmd) {
      const i = c.input;
      if (c instanceof PutCommand) { part(i.Item.pk).set(i.Item.sk, clone(i.Item)); return {}; }
      if (c instanceof GetCommand) { const it = table.get(i.Key.pk)?.get(i.Key.sk); return { Item: it ? clone(it) : undefined }; }
      if (c instanceof QueryCommand) {
        const pk = i.ExpressionAttributeValues[':pk'];
        const pre = i.ExpressionAttributeValues[':p'] ?? '';
        let items = [...(table.get(pk)?.entries() ?? [])].filter(([sk]) => sk.startsWith(pre)).sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => clone(v));
        if (i.ScanIndexForward === false) items.reverse();
        if (i.Limit) items = items.slice(0, i.Limit);
        return { Items: items };
      }
      if (c instanceof UpdateCommand) {
        const it = (table.get(i.Key.pk)?.get(i.Key.sk) as Record<string, any>) ?? { ...i.Key };
        const names = i.ExpressionAttributeNames ?? {};
        const cond = /^attribute_not_exists\(([^)]+)\)$/.exec(String(i.ConditionExpression ?? '').trim());
        if (cond && it[names[cond[1].trim()] ?? cond[1].trim()] !== undefined) throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
        const vals = i.ExpressionAttributeValues ?? {};
        const nm = (s: string) => names[s.trim()] ?? s.trim();
        const val = (s: string): any => {
          s = s.trim();
          const m = /^if_not_exists\(([^,]+),\s*([^)]+)\)$/.exec(s);
          if (m) return it[nm(m[1])] ?? vals[m[2].trim()];
          return vals[s];
        };
        const expr: string = i.UpdateExpression;
        const set = /SET (.*?)(?= ADD |$)/.exec(expr)?.[1];
        const add = / ?ADD (.*)$/.exec(expr)?.[1];
        if (set) for (const a of set.split(/,(?![^(]*\))/)) { const [l, r] = a.split('='); it[nm(l)] = val(r); }
        if (add) for (const a of add.split(',')) { const [l, r] = a.trim().split(/\s+/); const v = vals[r]; const k = nm(l); if (v instanceof Set) it[k] = new Set([...(it[k] ?? []), ...v]); else it[k] = (it[k] ?? 0) + v; }
        part(i.Key.pk).set(i.Key.sk, it);
        return i.ReturnValues === 'ALL_NEW' ? { Attributes: clone(it) } : {};
      }
      throw new Error('fake ddb: unsupported command');
    },
  }),
};
