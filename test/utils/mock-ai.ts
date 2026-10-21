import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MOCK_AI_PORT } from './constants';

type ChatMessage = { role: string; content: string };

export type AIRequest =
    | { kind: 'organize'; messages: ChatMessage[]; text: string }
    | { kind: 'define'; messages: ChatMessage[]; word: string; context: string }
    | { kind: 'reference'; messages: ChatMessage[]; passage: string; context: string }
    | { kind: 'ask'; messages: ChatMessage[]; prompt: string; context: string };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function classify(messages: ChatMessage[]): AIRequest {
    const last = messages[messages.length - 1].content;
    if (messages[0].role === 'system' && messages[0].content.includes('markdown syntax')) {
        return { kind: 'organize', messages, text: last.split('\n\n').slice(1).join('\n\n') };
    }
    const context = messages[0].content.split('\n\n').slice(1).join('\n\n');
    const define = last.match(/^What does "(.*)" mean in this context/);
    if (define) return { kind: 'define', messages, word: define[1], context };
    const reference = last.match(/^Find the bibliographic reference[\s\S]*?"""([\s\S]*?)"""/);
    if (reference) return { kind: 'reference', messages, passage: reference[1], context };
    return { kind: 'ask', messages, prompt: last, context };
}

/**
 * A stand in for the local OpenAI compatible model server.
 * Answers are deterministic and streamed in small chunks, like the real one.
 */
export class MockAI {
    readonly endpoint = `http://localhost:${MOCK_AI_PORT}`;
    /** The chat requests received, in order */
    requests: AIRequest[] = [];
    /** The id of the loaded model. null simulates a server with no model loaded */
    loadedModel: string | null = 'mock-model';
    /** Status code for the chat requests. Anything but 200 simulates a failure */
    chatStatus = 200;
    /** When false, the models status endpoint is missing, like on servers that don't report the loaded model */
    modelsStatusAvailable = true;
    /** How many pings (plain requests to check the server is up) were received */
    pings = 0;
    /** Overrides the answer given when a reference is looked for. Receives the selected passage */
    referenceAnswer?: (passage: string) => string;
    /** Overrides the answer given to the questions. Receives the question */
    askAnswer?: (prompt: string) => string;
    /** Wait before answering the status of the models */
    statusDelayMs = 0;
    /** Wait between the streamed chunks */
    chunkDelayMs = 0;
    private server?: Server;

    answerFor(request: AIRequest) {
        switch (request.kind) {
            case 'organize':
                return `# Texto organizado\n\n${request.text}`;
            case 'define':
                return `Definição mock de ${request.word}`;
            case 'reference':
                return this.referenceAnswer?.(request.passage) ?? `- Referência mock para: ${request.passage}`;
            case 'ask':
                return this.askAnswer?.(request.prompt) ?? `Resposta mock para: ${request.prompt}`;
        }
    }

    requestsOfKind<K extends AIRequest['kind']>(kind: K) {
        return this.requests.filter((request): request is Extract<AIRequest, { kind: K }> => request.kind === kind);
    }

    async start() {
        this.server = createServer((req, res) => this.handle(req, res));
        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(MOCK_AI_PORT, '127.0.0.1', resolve);
        });
    }

    /** Takes the server offline, so requests are refused like when the real one isn't running */
    async stop() {
        const server = this.server;
        if (!server) return;
        this.server = undefined;
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }

    private async handle(req: IncomingMessage, res: ServerResponse) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') return res.writeHead(204).end();

        if (req.method === 'GET' && req.url === '/v1/models') {
            this.pings += 1;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ data: [] }));
        }

        if (req.method === 'GET' && req.url === '/v1/models/status') {
            if (!this.modelsStatusAvailable) return res.writeHead(404).end();
            if (this.statusDelayMs) await sleep(this.statusDelayMs);
            res.setHeader('Content-Type', 'application/json');
            const models = this.loadedModel ? [{ id: this.loadedModel, loaded: true }] : [{ id: 'unloaded-model', loaded: false }];
            return res.end(JSON.stringify({ models }));
        }

        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const { messages } = JSON.parse(Buffer.concat(chunks).toString()) as { messages: ChatMessage[] };
            const request = classify(messages);
            this.requests.push(request);

            if (this.chatStatus !== 200) return res.writeHead(this.chatStatus).end();

            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const words = this.answerFor(request).split(/(?<=\s)/);
            for (let i = 0; i < words.length; i += 3) {
                if (this.chunkDelayMs) await sleep(this.chunkDelayMs);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words.slice(i, i + 3).join('') } }] })}\n\n`);
            }
            return res.end('data: [DONE]\n\n');
        }

        res.writeHead(404).end();
    }
}
