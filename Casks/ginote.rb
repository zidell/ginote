cask "ginote" do
  version "0.1.80"
  sha256 "a365faa747e760ef4df55f48d0a5c4c71680df4d9b6dfded8af145e6e6417150"

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
