cask "ginote" do
  version "0.1.75"
  sha256 "5bfa53517ebc6e960972bcbd4ff7bb4cef201aefe2bdc2e65f4f93593b285eb2"

  url "https://github.com/zidell/ginote/releases/download/v#{version}/Ginote_#{version}_universal.dmg"
  name "Ginote"
  desc "Serverless notes app backed by GitHub Issues"
  homepage "https://note.gitools.net/"

  depends_on :macos

  app "Ginote.app"

  zap trash: [
    "~/Library/Application Support/net.gitools.note",
    "~/Library/Caches/net.gitools.note",
    "~/Library/Saved Application State/net.gitools.note.savedState",
  ]
end
