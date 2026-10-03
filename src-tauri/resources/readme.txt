Ginote - guide for people and AI agents changing this app's settings
====================================================================

This file ships inside the installed Ginote app. It explains where the app keeps its
settings and how to change them without opening the app's settings screen.

1. The active settings file
---------------------------

Ginote reads and writes exactly one settings file per user:

  macOS    ~/Library/Application Support/net.gitools.note/config.toml
  Linux    ${XDG_CONFIG_HOME:-~/.config}/net.gitools.note/config.toml
  Windows  %LOCALAPPDATA%\Packages\<package family name>\LocalCache\Roaming\net.gitools.note\config.toml
           (Windows keeps the files of Store/MSIX apps in this per-package folder)

To print the exact path Ginote uses, run the app with --config-path:

  macOS    /Applications/Ginote.app/Contents/MacOS/ginote --config-path
  Windows  ginote --config-path        (the app registers the `ginote` command)
  Linux    ginote --config-path

`--help` prints the same summary as this section. Both options exit before any window
opens and change nothing.

This readme is not a template: there is no example settings file in the install folder,
and editing files there has no effect.

2. Format and comments
----------------------

config.toml is TOML 1.0 (https://toml.io). Every key has a comment right above it with
its meaning, type, allowed values, default and when the change takes effect, so the file
alone is enough to change a setting. Ginote rewrites the whole file, comments included,
whenever a setting changes in the app: values are kept, but comments you add and key order
are not.

3. First launch
---------------

The file does not exist until Ginote has been opened once. On first launch Ginote creates
it with every setting and its comment (and moves settings from older app versions into
it). If it is missing, open and close Ginote once, then edit it.

4. Applying a change
--------------------

Edit the file while Ginote is running or not.

- Desktop: a running Ginote notices the saved file within about a second and applies it
  without a restart. Settings that need a reload (such as notes_per_page) reload the
  note list by themselves.
- If Ginote is not running, the change is used on the next launch.

Do not edit the file and the app's settings screen at the same time: whichever saves last
wins.

5. Checking that it worked
--------------------------

After Ginote loads the file it writes config-status.txt in the same folder:

  Last loaded: <time>
  Result: loaded; every value was accepted.

If a value was not allowed, the status lists the key, why, and the value Ginote used
instead (usually the default or the nearest allowed value). If the file is not valid TOML,
the status says so and Ginote keeps using the previous settings; fix the file and save it
again. The settings themselves are only confirmed by the status file, not by the edited
text.

6. Credentials
--------------

GitHub personal access tokens and the OpenAI API key are NOT in config.toml. Ginote keeps
them in the operating system's credential store (macOS Keychain, Windows Credential
Manager, the Secret Service on Linux) under the service name "net.gitools.note". They can
only be entered or replaced in the app. Removing a workspace from config.toml, or setting
its remember_token to false, deletes that workspace's stored token.

7. More
-------

https://github.com/zidell/ginote/blob/main/docs/CONFIG.md
