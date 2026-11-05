# ClaudeMods

Mods for the Claude Code desktop app: small plugins that change or extend its interface.

## session-overview

A pane next to the chat that lists all Claude Code sessions, grouped by area and project.

- Three levels: area, project, session. Areas and projects fold open and closed.
- Search by title, project or area, and a time filter (all, today, 7 days, 30 days).
- A "recently active" section and a colour dot per session that shows how fresh it is.
- A click on a session opens it. The pane opens by itself at the start of every session; `/sessions` opens it again.
- Each project shows its newest sessions first, the rest sits behind "+ n more".

The mod reads the session files the desktop app keeps in `%LOCALAPPDATA%\Claude-Data\...\claude-code-sessions`. It changes nothing there.

### Configure

`session-overview/areas.json` maps working folders to areas:

- `roots`: parent folders; the first folder below a root is the project name.
- `areas`: first match wins. `projects` (exact, lower case), `paths` (start of the working folder, lower case) and `titles` (words in the title, only for sessions without a folder). `color` is a theme colour: `success`, `suggestion`, `claude`, `warning`, `error`, `inactive`.
- `fallbackArea` and `fallbackColor` for everything else.

The file in this repository holds example values. Adapt them to your own folders.

### Install

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `Stef293/ClaudeMods`, then Add plugin `session-overview`.

In a terminal session:

```
/plugin install session-overview --marketplace Stef293/ClaudeMods
```

From a shell:

```
claude plugin install session-overview --marketplace Stef293/ClaudeMods
```

### Known limits

- The desktop app refuses a pane drawing that is too large, so a project shows only its newest six sessions until expanded.
- The location of the session files may change with an app update.
- Windows only for opening a session by click (it uses the `claude://` protocol handler).

### Test

```
claude plugin test session-overview
claude plugin validate .
```
