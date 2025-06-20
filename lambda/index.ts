import { DynamoDB } from 'aws-sdk';

const db = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME ?? '';

export async function handler(event: any): Promise<any> {
  console.log('Request:', event);
  await db.put({
    TableName: TABLE_NAME,
    Item: {
      id: new Date().toISOString(),
      message: 'Hello from Lambda',
    },
  }).promise();
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, event }),
  };
}
