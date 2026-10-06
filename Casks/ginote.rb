cask "ginote" do
  version "0.1.90"
  sha256 "44868df320c2b51d0c3be3da341bf06f8f4bb99ca2169bb20cf35e3f90effce4"

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
