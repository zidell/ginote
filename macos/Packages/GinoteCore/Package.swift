// swift-tools-version: 6.0
import PackageDescription

// 화면과 무관한 Ginote 로직(macos/DESIGN.md §4). 앱 타깃이 이 패키지를 쓰고, 테스트는
// `swift test`로 앱 없이 돌린다.
let package = Package(
    name: "GinoteCore",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "GinoteCore", targets: ["GinoteCore"]),
        // 테스트용 가짜 GitHub(메모리 저장소). 이 패키지와 앱(GinoteTests)의 테스트가 함께 쓴다.
        .library(name: "GinoteTestSupport", targets: ["GinoteTestSupport"])
    ],
    dependencies: [
        .package(url: "https://github.com/LebJe/TOMLKit.git", from: "0.6.0")
    ],
    targets: [
        .target(
            name: "GinoteCore",
            dependencies: [.product(name: "TOMLKit", package: "TOMLKit")]
        ),
        // 공통 모듈에 의존하지 않는다. 앱 테스트에 공통 모듈이 한 벌 더 들어가면 정적 값(sessionOverride)이 갈린다.
        .target(name: "GinoteTestSupport"),
        .testTarget(
            name: "GinoteCoreTests",
            dependencies: ["GinoteCore", "GinoteTestSupport"],
            resources: [.copy("Fixtures")]
        )
    ],
    swiftLanguageModes: [.v5]
)
