import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dataPath, instanceId } from './instance';
import type { BusinessContact, BusinessDocument, BusinessManifest, ScreenRequest } from '@/lib/business';
function read<T>(name: string, fallback: T): T { try {
    return JSON.parse(readFileSync(dataPath('business', name), 'utf8'));
}
catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return fallback;
    throw e;
} }
function write(name: string, value: unknown) { mkdirSync(dataPath('business'), { recursive: true, mode: 0o700 }); const temp = dataPath('business', name + '.tmp'); writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); renameSync(temp, dataPath('business', name)); }
export function assertBusiness() { if (instanceId() === 'default')
    throw Error('Choose a business instance first'); }
export const contacts = () => read<BusinessContact[]>('contacts.json', []);
export const documents = () => read<BusinessDocument[]>('documents.json', []);
export const manifest = () => read<BusinessManifest | null>('manifest.json', null);
export const reconciliation = () => read<import('@/lib/business').BusinessReconciliation | null>('reconciliation.json', null);
export const recentReview = () => read<import('@/lib/business').RecentReview | null>('recent-review.json', null);
export function recentSourceText(id: string) {
    if (!/^(?:[a-f0-9-]{36}|routines)$/.test(id) || !recentReview()?.records.some(r => r.id === id))
        throw Error('No such recent source record');
    return readFileSync(dataPath('business', 'recent', id + '.txt'), 'utf8');
}
export const screenRequests = () => read<ScreenRequest[]>('screen-requests.json', []);
export function documentText(id: string) { if (!documents().some(d => d.id === id) || !/^[a-f0-9]{32}$/.test(id))
    throw Error('No such document'); return readFileSync(dataPath('business', 'documents', id + '.txt'), 'utf8'); }
export function addScreenRequest(reason: string, requested: number, requestId?: string) {
    assertBusiness();
    if (!reason.trim() || reason.length > 1000 || !Number.isInteger(requested) || requested < 1 || requested > 16)
        throw Error('Specify 1–16 additional screens and a reason');
    const records = screenRequests();
    if (requestId && records.some(r => r.id === requestId))
        return records.find(r => r.id === requestId)!;
    const request = { id: requestId ?? randomUUID(), reason: reason.trim(), requested, at: Date.now(), status: 'pending' as const };
    records.push(request);
    write('screen-requests.json', records);
    return request;
}
export function upsertContact(input: {
    name?: string;
    email?: string;
    company?: string;
    suppressed?: boolean;
    source?: string;
}) {
    assertBusiness();
    const email = input.email?.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw Error('Use a valid email');
    const name = input.name?.trim().slice(0, 200) || '';
    if (!email && !name)
        throw Error('Name or email required');
    const records = contacts(), key = email || [name, input.company || ''].join('|');
    const id = createHash('sha256').update(key).digest('hex').slice(0, 32);
    let record = records.find(c => c.id === id || !!email && c.email === email);
    if (!record) {
        record = { id, name, email, company: input.company?.slice(0, 200), suppressed: false, sources: [], updatedAt: Date.now() };
        records.push(record);
    }
    record.name = name || record.name;
    record.suppressed ||= input.suppressed === true;
    record.sources = [...new Set([...record.sources, (input.source || 'Manual entry').slice(0, 300)])];
    record.updatedAt = Date.now();
    write('contacts.json', records);
    return record;
}
