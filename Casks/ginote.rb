cask "ginote" do
  version "0.1.77"
  sha256 "15fc8f5f9ecf971cae095bb2d20116de773c1820f41b176bcb337c5a95027f87"

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
