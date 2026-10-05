// swift-tools-version: 6.0
import PackageDescription

// 화면과 무관한 Ginote 로직(macos/DESIGN.md §4). 앱 타깃이 이 패키지를 쓰고, 테스트는
// `swift test`로 앱 없이 돌린다.
let package = Package(
    name: "GinoteCore",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "GinoteCore", targets: ["GinoteCore"])
    ],
    dependencies: [
        .package(url: "https://github.com/LebJe/TOMLKit.git", from: "0.6.0")
    ],
    targets: [
        .target(
            name: "GinoteCore",
            dependencies: [.product(name: "TOMLKit", package: "TOMLKit")]
        ),
        .testTarget(
            name: "GinoteCoreTests",
            dependencies: ["GinoteCore"],
            resources: [.copy("Fixtures")]
        )
    ],
    swiftLanguageModes: [.v5]
)
