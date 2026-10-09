import catalog from '@/lib/business-profiles.json' with { type: 'json' };
import currentCatalog from '@/lib/grokbot-current-profiles.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { dataPath } from './instance';
import { botChatId, type AppState, type Bot } from '@/lib/types';
/** Add spec identities without replacing user-edited roles, conversations or IDs. */
export function reconcileProfiles(state: AppState, instance: string) {
    if (instance === 'default')
        return;
    const profiles = businessCatalog();
    const aliases: Record<string, string> = { 'email-writer': 'writer', 'revenue-prospector': 'prospector' };
    for (const p of profiles.filter(p => p.instances.includes(instance))) {
        const previous = catalog.find(old => old.sources[0]?.id === p.sources[0]?.id);
        if (state.removedProfiles?.includes(p.id) || previous && state.removedProfiles?.includes(previous.id)) continue;
        let b = state.bots.find(b => b.catalogId === p.id || b.id === p.id || b.id === aliases[p.id])
            ?? (previous && state.bots.find(b => b.catalogId === previous.id || b.id === previous.id || b.id === aliases[previous.id]));
        if (b && previous && p.id !== previous.id) {
            // Preserve user edits and existing IDs/history while adopting the verified source identity.
            if (b.name === previous.name || b.isMain && ['AI Guy', 'Revenue Partners'].includes(b.name)) b.name = p.name;
            if (b.instructions === previous.instructions) b.instructions = p.instructions;
            if (b.role === previous.instructions.split('\n')[0].slice(0, 500)) b.role = `${p.name}: research and drafts`;
            b.catalogId = p.id;
        }
        if (!b) {
            b = { id: p.id, name: p.name, role: p.id.startsWith('grok-') ? `${p.name}: research and drafts` : p.instructions.split('\n')[0].slice(0, 500), color: '#60A5FA', isMain: false, computerStatus: 'none', computer: 'shared', runsOn: 'cloud', workspaceId: state.workspace };
            state.bots.push(b);
        }
        if (p.id.startsWith('grok-') && b.role === p.instructions.split('\n')[0].slice(0, 500)) b.role = `${p.name}: research and drafts`;
        b.catalogId ??= p.id;
        b.instructions ??= p.instructions;
        b.screenMode ??= p.screen === 'none' ? 'none' : 'optional';
        b.optional ??= p.optional;
        if (/Beehiiv/i.test(p.name)) b.scopeHold = 'Outside the current SMTP newsletter and Instantly cold email scope (October 7 instruction).';
        if (!state.chats.some(c => c.id === botChatId(b!.id)))
            state.chats.push({ id: botChatId(b.id), kind: 'bot', botIds: [b.id], createdAt: Date.now(), typing: [], workspaceId: b.workspaceId });
    }
}
export function businessCatalog(): typeof catalog {
    try {
        const current = JSON.parse(readFileSync(dataPath('business', 'current-profiles.json'), 'utf8'));
        if (!Array.isArray(current) || current.some(p => !/^grok-[a-f0-9-]{36}$/.test(p.id) || typeof p.name !== 'string' || typeof p.instructions !== 'string' || !Array.isArray(p.instances) || !Array.isArray(p.sources)))
            throw Error('Invalid current source profiles');
        return current;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return currentCatalog;
    }
}
export function instructionsFor(b: Bot) {
    if (b.scopeHold) return `Scope hold: ${b.scopeHold} Preserve this profile for historical review. Do not launch or resume its campaigns or routines.\n${b.instructions || b.role}`;
    const proposal = catalog.find(p => p.id === b.catalogId);
    if (proposal && b.instructions === proposal.instructions)
        return `Your role is ${b.name}. Follow the current user task. The archived profile proposal has not been adopted as current instructions. Recent Grok Bot records are reference material; no inherited schedules or permissions are active.`;
    return b.catalogId?.startsWith('grok-') ? b.instructions || `Follow the current task as ${b.name}.` : [b.role, b.instructions].filter(Boolean).join('\n');
}
