# CLIRevenue CLI

# One line. This installs Node if the machine does not have it, then runs
# setup. Nothing else is assumed — no Node, no npm, no framework, no idea
# what your project is.
curl -fsSL https://clirevenue.com/install.sh | sh


Install the CLIRevenue SDK, verify your publisher key, and position your ads
with a visual editor — from your terminal, in your own coding CLI.

```bash
npx clirevenue setup      # wire up the project
npx clirevenue editor     # drag, resize and save
```

## Commands

| Command | What it does |
| --- | --- |
| `clirevenue setup` | Detect the project, install the SDK, verify your key, ask how many coding CLIs you use, give each one its own placement, and wire up activation |
| `clirevenue editor` | Open the visual placement editor |
| `clirevenue integrations list` | Show every CLI integration configured in this project |
| `clirevenue integrations add [target] [key]` | Add an integration. Each one gets its own placement key |
| `clirevenue integrations remove <id>` | Remove an integration from this project. The placement stays on your account |
| `clirevenue add-slot <integration> [label]` | Add another ad slot. Shares that integration's placement key |
| `clirevenue remove-slot <integration> <slot>` | Remove one slot. Other slots and integrations are untouched |
| `clirevenue keybindings status` | What was detected, what is wired up, and what is honestly not supported |
| `clirevenue keybindings install [target]` | Register the activation mechanism for a coding CLI |
| `clirevenue keybindings remove [target]` | Undo it |

## Placement keys: one per integration, shared by its slots

This is the rule worth understanding, because it explains the file layout.

- **One integration owns exactly one placement key.** If you use CLIRevenue
  from VS Code *and* Codex in the same project, each gets its own key, so the
  backend can tell the traffic apart and you are never billed twice for one ad.
- **A slot is a position on a page, not a placement.** Several slots can share
  one integration's key. Three ads on one page, or the same ad shown in three
  places, still cost you one placement.
- **Distinct integrations can never share a key.** The CLI refuses the second
  one and names the integration that already holds it.

Adding a slot never asks the backend for anything, so you cannot accidentally
create a duplicate placement by adding a slot.

### Rendering more than one slot

The generated components take an optional `slotId`. Without it a component
renders the integration's first slot, which is all you need for one ad:

```jsx
<CLIRevenueAd placementKey="vscode-1" />
```

To place several slots on one key, name each:

```jsx
<CLIRevenueAd placementKey="vscode-1" slotId="slot-1" />
<CLIRevenueAd placementKey="vscode-1" slotId="slot-2" />
```

Vue and Svelte components take the same `slotId` prop. Static HTML needs
nothing — the generated script mounts every enabled slot it finds.

## Setup

`setup` detects your project, installs `@clirevenue/sdk`, verifies your publishable
key, and stops. It does **not** ask you to pick a placement or an ad size — those
are visual decisions, and you make them in the editor, not from a list in your
terminal.

It then asks how many coding CLIs will use CLIRevenue here, provisions one
placement key per integration, and registers whatever activation mechanism each
of them genuinely supports.

If your publisher has no placement yet, `setup` creates one for you through
`POST /cli/placements`. You do not need to visit the dashboard first. If you
already have a placement, that one is used — setup never gives you a second
placement for an ad you already have.

Before it reports success, setup reads the placements back from the API and
checks that every one your project points at is really there. A placement that
is missing is a failure, not a warning: "setup complete" over a configuration
that cannot serve an ad is the one thing this command must never print.

Running `setup` again is safe and changes nothing. It reuses the placement and
the ad slot your project already has, so a second run does not give you a
second integration, a second placement, or a second ad.

## The placement editor

A terminal cannot show a draggable rectangle, so the editor is a small local web
page. `clirevenue editor` starts a loopback-only HTTP server on a random port and
opens your browser at it.

In the editor you can:

- drag the ad preview anywhere in the page
- resize it from any of the four corner handles
- see the current width and height in pixels, live
- nudge it with the arrow keys (hold Shift for 10px steps), or type exact numbers
  into the sidebar fields instead of dragging at all
- switch between every slot in the project from a dropdown
- cancel without saving

Saving writes to `clirevenue.config.json` in your project. Reopening the editor
restores whatever you saved. Nothing is written until you press **Save**, and
cancelling leaves the file byte-for-byte unchanged.

The editor only ever listens on `127.0.0.1`, requires a random token that is
checked in constant time, and never receives your publisher key — it cannot
write files itself. Your browser posts the geometry back to the CLI process,
which does the writing.

Options: `--placement <key>` to pick a placement, `--integration <id>` to open a
specific integration's editor.

## Where your key is loaded from

CLIRevenue reads your publishable key from the first of these that holds a
well-formed value:

1. `VITE_CLIREVENUE_PUBLISHABLE_KEY` in the environment
2. `CLIREVENUE_PUBLISHABLE_KEY` in the environment
3. `<your project>/.env.local`

`setup` writes the key to `.env.local` (and adds that file to your `.gitignore`
for you), so a project that has been set up just works — `editor` finds the same
key `setup` wrote, without you exporting anything.

An empty or malformed value is ignored rather than sent to the API, and the file
is only ever read, never written, by the reader. A project with no key anywhere
gets a message naming the variable, the command, and the exact path that was
searched.

The key in question is the **publishable** key. The secret server-side key never
belongs in a browser and is never put in `clirevenue.config.json`, any `.env*`
file, or any generated file.

## Activation in your coding CLI

`Ctrl+I` is only active once you register a binding for your editor:

```bash
npx clirevenue keybindings install vscode
```

`setup` tells you which is true in your project. It prints `Ctrl+I` only when a
working binding genuinely exists; otherwise it prints the command that does work.

| Target | How you launch it | Mechanism |
| --- | --- | --- |
| VS Code, Cursor, Windsurf, VSCodium | `Ctrl+I` | `.vscode/keybindings.json`. **The only real hotkey** |
| Claude Code | `/clirevenue-editor` | `.claude/commands/clirevenue-editor.md` |
| OpenCode | `/clirevenue-editor` | `.opencode/commands/clirevenue-editor.md` |
| Codex | `/prompts:clirevenue-editor` | `.codex/prompts/clirevenue-editor.md` |
| Gemini | `/clirevenue-editor` | `.gemini/commands/clirevenue-editor.toml` |
| Neovim | `:ClirevenueEditor` | `.clirevenue/keybindings.vim` — source it from your config |
| tmux | `clirevenue editor` | Nothing written: `Ctrl+I` arrives as `Tab`, colliding with prefix handling |
| Cline | `clirevenue editor` | Needs a command id from the installed extension; CLIRevenue will not guess one |
| Kilo | `clirevenue editor` | No keybinding or command-registration mechanism exists; nothing written |
| Aider | `clirevenue editor` | Settings-file config only; no command surface |
| Another CLI | `clirevenue editor` | CLIRevenue cannot know where an unlisted tool reads commands |

**`Ctrl+I` is only real in the VS Code family.** Everything else is a command,
and the CLI will not pretend otherwise: `setup` prints `Ctrl+I` only when a
working binding genuinely exists, and otherwise prints the command that works.

Installing this package adds **no** global keybinding to anything. Every file
written is project-local; your global editor config is never touched.

Two of these deserve their own note, because "press `Ctrl+I` and nothing
happens" is the most common way this gets reported:

- **OpenCode** supports keybinds, but they map to a closed set of ~184 built-in
  TUI actions — none of which runs a shell command. There is no key, `Ctrl+I` or
  otherwise, that can start the editor. What OpenCode *does* support is project
  commands: `npx clirevenue keybindings install opencode` writes
  `.opencode/commands/clirevenue-editor.md`, so you run `/clirevenue-editor`
  inside the agent. That is a slash command the agent carries out, not a hotkey —
  the CLI describes it that way rather than borrowing the `Ctrl+I` language for
  it.
- **Kilo** (the `@kilocode/cli` terminal agent) has no keybinding or
  command-registration mechanism at all. `install kilo` deliberately writes
  nothing and says why, rather than dropping an inert file that looks like an
  integration. Run `clirevenue editor` in a terminal.

Bindings are written to a marked block inside your project's existing config, so
your other keybindings, comments and formatting are left alone. Re-running
`install` is a no-op. If you already use `Ctrl+I`, the CLI refuses to overwrite
it and tells you so; `--force` puts ours after yours, and `remove` puts yours
back exactly as it was.

## Where the geometry lives

`clirevenue.config.json` in your project:

```json
{
  "$schema": "https://clirevenue.in/schema/clirevenue.config.json",
  "version": 2,
  "integrations": {
    "vscode": {
      "id": "vscode",
      "target": "vscode",
      "label": "VS Code",
      "placementKey": "vscode-1",
      "slots": {
        "slot-1": {
          "id": "slot-1",
          "label": "Leaderboard",
          "enabled": true,
          "container": "#ad-slot",
          "layout": {
            "size": { "width": 728, "height": 90 },
            "position": { "anchor": "bottom-center", "offsetX": 0, "offsetY": 24 }
          }
        }
      }
    }
  }
}
```

An **integration** is one coding CLI. It owns a `placementKey` — the thing the
backend serves a creative for — and a set of **slots**. A slot holds the
geometry, a label, a CSS selector for the element to render into, and an
`enabled` flag. Disabling a slot keeps its geometry, so turning it back on
restores what you had.

`layout` is the SDK's own vocabulary — an anchor, two offsets and a size — and
nothing else. The generated adapter imports this file **at runtime** and hands
the layout to `clirevenue.render()` unchanged, so what you drag is what the SDK
resolves. Because geometry is stored as an anchor plus an offset rather than
absolute coordinates, a placement you set on a wide screen still lands correctly
when the viewport shrinks.

An unknown anchor or an out-of-range size in a file you hand-edited is
normalised on read so your page still builds. The editor's write path does the
opposite: it refuses a value it was given rather than silently storing something
you did not choose.

### Migrating from a 1.1.0 config

`version: 1` configs, which looked like this, are converted automatically the
first time CLIRevenue reads them:

```json
{ "version": 1, "placements": { "home-top": { "placementKey": "home-top", "layout": { … } } } }
```

Each old placement becomes one integration with the same id and the same
placement key, holding one `slot-1` with the same geometry, container and
timestamp. The mapping is one-to-one and lossless — nothing is renamed, dropped
or recalculated.

Reading a legacy file does **not** rewrite it. Your `version: 1` file stays on
disk exactly as it is until you run a command that writes (the editor saving, or
`add-slot`). If you read it and then downgrade, you still find the config you
had.

You do not normally have to do anything else: `setup` regenerates your
integration files, and the `1.1.0` files they replace carry the same generated
header, so they are replaced rather than treated as yours. If you wrote your own
component against the old API, keep it — `setup` reports it as yours and leaves
it alone.

This file contains no credentials. Your publishable key stays in `.env.local`.

## Supported project types

| Project | What gets generated |
| --- | --- |
| Vite + React | `src/lib/clirevenue.js`, `src/components/CLIRevenueAd.jsx` |
| Vite + Vue | `src/lib/clirevenue.js`, `src/components/CLIRevenueAd.vue` |
| Vite + Svelte | `src/lib/clirevenue.js`, `src/components/CLIRevenueAd.svelte` |
| Vite (no framework) | `src/lib/clirevenue.js` |
| Static HTML | `clirevenue-ad.js` (loads the SDK from a CDN, mounts every enabled slot) |

The SDK itself is framework-agnostic — it takes a CSS selector and manipulates
the DOM directly. Only the adapter differs per framework, and a project only
gets the files it can actually use.

Nothing is installed that you did not already have. `setup` never adds React,
Vue, Svelte, Vite or Node.js to a project that lacks them; if your project has
no web page to place an ad on, it says so and explains what it looked for.

## Rerunning

`setup` is safe to rerun. Generated files carry a header and are only rewritten
while that header is intact — a file you have edited by hand is reported and
left alone, as is any other content in `clirevenue.config.json`. Re-saving
unchanged geometry produces no diff at all. Slot ids are never recycled, so
removing a slot and adding another cannot leave a saved link pointing at a
different ad.

## Troubleshooting

**"No CLIRevenue publisher key found."** Run `clirevenue setup`, or set
`VITE_CLIREVENUE_PUBLISHABLE_KEY` in the environment or in `.env.local` in your
project root. The message names the exact path that was searched. A value that
is empty, truncated, or not of the form `pk_test_…` / `pk_live_…` is ignored
rather than sent.

**"Invalid or revoked publisher key."** The key is well-formed but the API
rejected it. Check it in the dashboard, or run `setup` to re-verify. If it was
revoked, `setup` will ask for a new one.

**"Placement key … is already used by integration …".** Two integrations in your
project claim one key. Give one of them a different key — the message names both
owners.

**`Ctrl+I` does nothing.** Almost always you have not installed a binding, or
your CLI is not the VS Code family. Run `clirevenue keybindings status`: it
prints what was detected and what is wired up. `clirevenue editor` always works.

**`clirevenue config … must be an object.`** Your `clirevenue.config.json` is
malformed and was deliberately left untouched rather than overwritten. Fix the
named field, or restore it from version control. A layout problem is different:
that is normalised on read so your page still builds.

**The ad does not move when I drag it.** The geometry is only picked up on the
next page load — the config is read at runtime, not baked into the component.
Reload, and check you are looking at the slot you edited (`clirevenue editor` has
a dropdown if you have more than one).

**"No ad slots are configured."** An integration exists but nothing has been
positioned yet. Run `clirevenue add-slot <integration>`.

**`No placements found` from the API.** The CLI creates the first placement for
you. If this persists, the `cli` Edge Function may not be deployed for your
project — placement creation is a server-side call.

## Requirements

- Node.js >= 18
- A publishable key (`pk_test_…` or `pk_live_…`) — `setup` creates the
  placement for you, so a dashboard visit first is not required
- A project CLIRevenue can render into (see the table above)

## License

CLIRevenue is proprietary software. See the LICENSE file in this package.