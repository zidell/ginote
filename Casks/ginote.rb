cask "ginote" do
  version "0.1.85"
  sha256 "641d674ac7574da3e403b03dbe29f5b8578d2c5048e1f518b63df29d6a4cf604"

  url "https://github.com/zidell/ginote/releases/download/v#{version}/Ginote_#{version}_universal.dmg"
  name "Ginote"
  desc "Serverless notes app backed by GitHub Issues"
  homepage "https://note.gitools.net/"

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
