cask "ginote" do
  version "0.1.91"
  sha256 "aa99890d1455d3ab608f699f054193d4e52f3706d6c12a761be68d9edf62c06c"

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
