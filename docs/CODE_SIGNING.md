# Code signing policy

Every Ginote binary is built from the public [source repository](https://github.com/zidell/ginote)
by the [release workflow](https://github.com/zidell/ginote/blob/main/.github/workflows/release.yml)
on GitHub-hosted runners.

- **macOS**: signed with an Apple Developer ID certificate and notarized by Apple.
- **App updates (macOS, Linux)**: the update files the installed app downloads are signed
  with Ginote's updater key. The app embeds the matching public key and installs nothing
  that is not signed with it.
- **Windows**: distributed through the Microsoft Store as an MSIX package, which Microsoft
  signs after certification. An MSIX for installation outside the Store will be signed
  through [SignPath.io](https://signpath.io/) with a certificate by
  [SignPath Foundation](https://signpath.org/) once that signing is approved; each such
  release then requires manual approval in SignPath.
- **Web build**: the interface the apps download from `https://note.gitools.net` is signed
  with a separate key and verified by the app before use ([APP_OTA.md](APP_OTA.md)).

Maintainer, committer, reviewer, and signing approver:
[zidell](https://github.com/zidell). This is a single maintainer project.

## Privacy

The desktop app bundles its interface and checks `https://note.gitools.net` for newer
signed builds of it; macOS and Linux apps also check GitHub Releases for new app
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
