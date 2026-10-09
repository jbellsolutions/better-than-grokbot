export type RecentReview = {
    source: string;
    window: string;
    observedAt: string;
    roster: string[];
    groups: string[];
    routineCount: number;
    enabledSourceRoutines: number;
    records: { id: string; agent: string; group: boolean; entries: number; observedAt: number; sourceKind?: string }[];
    gaps: string[];
};
export type BusinessContact = {
    id: string;
    name: string;
    email?: string;
    company?: string;
    suppressed: boolean;
    sources: string[];
    updatedAt: number;
};
export type BusinessDocument = {
    id: string;
    title: string;
    kind: 'history' | 'file';
    source: string;
    checksum: string;
    bytes: number;
};
export type BusinessManifest = {
    sourceCommit: string;
    importedAt: string;
    counts: {
        documents: number;
        contacts: number;
    };
    gaps: string[];
    excluded: number;
};
export type ScreenRequest = {
    id: string;
    reason: string;
    requested: number;
    at: number;
    status: 'pending' | 'reviewed';
};

export type BusinessReconciliation = {
    source: string; importedAt: string; currentScope: string[]; excludedScope: string[];
    status: string; limitations: string;
    charters: { id: string; title: string; owners: string[]; text: string; status: string }[];
    newsletters: { audience: string; campaign: number; list: number; count: number; status: string }[];
    holds: string[];
};
