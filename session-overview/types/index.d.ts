export type Row = {
    id: string
    title: string
    cwd: string
    last: number
    project: string
    area: string
}

declare module 'claude-code' {
    interface PluginState {
        'session-overview': {
            query: Shaped<string>
            days: Shaped<string>
            closedAreas: Shaped<string[]>
            closedProjects: Shaped<string[]>
            expandedProjects: Shaped<string[]>
            rev: Shaped<number>
        }
    }
}
