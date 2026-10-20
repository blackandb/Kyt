import { currentCodeId } from '@/lib/auth';
import { runCheck } from '@/lib/check';
import { isTronAddress, isTxHash } from '@/lib/tron';
import type { CheckStep } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const owner = await currentCodeId();
  if (!owner) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let query = '';
  let deep = false;
  try {
    const body = (await request.json()) as { query?: string; deep?: boolean };
    query = String(body.query || '').trim();
    deep = body.deep === true;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* client went away */
        }
      };

      const kind = isTronAddress(query) ? 'address' : isTxHash(query) ? 'transaction' : 'invalid';
      send({ t: 'start', kind, query });

      try {
        const result = await runCheck(owner, query, deep, (step: CheckStep) => send({ t: 'step', ...step }));
        send({ t: 'result', result });
      } catch (e) {
        send({ t: 'error', message: e instanceof Error ? e.message : 'Check failed' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no'
    }
  });
}
