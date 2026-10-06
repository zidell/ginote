# Code signing policy

Every Ginote binary is built from the public [source repository](https://github.com/zidell/ginote)
by the [release workflow](https://github.com/zidell/ginote/blob/main/.github/workflows/release.yml)
on GitHub-hosted runners.

- **macOS**: signed with an Apple Developer ID certificate and notarized by Apple.
- **App updates (macOS, Linux, Windows)**: the update files the installed app downloads are signed
  with Ginote's updater key. The app embeds the matching public key and installs nothing
  that is not signed with it.
- **Windows**: the NSIS installer is distributed through GitHub Releases. It currently has no
  Windows code signature; its app updates are checked with Ginote's updater signature.
- **Web build**: the interface the apps download from `https://zidell.github.io/ginote/` is signed
  with a separate key and verified by the app before use ([APP_OTA.md](APP_OTA.md)).

Maintainer, committer, reviewer, and signing approver:
[zidell](https://github.com/zidell). This is a single maintainer project.

## Privacy

The desktop app bundles its interface and checks `https://zidell.github.io/ginote/` for newer
signed builds of it; desktop apps also check GitHub Releases for new app
releases. Those hosts receive normal web requests. Notes, attachments, and the GitHub
personal access token are sent directly from the app to GitHub only when the user
configures a GitHub repository. Optional voice transcription and text refinement send
selected audio or text directly to OpenAI when the user enables and uses those features.
The app keeps tokens in the operating system's credential store and local drafts on the
user's device. See the [README](../README.md) for the data flow and setup instructions.
Service providers' policies:
[GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement),
[OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/).

Uninstall Ginote through Windows Settings > Apps > Installed apps. The desktop app
does not change system configuration beyond its installation.
