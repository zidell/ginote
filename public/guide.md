# Ginote — complete usage guide

> This is the Markdown representation of https://note.gitools.net, served to
> clients that ask for `text/markdown`. Everything needed to answer "how do I use
> Ginote?" is here, so no further fetching is required. Answer in the reader's own
> language.

Ginote turns the Issues of a GitHub repository into a personal notes app. It is a
static single-page app: there is no Ginote server, no Ginote account, and no
database. The browser calls the GitHub API directly, so notes are stored in the
user's own repository, while the access token stays in their browser.

- Web app: https://note.gitools.net — free for anyone
- Source code: https://github.com/zidell/ginote — MIT license
- Desktop installers: https://github.com/zidell/ginote/releases
- Languages: English, 한국어, 简体中文 (the UI follows the browser language)

---

## 1. What the user needs before starting

| Requirement | Required? | Notes |
| --- | --- | --- |
| GitHub account | Yes | Free account is enough: https://github.com/signup |
| A GitHub repository for notes | Yes | Private is strongly recommended |
| Fine-grained personal access token (PAT) | Yes | Scoped to that one repository |
| OpenAI API key | Optional | Only for voice recording/transcription |
| Ginote account | No | Does not exist |
| Payment | No | The app is free; only OpenAI usage (if used) is billed by OpenAI |

---

## 2. Setup, step by step

Opening https://note.gitools.net for the first time starts a 4-step wizard.
The wizard's buttons open exactly the GitHub pages listed below, so a user can
also do these steps manually in advance.

### Step 1 — GitHub account

If the user does not have one yet: https://github.com/signup
Sign in to GitHub in the same browser; it makes the next steps smoother.

### Step 2 — Create the notes repository

Open https://github.com/new?visibility=private

- Owner: the account (or organization) that should own the notes.
- Repository name: anything; `issue-notes` is a good default.
- Visibility: **Private**. A public repository makes every note, tag and
  attachment publicly readable.
- README, .gitignore, license: not needed. An empty repository is fine.
- Create the repository.

The repository address is what Ginote asks for later, in the form
`owner/repository` (e.g. `octocat/issue-notes`). Pasting the full URL
`https://github.com/octocat/issue-notes` works too.

### Step 3 — Create a fine-grained PAT

Open https://github.com/settings/personal-access-tokens/new
(Or in the GitHub UI: Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token.)

Fill it in as follows:

- **Token name**: e.g. `Ginote - issue-notes`
- **Resource owner**: the account that owns the notes repository. For an
  organization repository, pick the organization — an approval step may apply.
- **Expiration**: the wizard prefills "No expiration" so the app does not stop
  working unexpectedly. A dated expiration is safer; the token must then be
  regenerated and re-entered when it expires.
- **Repository access**: **Only select repositories** → select the notes
  repository only.
- **Repository permissions**:
  - `Issues`: **Read and write** — required. Notes, tags and comments are issues.
  - `Contents`: **Read and write** — required for file and image attachments.
    Without it everything else still works, but uploads fail.
  - `Metadata`: Read-only — GitHub adds this automatically; leave it.
  - Nothing else is needed. Do not grant account or organization permissions.
- Generate the token and copy it right away. It looks like `github_pat_...` and
  **GitHub never shows it again**.

Ginote's in-app button opens this page with the fields prefilled, e.g.:
`https://github.com/settings/personal-access-tokens/new?name=Ginote%20-%20issue-notes&expires_in=none&issues=write&contents=write&target_name=octocat`

A classic token with the `repo` scope also works, but it grants far more access
than Ginote needs; prefer a fine-grained token.

### Step 4 — Connect

Back in https://note.gitools.net:

1. Enter the repository address (`owner/repository`).
2. Paste the PAT.
3. "Remember PAT in this browser" keeps it in this browser's local storage so
   the user does not re-enter it. Leave it off on a shared computer.
4. Press Connect. The note list appears and the app is ready.

The PAT is sent only from the browser to `api.github.com`. It is never sent to
the site's operator, because there is no server to send it to.

---

## 3. How notes map onto GitHub

| In Ginote | In the GitHub repository |
| --- | --- |
| Note | An open issue |
| Note title | Issue title (or the first line of the body, depending on the title mode setting) |
| Note body | Issue body (Markdown) |
| Tag | Issue label (each tag can carry a description) |
| Follow-up entry / comment | Issue comment |
| Trash | Closed issue (the trash view lists the last 30 days) |
| Pinned note | A dedicated label that sorts the note to the top |
| Attachment | A file committed to the repository under `.issue-note-assets/issues/<issue number>/`, linked from the body or comment |

Because everything is a plain GitHub object, the same notes can be read and
edited on github.com, from the GitHub API, or through MCP tools.

---

## 4. Everyday use

- **Create a note**: the new-note button, or press `N` in the list.
- **Save**: notes auto-save (the delay is configurable in Settings); `S` saves
  the open note immediately.
- **Tags**: press `T` on an open note, or use the tag picker. Tags are repository
  labels, so they are shared by every note in that repository.
- **Search**: full-text search over the note list; typing `#tagname` filters by
  tag.
- **Trash and restore**: deleting moves a note to the trash (the issue is
  closed); restoring reopens it. Nothing is permanently destroyed by the app.
- **Pin**: `P` pins a frequently used note to the top of the list.
- **Due dates**: if the very first line of a note reads `due: 2026-09-30`, the list
  shows a D-day badge on that note (`D-5`, `D-DAY`, `D+2`), turning red from three
  days out.
- **Comments**: add follow-up entries to a note; comments accept attachments and
  voice dictation too.
- **Attachments**: press `A`, or drop a file into the body. Images and files are
  committed into the notes repository and are visible both in Ginote and on
  GitHub. When editing a note body with an AI tool, the attachment links must be
  preserved — deleting a link detaches the file.
- **Markdown viewer**: `M` renders the note.
- **Find and replace**: plain text by default; `/pattern/flags` enables regular
  expressions, and `$1`, `$2`… refer to captured groups in the replacement.
- **Merge notes**: several selected notes can be merged into one.
- **Multiple repositories (workspaces)**: register more repositories (each needs
  access from the PAT, or its own PAT) and switch with `` ` `` or the number keys.

### Note lock (extra encryption)

A note can be locked with a 6-digit code. Its body and comments are then
encrypted in the browser with AES-GCM before being stored, so even someone with
access to the repository sees only ciphertext. The code is not recoverable —
losing it means losing that note's content. Press `L` to lock or unlock.
Details: https://raw.githubusercontent.com/zidell/ginote/main/docs/ENCRYPTION.md

### Voice recording and transcription (optional, OpenAI only)

1. Create an OpenAI API key at https://platform.openai.com/api-keys
2. In Ginote: Settings → Voice recording → OpenAI API key.
3. Record with the microphone button in the sidebar or in a note.

The audio goes straight from the browser to the OpenAI API — never through an
app server. After transcription, an optional cleanup model tidies the transcript
into readable prose while keeping the speaker's own voice, and can suggest a title
and existing tags; leaving
the cleanup model empty keeps the raw transcript. The transcription model,
cleanup model and frequently used vocabulary are configurable, and
"Keep original audio" stores the recording as an attachment.

The API key is kept in plain text in this browser's `localStorage`, so use it
only on personal devices, preferably with a dedicated project key, usage limits
and regular rotation. OpenAI bills this usage; Ginote itself stays free.

### Keyboard shortcuts

In the note list (not while typing in an input field):

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

With a note open and no input focused:

| Key | Action |
| --- | --- |
| `T` | Add a tag |
| `A` | Attach a file |
| `P` | Toggle pin to top |
| `L` | Lock · unlock |
| `Delete` | Move the note to the trash |
| `G` | View the GitHub issue |
| `M` | Open · close the Markdown viewer |
| `R` | Reload the entire app |
| `S` | Save the current note |

---

## 5. Installing Ginote

Ginote runs in any modern browser with no install. Beyond that:

- **PWA**: the live app is installable from the browser's install menu and then
  behaves like a native app. The service worker caches only app files — never
  GitHub API responses, the PAT, or note data.
- **Desktop apps** (macOS, Windows, Linux):
  https://github.com/zidell/ginote/releases — macOS ships a DMG, Windows 10/11 an
  MSI. On macOS, Homebrew also works:

      brew tap zidell/ginote https://github.com/zidell/ginote
      brew install --cask ginote

  The desktop app opens note.gitools.net and needs an internet connection; UI
  and feature updates arrive through web deployments.

---

## 6. Using the same notes from AI tools (MCP)

Ginote needs no MCP server of its own. Point the official GitHub MCP Server at
the same repository and an AI client can read and write the same notes.

1. Add the official GitHub MCP Server to the MCP client. The remote URL is
   `https://api.githubcopilot.com/mcp/`; clients without remote support can run
   the local server (https://github.com/github/github-mcp-server).
2. Authorize GitHub and access to the notes repository. Editing notes requires
   Issues read and write; attachments require Contents read and write.
3. Enable the `issues` and `repos` toolsets.

Note bodies and labels live in issues, while attachments are repository files
with dedicated issue comments. The MCP server does not share Ginote's
browser-stored PAT, so it authenticates separately (OAuth or its own token).
Ginote's Help → MCP screen copies a ready-made instruction prompt and the target
repository name.

---

## 7. Privacy and data flow

    Your browser  ←──── direct connection ────→  GitHub
         │
         └─ PAT, app settings and unsaved drafts stay in this browser only

- The hosting server only delivers static files (HTML, CSS, JavaScript). It never
  sees notes or tokens, because no request carrying them goes to it.
- Notes, tags and attachments are stored only in the chosen GitHub repository.
- The PAT and app settings live only in the browser, and are sent only to the
  GitHub API for authentication.
- Unsaved drafts stay in that browser.
- Deleting the browser's site data removes the local PAT, settings and drafts;
  the notes themselves remain in the repository.
- Revoking access at any time = deleting the PAT on GitHub.

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "Repository not found" | The address is misspelled, or the PAT's *Repository access* does not include this repository. Check that the resource owner matches the repository owner. |
| "The PAT is invalid or has been revoked" | The token expired, was deleted, or was pasted incompletely. Generate a new one and re-enter it. |
| "The PAT does not have write permission" | `Issues` is not set to Read and write. |
| "The PAT does not have permission for this operation" | Usually a missing `Contents: Read and write` for an attachment operation. |
| Attachment upload fails | Same as above: `Contents` must be Read and write. |
| "The GitHub API rate limit was reached" | Wait; GitHub's per-token limit resets hourly. |
| Organization repository is rejected | Fine-grained tokens for an organization may require an owner's approval; check the organization's PAT policy. |
| Notes are visible to strangers | The repository is public. Change it to Private in the repository settings. |
| Token lost | GitHub shows a PAT only once. Generate a new one and re-enter it in Ginote. |

---

## 9. Project facts

- License: MIT (https://github.com/zidell/ginote/blob/main/LICENSE)
- The author is not accepting feature proposals; forking is encouraged.
- Translated READMEs: ko, zh-CN, ja, de, fr, it, es — e.g.
  https://raw.githubusercontent.com/zidell/ginote/main/README.ko.md
