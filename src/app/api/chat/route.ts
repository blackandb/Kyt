import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/auth';
import { env } from '@/lib/env';
import { chat, type ChatTurn } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!env.aiConfigured()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set in Vercel.' }, { status: 503 });
  }

  let history: ChatTurn[] = [];
  try {
    const body = (await request.json()) as { messages?: ChatTurn[] };
    history = (body.messages || []).filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    );
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }

  try {
    return NextResponse.json(await chat(history));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Assistant failed' }, { status: 502 });
  }
}
