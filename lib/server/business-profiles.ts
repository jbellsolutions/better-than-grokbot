import { readFileSync } from 'node:fs';
import { dataPath } from './instance';
import type { BusinessProfile } from '@/lib/business';
import { botChatId, workspaceOf, type AppState, type Bot } from '@/lib/types';
/** Add imported profiles without replacing user-edited roles, conversations or IDs. */
export function reconcileProfiles(state: AppState, instance: string) {
    if (instance === 'default')
        return;
    for (const p of businessCatalog().filter(p => p.instances.includes(instance))) {
        if (state.removedProfiles?.includes(p.id)) continue;
        let b = state.bots.find(b => b.catalogId === p.id || b.id === p.id);
        if (!b) {
            b = { id: p.id, name: p.name, role: p.instructions.split('\n')[0].slice(0, 500), color: '#60A5FA', isMain: false, computerStatus: 'none', computer: 'shared', runsOn: 'cloud', workspaceId: state.workspace };
            state.bots.push(b);
        }
        b.catalogId ??= p.id;
        b.instructions ??= p.instructions;
        b.screenMode ??= p.screen === 'none' ? 'none' : 'optional';
        b.optional ??= p.optional;
        // The imported Ops identity is a lead, including after a rename. Explicit role/visibility edits win.
        if (/^head of operations$/i.test(p.name) && !b.isMain && b.teamRole === undefined && !b.hidden
            && !state.bots.some(other => other.id !== b!.id && workspaceOf(other) === workspaceOf(b!) && other.teamRole === 'operations'))
            b.teamRole = 'operations';
        if (!state.chats.some(c => c.id === botChatId(b!.id)))
            state.chats.push({ id: botChatId(b.id), kind: 'bot', botIds: [b.id], createdAt: Date.now(), typing: [], workspaceId: b.workspaceId });
    }
}
/** The profiles this instance imported, if any (.data/business/current-profiles.json). */
export function businessCatalog(): BusinessProfile[] {
    try {
        const current = JSON.parse(readFileSync(dataPath('business', 'current-profiles.json'), 'utf8'));
        if (!Array.isArray(current) || current.some(p => !/^[a-z0-9][a-z0-9-]{0,79}$/.test(p.id) || typeof p.name !== 'string' || typeof p.instructions !== 'string' || !Array.isArray(p.instances) || !Array.isArray(p.sources)))
            throw Error('Invalid business profiles');
        return current;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return [];
    }
}
export function instructionsFor(b: Bot) {
    if (b.scopeHold) return `Scope hold: ${b.scopeHold} Preserve this profile for historical review. Do not launch or resume its campaigns or routines.\n${b.instructions || b.role}`;
    return b.catalogId ? b.instructions || `Follow the current task as ${b.name}.` : [b.role, b.instructions].filter(Boolean).join('\n');
}
