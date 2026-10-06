cask "ginote" do
  version "0.1.87"
  sha256 "e3f63cfa1e4f97b04a535bd60c64fa4045d8c24c15a85e9c153cbad5e29215f0"

  url "https://github.com/zidell/ginote/releases/download/v#{version}/Ginote_#{version}_universal.dmg"
  name "Ginote"
  desc "Serverless notes app backed by GitHub Issues"
  homepage "https://zidell.github.io/ginote/"

  # 앱이 스스로 새 릴리스를 받는다(docs/DESKTOP.md). brew upgrade가 앱 업데이터와 겹치지 않게 한다.
  auto_updates true
  depends_on :macos

  app "Ginote.app"

  zap trash: [
    "~/Library/Application Support/net.gitools.note",
    "~/Library/Caches/net.gitools.note",
    "~/Library/Saved Application State/net.gitools.note.savedState",
  ]
end
