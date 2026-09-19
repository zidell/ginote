[![CI](https://github.com/zidell/ginote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zidell/ginote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zidell/ginote/branch/main/graph/badge.svg)](https://codecov.io/gh/zidell/ginote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Italiano](README.it.md) | [Español](README.es.md)

# Ginote

## About

Ginote is a simple, secure web app that lets you use GitHub Issues as personal notes.
I've always liked GitHub Issues, but its sluggishness and clunky UX constantly bothered
me. So I built an SPA that keeps nearly all of its features while giving it the user
experience of a note-taking app. The app consists only of static JS, and your browser
talks to the GitHub API directly, which keeps it secure.

Live app (free for anyone to use): [https://note.gitools.net](https://note.gitools.net)

## Preview

![Ginote preview](docs/preview.gif)

How to regenerate the preview GIF is described in [docs/screencasting.md](docs/screencasting.md).

## Features

- **Stored directly in a private repository:** Issues in a private repository serve as
  your notes, with no separate app server or database.
- **Direct browser connection:** Your browser calls the GitHub API directly. There is no
  intermediate server run by the app operator that receives or keeps your notes or PAT.
- **Tags, search, and trash:** GitHub labels are used as tags (each tag can carry a
  description of what it's for), with full-text search and a trash bin based on closed
  issues. Notes you check often can be pinned to the top.
- **Comments:** Issue comments serve as follow-up entries on a note. You can attach files
  to comments or dictate them by voice, too.
- **File and image attachments:** Attachments on note bodies and comments are stored in
  the same repository and can be viewed both in the app and on GitHub. See
  [how attachments are stored](docs/ATTACHMENTS.md) for details.
- **Voice recording, transcription, and cleanup (OpenAI only):** Audio recorded in the
  browser is sent straight to OpenAI for transcription, and the transcript can be
  polished into natural written text. The cleanup step can also suggest a title and
  existing tags, and the original audio can optionally be kept as a note attachment.
  Voice features currently support the OpenAI API only.
- **Note lock (extra body encryption):** If a private repository alone isn't enough, lock
  a note with a 6-digit code to encrypt its body and comments once more in the browser
  with AES-GCM. See [how encryption works](docs/ENCRYPTION.md) for details.
- **Editing tools:** Merge several notes into one, find and replace in the body (regular
  expressions supported), and view the rendered result in the Markdown viewer.
- **Multiple repositories:** Register several repositories and switch between them from
  the list or with number keys.
- **Keyboard control:** Navigate, open, and select notes, create new notes, and switch
  repositories from the keyboard.
- **MCP integration:** Connect GitHub's official MCP Server and your AI tools can read and
  write the same notes (issues). No app-specific MCP server is required.
- **Web and desktop:** Available as an installable PWA and as Tauri-based macOS, Windows,
  and Linux apps. For desktop packaging and releases, see the [desktop app docs](docs/DESKTOP.md).

## Usage

### Where does my data go?

**Ginote is a static web app served as plain files.** The hosting server only delivers
app files such as HTML, CSS, and JavaScript. There is no app backend handling sign-in or
note storage; once the app is open, all data traffic flows directly between your browser
and the GitHub API.

```text
Your browser  ←──── direct connection ────→  GitHub
     │
     └─ PAT, app settings, and unsaved drafts stay in this browser only
```

- Notes, tags, and attachments are stored only in the GitHub repository you specify.
- Your PAT and app settings are kept only in your browser and are sent to the GitHub API
  only for authentication.
- Unsaved drafts remain only in that browser.
- Optional note encryption is documented in [how encryption works](docs/ENCRYPTION.md).
- There is no API that sends notes, PATs, or settings to the app operator, and no
  analytics or tracking services are used.

In short, apart from the requests that download the app files, none of your data is sent
to the app operator or any server other than GitHub. The only places your note data
actually lives are **your own browser and the GitHub repository you chose**.

### Using voice recording

Before using voice recording for the first time, you need an OpenAI API key. Create an
API key on OpenAI, then enter it under **Settings → Voice recording → OpenAI API key** in
Ginote. OpenAI may charge you based on API usage.

Once set up, start recording with the microphone button in the sidebar or the note view.
When you finish recording, the audio is transcribed, and the optional cleanup model and
cleanup rules are applied to suggest the body, title, and existing tags. In Settings you
can change the transcription model, the cleanup model, and frequently used transcription
vocabulary; leave the cleanup model empty to record only the raw transcript. Turn on
**Keep original audio** to also save the original recording of successful sessions as an
attachment to that note.

Audio files and transcripts are sent directly from your browser to the OpenAI API and
never pass through an app server. The API key is stored in plain text in this device's
browser `localStorage`, so use it only on personal devices, and we recommend a dedicated
project key, usage limits, and regular rotation.

### Keyboard shortcuts

The following shortcuts are available in the note list. List shortcuts don't work while
you are typing in an input field. `Ctrl/Cmd + R` is the browser's reload shortcut, so it
reloads the app from anywhere.

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move through the note list |
| `Enter` | Open the current note · press again to edit |
| `N` | Create a new note |
| `` ` `` | Open the repository picker |
| `1`–`9` | Switch repositories in registration order |
| `Esc` | Clear selection · cancel delete · close hints |
| `Space` | Select the current note |
| `Shift` + `↑` / `↓` | Select a range of notes |
| `Delete` / `Backspace` | Move selected notes to the trash |
| `Ctrl/Cmd + R` | Reload the app |

When a note is open and no input field has focus, these shortcuts are also available.

| Key | Action |
| --- | --- |
| `T` | Add a tag |
| `A` | Attach a file |
| `P` | Toggle pin to top |
| `L` | Lock · unlock |
| `Delete` | Move the note to the trash |
| `G` | View the GitHub issue |
| `M` | Open · close the MD viewer |
| `R` | Reload the entire app |
| `S` | Save the current note |

### PWA (installable web app)

Production builds work as a PWA that you can install from the browser and use like an
app. Open the live app in your browser and use the browser's install menu. The manifest
and service worker are not tied to any specific domain or hosting service and work
relative to the path where the app is deployed. The service worker (a feature that lets
the browser temporarily keep app files) caches only same-origin app files and never
caches GitHub API requests, PATs, or note data.

### Downloading the desktop app

Installers for macOS, Windows, and Linux are available on
[GitHub Releases](https://github.com/zidell/ginote/releases). macOS uses a DMG, and
Windows 10/11 uses an MSI. New Windows releases are published as signed MSIs once
SignPath Foundation signing is set up. The desktop app opens
[note.gitools.net](https://note.gitools.net) and requires an internet connection. UI
and general feature changes are delivered through web deployments.

[Code signing policy](docs/CODE_SIGNING.md)

Homebrew installation on macOS, running locally, per-platform packaging, and the release
process are covered in the [desktop app docs](docs/DESKTOP.md).

## Operations and development

When changing the web app, install dependencies from the lockfile and make sure static
checks, tests, and the production build all pass before deploying. The app is deployed
as static files, and desktop packaging and signing are managed separately from web
deployments. Changes that affect data formats or security should be checked against the
attachment and encryption docs first. The development environment, verification
commands, and deployment and maintenance procedures are described in the
[development and operations docs](docs/DEVELOPMENT.md).

## Feature requests

If you'd like a new feature, please fork the project and change it yourself. It already
does everything I need, so I'm not accepting feature proposals.

## License

[MIT License](LICENSE)
