/** Minimal entry for CDK synth tests — NodejsFunction needs a real file to bundle. */
export const handler = async (): Promise<{ statusCode: number; body: string }> => ({
  statusCode: 200,
  body: '{}',
});
