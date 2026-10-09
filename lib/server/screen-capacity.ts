import { dirname, join } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registryPath, instanceId } from './instance';
export const SCREEN_CAPACITY = 4;
const root = () => join(dirname(registryPath()), 'screen-leases');
type Owner = {
    instance: string;
    turn: string;
};
const owner = (slot: number): Owner | null => { try {
    return JSON.parse(readFileSync(join(root(), String(slot), 'owner.json'), 'utf8'));
}
catch {
    return null;
} };
/** An atomic directory lease spans both coordinator processes. Never reclaim a live remote job on a timer. */
export function claimScreen(turn: string): number | null {
    mkdirSync(root(), { recursive: true, mode: 0o700 });
    for (let slot = 0; slot < SCREEN_CAPACITY; slot++) {
        const current = owner(slot);
        if (current?.instance === instanceId() && current.turn === turn)
            return slot;
        try {
            mkdirSync(join(root(), String(slot)), { mode: 0o700 });
            writeFileSync(join(root(), String(slot), 'owner.json'), JSON.stringify({ instance: instanceId(), turn }), { mode: 0o600 });
            return slot;
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                throw e;
        }
    }
    return null;
}
export function releaseScreen(turn: string) { for (let slot = 0; slot < SCREEN_CAPACITY; slot++) {
    const current = owner(slot);
    if (current?.instance === instanceId() && current.turn === turn)
        rmSync(join(root(), String(slot)), { recursive: true });
} }
export function capacity() { let used = 0; for (let slot = 0; slot < SCREEN_CAPACITY; slot++)
    if (owner(slot))
        used++; return { limit: SCREEN_CAPACITY, used, scope: 'both business computers' }; }
export function ownedScreenTurns() {
    return Array.from({ length: SCREEN_CAPACITY }, (_, slot) => owner(slot))
        .filter((item): item is Owner => item?.instance === instanceId())
        .map(item => item.turn);
}
