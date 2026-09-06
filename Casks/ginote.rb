cask "ginote" do
  version "0.1.73"
  sha256 "b11f8765117733c4e11cab0debcaff226e120414275d372c0c774a522e955071"

  url "https://github.com/zidell/ginote/releases/download/v#{version}/Ginote_#{version}_universal.dmg"
  name "Ginote"
  desc "Serverless notes app backed by GitHub Issues"
  homepage "https://note.gitools.net"

  app "Ginote.app"

  zap trash: [
    "~/Library/Application Support/net.gitools.note",
    "~/Library/Caches/net.gitools.note",
    "~/Library/Saved Application State/net.gitools.note.savedState",
  ]
end
