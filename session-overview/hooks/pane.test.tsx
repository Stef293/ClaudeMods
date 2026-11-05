import { expect, test } from 'claude-code/testing'

const PANE = {
    plugin: 'session-overview',
    component: 'Pane',
    requestId: 'session-overview',
    props: {
        title: 'Sessions',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
    },
} as const

const SESSION = JSON.stringify({
    sessionId: 'local_abc',
    title: 'Mein Test-Chat',
    cwd: 'D:\\Work\\projecta',
    lastActivityAt: 1000,
    isArchived: false,
})

test('an opened project lists its chats', async ($, on) => {
    on('env.get', () => ({ value: 'C:\\L' }))
    on('clock.now', () => ({ value: 2000 }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('fs.read', (_, e) => ({
        value: e.path.endsWith('areas.json')
            ? JSON.stringify({ roots: ['D:\\Work'], areas: [{ name: 'Work', paths: ['d:\\work'] }], fallbackArea: 'Sonstiges' })
            : SESSION,
    }))
    on('fs.list', (_, e) => {
        const dirs: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
            'C:\\L\\Claude-Data': [{ name: 'inst', kind: 'dir' }],
            'C:\\L\\Claude-Data\\inst\\claude-code-sessions': [{ name: 'acc', kind: 'dir' }],
            'C:\\L\\Claude-Data\\inst\\claude-code-sessions\\acc': [{ name: 'org', kind: 'dir' }],
            'C:\\L\\Claude-Data\\inst\\claude-code-sessions\\acc\\org': [{ name: 'local_abc.json', kind: 'file' }],
        }

        return { value: (dirs[e.path] ?? []).map(x => ({ ...x, size: 1, mtimeMs: 1, isLink: false })) }
    })
    on('state.get', (_, e) => {
        const values: Record<string, unknown> = { closedProjects: { shape: 'closed-projects-1', value: [] } }

        return { value: { value: values[e.key], version: 1 } }
    })

    const started: string[][] = []
    on('process.run', (_, e) => {
        started.push([...e.argv])

        return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    for (const surface of ['desktop', 'terminal'] as const) {
        const ui = await $.ui.mount({ ...PANE, surface })

        expect(await ui.find({ type: 'Text', text: /Mein Test-Chat/ })).toBeTruthy()
        await ui.press({ key: 's:local_abc' })
        await ui.unmount()
    }

    expect(started.length).toBe(2)
    expect(started[0]?.at(-1)).toBe('claude://claude.ai/epitaxy/local_abc')
})
