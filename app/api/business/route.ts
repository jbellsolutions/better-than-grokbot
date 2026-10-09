import { addScreenRequest, assertBusiness, contacts, documentText, documents, manifest, reconciliation, recentReview, recentSourceText, screenRequests, upsertContact } from '@/lib/server/business-records';
import { businessCatalog } from '@/lib/server/business-profiles';
import { capacity } from '@/lib/server/screen-capacity';
import { instanceId } from '@/lib/server/instance';
import { bot, getState } from '@/lib/server/store';
import { orgo } from '@/lib/server/orgo';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    try {
        assertBusiness();
        const query = new URL(request.url).searchParams;
        if (query.has('recentSource'))
            return Response.json({ text: recentSourceText(query.get('recentSource')!) });
        if (query.has('history'))
            return Response.json(await orgo.hermes({ action: 'history', q: query.get('q') || '', page: Number(query.get('page')) || 0, sessionId: query.get('sessionId') || undefined }));
        if (query.has('files'))
            return Response.json(await orgo.hermes({ action: 'files', root: query.get('root') || 'workspace', path: query.get('path') || '' }));
        if (query.has('document'))
            return Response.json({ text: documentText(query.get('document')!) });
        if (query.has('snapshot')) {
            const s = getState().sessions.find(s => s.id === query.get('snapshot'));
            if (!s?.hermesTurn || s.taskMode !== 'screen')
                return Response.json({ error: 'No active screen' }, { status: 404 });
            const result = await orgo.hermes({ action: 'snapshot', turn: s.hermesTurn });
            if (!result.image)
                throw Error(result.error || 'Screen is unavailable');
            return new Response(Buffer.from(result.image, 'base64'), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
        }
        const q = (query.get('q') || '').toLowerCase();
        const page = Math.max(0, Math.min(100000, Number(query.get('page')) || 0));
        const contactRows = contacts().filter(c => c.sources.some(source => !source.startsWith('grokbot:'))).filter(c => JSON.stringify(c).toLowerCase().includes(q));
        const docs = documents().filter(d => [d.title, d.source].join(' ').toLowerCase().includes(q));
        return Response.json({ reconciliation: reconciliation(), recentReview: recentReview(), capacity: capacity(), profiles: businessCatalog().filter(p => p.instances.includes(instanceId())), requests: screenRequests(), manifest: manifest(), contacts: contactRows.slice(page * 50, (page + 1) * 50), contactCount: contactRows.length, documents: docs.slice(page * 50, (page + 1) * 50), documentCount: docs.length, jobs: getState().sessions.filter(s => s.runtime === 'hermes').slice(-100).reverse() });
    }
    catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
    }
}
export async function POST(request: Request) {
    try {
        assertBusiness();
        const body = await request.json();
        if (body.action === 'request-screens')
            return Response.json(addScreenRequest(String(body.reason || ''), body.requested));
        if (body.action === 'contact')
            return Response.json(upsertContact(body));
        if (body.action === 'profile') {
            const b = bot(body.botId);
            if (!b?.catalogId)
                throw Error('No such spec profile');
            const { update } = await import('@/lib/server/store');
            if (typeof body.instructions !== 'string' || body.instructions.length > 12000)
                throw Error('Instructions must be 12,000 characters or fewer');
            update(() => { b.instructions = body.instructions; });
            return Response.json({ ok: true });
        }
        throw Error('Unknown business action');
    }
    catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 400 });
    }
}
