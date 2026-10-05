Ginote Native (macOS)
=====================

Settings
  ~/Library/Application Support/net.gitools.note.mac/config.toml
  Print the exact path:  "Ginote Native.app/Contents/MacOS/Ginote" --config-path

  The file documents every key in its own comments. Edit it while the app runs or not;
  the running app applies a saved change within about a second. Afterwards read
  config-status.txt in the same folder: it records when the file was last loaded and
  lists any rejected value and the value used instead. Invalid TOML is ignored as a whole.

Credentials
  GitHub personal access tokens and the OpenAI API key are kept in the macOS Keychain
  (service "net.gitools.note.mac"), never in config.toml. Enter them in the app.

App state
  Drafts, pending deletions and caches live in the "state" folder next to config.toml.
