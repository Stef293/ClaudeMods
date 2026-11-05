import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Row } from '../types'

const PANE = 'session-overview'
const NO_FOLDER = '(ohne Ordner)'
const DAY_MS = 86_400_000
// A project shows this many chats until it is expanded: a drawing with every chat at once is refused.
const PROJECT_LIMIT = 6

type AreaRule = {
    name: string
    projects?: string[]
    paths?: string[]
    titles?: string[]
    color?: string
}

type Config = {
    roots: string[]
    areas: AreaRule[]
    fallbackArea: string
    fallbackColor: string
}

const DEFAULT_CONFIG: Config = {
    roots: ['D:\\Work', 'D:\\Private'],
    areas: [],
    fallbackArea: 'Sonstiges',
    fallbackColor: 'inactive',
}

// Tags change when the stored shape changes: an older stored value is then read as the initial one.
const query = atom({ plugin: 'session-overview', key: 'query' } as const, '', { shape: 'query-1' })
const days = atom({ plugin: 'session-overview', key: 'days' } as const, '0', { shape: 'days-1' })
const closedAreas = atom({ plugin: 'session-overview', key: 'closedAreas' } as const, [], {
    shape: 'closed-areas-1',
})
const closedProjects = atom({ plugin: 'session-overview', key: 'closedProjects' } as const, [], {
    shape: 'closed-projects-1',
})
const expandedProjects = atom({ plugin: 'session-overview', key: 'expandedProjects' } as const, [], {
    shape: 'expanded-projects-1',
})
const rev = atom({ plugin: 'session-overview', key: 'rev' } as const, 0, { shape: 'rev-1' })

const DAY_CHIPS = [
    { value: '0', label: 'Alle' },
    { value: '1', label: 'Heute' },
    { value: '7', label: '7 Tage' },
    { value: '30', label: '30 Tage' },
]

type CacheEntry = { mtimeMs: number; raw: Omit<Row, 'project' | 'area'> | null }


// Module variables start over on a reload; the cache only saves re-reading unchanged files.
const cache = new Map<string, CacheEntry>()
let config: Config = DEFAULT_CONFIG

async function loadConfig($: EngineInterface): Promise<void> {
    try {
        const text = await $.fs.read(`${$.plugin.root}/areas.json`)
        const parsed = JSON.parse(text as string) as Partial<Config>
        config = {
            roots: parsed.roots ?? DEFAULT_CONFIG.roots,
            areas: parsed.areas ?? [],
            fallbackArea: parsed.fallbackArea ?? DEFAULT_CONFIG.fallbackArea,
            fallbackColor: parsed.fallbackColor ?? DEFAULT_CONFIG.fallbackColor,
        }
    } catch {
        config = DEFAULT_CONFIG
    }
}

function projectOf(cwd: string): string {
    const normalized = cwd.replace(/\//g, '\\')
    const lower = normalized.toLowerCase()

    if (lower.includes('scratch-workspaces')) {
        return NO_FOLDER
    }

    for (const root of config.roots) {
        const prefix = root.toLowerCase() + '\\'

        if (lower.startsWith(prefix)) {
            return normalized.slice(prefix.length).split('\\')[0] || root
        }
    }

    const parts = normalized.split('\\').filter(Boolean)

    return parts[parts.length - 1] ?? cwd
}

function areaOf(project: string, cwd: string, title: string): string {
    const lowerProject = project.toLowerCase()
    const lowerCwd = cwd.replace(/\//g, '\\').toLowerCase()
    const lowerTitle = title.toLowerCase()
    const hasNoFolder = project === NO_FOLDER

    for (const rule of config.areas) {
        const isProject = (rule.projects ?? []).includes(lowerProject)
        const isPath = !hasNoFolder && (rule.paths ?? []).some(p => lowerCwd.startsWith(p))
        const isTitle = hasNoFolder && (rule.titles ?? []).some(t => lowerTitle.includes(t))

        if (isProject || isPath || isTitle) {
            return rule.name
        }
    }

    return config.fallbackArea
}

async function findSessionFiles($: EngineInterface): Promise<{ path: string; mtimeMs: number }[]> {
    const localAppData = await $.env.get('LOCALAPPDATA')

    if (!localAppData) {
        return []
    }

    const files: { path: string; mtimeMs: number }[] = []
    const dataRoot = `${localAppData}\\Claude-Data`
    const installs = await $.fs.list(dataRoot).catch(() => [])

    for (const install of installs) {
        if (install.kind !== 'dir') {
            continue
        }

        const sessionsRoot = `${dataRoot}\\${install.name}\\claude-code-sessions`
        const accounts = await $.fs.list(sessionsRoot).catch(() => [])

        for (const account of accounts) {
            const orgs = await $.fs.list(`${sessionsRoot}\\${account.name}`).catch(() => [])

            for (const org of orgs) {
                const dir = `${sessionsRoot}\\${account.name}\\${org.name}`
                const entries = await $.fs.list(dir).catch(() => [])

                for (const entry of entries) {
                    if (entry.kind === 'file' && /^local_.*\.json$/.test(entry.name)) {
                        files.push({ path: `${dir}\\${entry.name}`, mtimeMs: entry.mtimeMs })
                    }
                }
            }
        }
    }

    return files
}

async function loadRows($: EngineInterface): Promise<Row[]> {
    await loadConfig($)

    if (cache.size === 0) {
        const stored = (await $.store.get('rows-v1')) as Record<string, CacheEntry> | undefined

        for (const [path, entry] of Object.entries(stored ?? {})) {
            cache.set(path, entry)
        }
    }

    const files = await findSessionFiles($)
    const seen = new Set<string>()

    await Promise.all(
        files.map(async file => {
            seen.add(file.path)
            const cached = cache.get(file.path)

            if (cached && cached.mtimeMs === file.mtimeMs) {
                return
            }

            try {
                const text = (await $.fs.read(file.path)) as string
                const data = JSON.parse(text)
                const isUsable = typeof data.sessionId === 'string' && !data.isArchived

                cache.set(file.path, {
                    mtimeMs: file.mtimeMs,
                    raw: isUsable
                        ? {
                              id: data.sessionId,
                              title: String(data.title ?? data.sessionId),
                              cwd: String(data.cwd ?? ''),
                              last: Number(data.lastActivityAt ?? data.createdAt ?? 0),
                          }
                        : null,
                })
            } catch {
                cache.set(file.path, { mtimeMs: file.mtimeMs, raw: null })
            }
        }),
    )

    for (const path of [...cache.keys()]) {
        if (!seen.has(path)) {
            cache.delete(path)
        }
    }

    await $.store.set('rows-v1', Object.fromEntries(cache))

    const rows: Row[] = []

    for (const entry of cache.values()) {
        if (entry.raw === null) {
            continue
        }

        const project = projectOf(entry.raw.cwd)
        rows.push({ ...entry.raw, project, area: areaOf(project, entry.raw.cwd, entry.raw.title) })
    }

    return rows
}

function formatAge(last: number, now: number): string {
    const minutes = Math.floor((now - last) / 60_000)

    if (minutes < 1) {
        return 'gerade eben'
    }

    if (minutes < 60) {
        return `vor ${minutes} Min`
    }

    const hours = Math.floor(minutes / 60)

    if (hours < 24) {
        return `vor ${hours} Std`
    }

    const daysAgo = Math.floor(hours / 24)

    if (daysAgo === 1) {
        return 'gestern'
    }

    if (daysAgo < 14) {
        return `vor ${daysAgo} Tagen`
    }

    const date = new Date(last)

    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`
}

// The desktop surface draws no claude:// link, so the Windows protocol handler opens the session.
async function openSession($: EngineInterface, id: string): Promise<void> {
    try {
        const result = await $.process.run(['cmd.exe', '/c', 'start', '', `claude://claude.ai/epitaxy/${id}`])

        if (result.exitCode !== 0) {
            $.ui.toast(`Session konnte nicht geöffnet werden (Code ${result.exitCode})`)
        }
    } catch {
        $.ui.toast('Session konnte nicht geöffnet werden')
    }
}

function colorOf(area: string): string {
    return config.areas.find(rule => rule.name === area)?.color ?? config.fallbackColor
}

function freshnessColor(last: number, now: number): string {
    const age = now - last

    if (age < 3_600_000) {
        return 'success'
    }

    return age < DAY_MS ? 'suggestion' : 'inactive'
}

function toggle(list: readonly string[], key: string): string[] {
    return list.includes(key) ? list.filter(item => item !== key) : [...list, key]
}

export const register: Register = on => {
    on('session.start', async ($, e, next) => {
        await $.command.register({
            name: 'sessions',
            description: 'Zeigt alle Sessions nach Bereich und Projekt gruppiert in einem Pane',
        })
        void $.ui.open({ id: PANE, title: 'Sessions' })

        return next(e)
    })

    on('command.run', { command: 'sessions' }, async $ => {
        await $.ui.open({ id: PANE, title: 'Sessions' })

        return { text: 'Session-Übersicht geöffnet.' }
    })

    on('turn.complete', async ($, e, next) => {
        await update($, rev, n => n + 1)

        return next(e)
    })

    on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
        const elements = $.ui.resolve(e)
        const { Text: ErrorText } = elements

        try {
            const { Box, Text, Button } = elements
            // Not every surface draws a text field; those draw the list without it.
            const Input = 'Input' in elements ? elements.Input : undefined

            await read($, rev)

            const queryText = await read($, query)
            const q = queryText.trim().toLowerCase()
            const dayFilter = await read($, days)
            const closed = await read($, closedAreas)
            const closedByUser = await read($, closedProjects)
            const expandedList = await read($, expandedProjects)
            const now = await $.clock.now()
            const rows = await loadRows($)

            const limit = Number(dayFilter) > 0 ? now - Number(dayFilter) * DAY_MS : 0
            const isSearching = q.length > 0
            const visible = rows
                .filter(row => row.last >= limit)
                .filter(
                    row =>
                        !isSearching ||
                        row.title.toLowerCase().includes(q) ||
                        row.project.toLowerCase().includes(q) ||
                        row.area.toLowerCase().includes(q),
                )
                .sort((a, b) => b.last - a.last)

            const areaNames = [...config.areas.map(a => a.name), config.fallbackArea]
            const byArea = new Map<string, Map<string, Row[]>>()

            for (const row of visible) {
                const projects = byArea.get(row.area) ?? new Map<string, Row[]>()
                const list = projects.get(row.project) ?? []

                list.push(row)
                projects.set(row.project, list)
                byArea.set(row.area, projects)
            }

            const orderedAreas = [
                ...areaNames.filter(name => byArea.has(name)),
                ...[...byArea.keys()].filter(name => !areaNames.includes(name)),
            ]
            const todayCount = rows.filter(row => now - row.last < DAY_MS).length
            const recent = isSearching ? [] : visible.slice(0, 5)

                        const renderSession = (row: Row, isIndented: boolean, showProject: boolean) => {
                const keyPrefix = showProject ? 'recent' : 'row'
                const button = (
                    <Button key={`${showProject ? 'r' : 's'}:${row.id}`} plain onPress={() => openSession($, row.id)}>
                        <Text>{row.title}</Text>
                    </Button>
                )

                return (
                    <Box
                        key={`${keyPrefix}:${row.id}`}
                        justifyContent="space-between"
                        marginLeft={isIndented ? 3 : 0}
                        paddingY="xs"
                    >
                        <Box>
                            <Text color={freshnessColor(row.last, now)}>● </Text>
                            {button}
                            {showProject && row.project !== NO_FOLDER && <Text dimColor> · {row.project}</Text>}
                        </Box>
                        <Text dimColor> {formatAge(row.last, now)}</Text>
                    </Box>
                )
            }

            return (
                <Box flexDirection="column" paddingX={1} gap={1}>
                    <Box flexDirection="column">
                        <Text bold>
                            Sessions
                        </Text>
                        <Text dimColor>
                            {rows.length} gesamt · {todayCount} heute aktiv
                            {visible.length !== rows.length ? ` · ${visible.length} gefiltert` : ''}
                        </Text>
                    </Box>

                    {Input && (
                        <Input
                            key="q"
                            placeholder="Suchen in Titel, Projekt, Bereich"
                            value={queryText}
                            onInput={(value: string) => update($, query, () => value)}
                            onSubmit={() => undefined}
                        />
                    )}

                    <Box justifyContent="space-between">
                        <Box gap={1}>
                            {DAY_CHIPS.map(chip => (
                                <Button key={`d:${chip.value}`} plain onPress={() => update($, days, () => chip.value)}>
                                    <Text
                                        underline={dayFilter === chip.value}
                                        dimColor={dayFilter !== chip.value}
                                        bold={dayFilter === chip.value}
                                    >
                                        {` ${chip.label} `}
                                    </Text>
                                </Button>
                            ))}
                        </Box>
                        <Box gap={1}>
                            <Button key="collapse" plain dimColor onPress={() => update($, closedAreas, () => orderedAreas)}>
                                Alle zu
                            </Button>
                            <Button key="expand" plain dimColor onPress={() => update($, closedAreas, () => [])}>
                                Alle auf
                            </Button>
                            <Button key="refresh" plain dimColor onPress={() => update($, rev, n => n + 1)}>
                                ↻
                            </Button>
                        </Box>
                    </Box>

                    {rows.length === 0 && <Text dimColor>Keine Session-Daten gefunden.</Text>}
                    {rows.length > 0 && visible.length === 0 && <Text dimColor>Nichts gefunden.</Text>}

                    {recent.length > 0 && (
                        <Box flexDirection="column">
                            <Text dimColor bold>
                                ZULETZT AKTIV
                            </Text>
                            {recent.map(row => renderSession(row, false, true))}
                        </Box>
                    )}

                    {orderedAreas.map(area => {
                        const projects = byArea.get(area) as Map<string, Row[]>
                        const count = [...projects.values()].reduce((sum, list) => sum + list.length, 0)
                        const isAreaOpen = isSearching || !closed.includes(area)
                        const accent = colorOf(area)
                        const orderedProjects = [...projects.entries()].sort(
                            (a, b) => (b[1][0]?.last ?? 0) - (a[1][0]?.last ?? 0),
                        )

                        return (
                            <Box key={`area:${area}`} flexDirection="column">
                                <Box>
                                    <Text color={accent}>● </Text>
                                    <Button
                                        key={`a:${area}`}
                                        plain
                                        onPress={() => update($, closedAreas, list => toggle(list, area))}
                                    >
                                        <Text bold>{area.toUpperCase()}</Text>
                                        <Text dimColor>
                                            {'  '}
                                            {count} {isAreaOpen ? '▾' : '▸'}
                                        </Text>
                                    </Button>
                                </Box>

                                {isAreaOpen &&
                                    orderedProjects.map(([project, list]) => {
                                        const projectKey = `${area}/${project}`
                                        const isProjectOpen = isSearching || !closedByUser.includes(projectKey)
                                        const isExpanded = expandedList.includes(projectKey)
                                        const shownRows = isExpanded ? list : list.slice(0, PROJECT_LIMIT)
                                        const hiddenCount = list.length - shownRows.length

                                        return (
                                            <Box
                                            key={`proj:${projectKey}`}
                                            flexDirection="column"
                                            marginLeft={2}
                                            marginTop="sm"
                                        >
                                                <Button
                                                    key={`p:${projectKey}`}
                                                    plain
                                                    onPress={() =>
                                                        update($, closedProjects, current => toggle(current, projectKey))
                                                    }
                                                >
                                                    <Text dimColor>{isProjectOpen ? '▾' : '▸'} </Text>
                                                    <Text bold>{project}</Text>
                                                    <Text dimColor>
                                                        {'  '}
                                                        {list.length} · {formatAge(list[0]?.last ?? 0, now)}
                                                    </Text>
                                                </Button>

                                                {isProjectOpen && shownRows.map(row => renderSession(row, true, false))}
                                            {isProjectOpen && list.length > PROJECT_LIMIT && (
                                                <Box marginLeft={3}>
                                                    <Button
                                                        key={`m:${projectKey}`}
                                                        plain
                                                        dimColor
                                                        onPress={() =>
                                                            update($, expandedProjects, current =>
                                                                toggle(current, projectKey),
                                                            )
                                                        }
                                                    >
                                                        {isExpanded
                                                            ? 'Weniger anzeigen'
                                                            : `+ ${hiddenCount} weitere anzeigen`}
                                                    </Button>
                                                </Box>
                                            )}
                                            </Box>
                                        )
                                    })}
                            </Box>
                        )
                    })}
                </Box>
            )
        } catch (error) {
            return <ErrorText color="error">Fehler: {String(error)}</ErrorText>
        }
    })
}
