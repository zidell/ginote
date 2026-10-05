import Foundation

/// 화면에 보일 시간 길이. 시스템 언어에 맞춰 "1시간", "30 minutes"처럼 쓴다.
enum DurationText {
    static func minutes(_ minutes: Int) -> String {
        Duration.seconds(minutes * 60).formatted(.units(allowed: [.hours, .minutes], width: .wide))
    }
}
