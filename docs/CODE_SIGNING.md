# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

After SignPath Foundation approval, Ginote's Windows MSI and the `ginote.exe` inside
it will be signed from the public
[source repository](https://github.com/zidell/ginote) by the
[release workflow](https://github.com/zidell/ginote/blob/main/.github/workflows/release.yml).
The signed MSI will be published on [GitHub Releases](https://github.com/zidell/ginote/releases)
after signature verification. Existing Windows releases are unsigned. Each new Windows
binary release requires manual approval in SignPath. Routine changes to the web app at
`https://note.gitools.net` do not change the signed binary.

Maintainer, committer, reviewer, and signing approver:
[zidell](https://github.com/zidell). This is a single maintainer project.

## Privacy

The desktop app loads `https://note.gitools.net`, so that host receives normal web
requests needed to serve the app. Notes, attachments, and the GitHub personal access
token are sent directly from the app to GitHub only when the user configures a GitHub
repository. Optional voice transcription and text refinement send selected audio or
text directly to OpenAI when the user enables and uses those features. The app stores
tokens and local drafts on the user's device. See the [README](../README.md) for the
data flow and setup instructions. Service providers' policies:
[GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement),
[OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/).

Uninstall Ginote through Windows Settings > Apps > Installed apps. The desktop app
does not change system configuration beyond its installation.
