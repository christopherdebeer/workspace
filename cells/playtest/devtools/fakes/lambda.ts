// Fake Lambda client: an async self-invoke runs the job in-process (devtools only).
export class LambdaClient { constructor(_: unknown) {} async send(c: InvokeCommand) { const payload = JSON.parse(Buffer.from(c.input.Payload).toString()); setTimeout(() => (globalThis as any).__selfInvoke(payload), 0); return {}; } }
export class InvokeCommand { constructor(readonly input: any) {} }
