// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MeasuredPublicationSigner",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "MeasuredSignerCore", targets: ["MeasuredSignerCore"]),
        .executable(name: "measured-publication-signer", targets: ["MeasuredPublicationSigner"])
    ],
    targets: [
        .target(name: "MeasuredSignerCore"),
        .executableTarget(
            name: "MeasuredPublicationSigner",
            dependencies: ["MeasuredSignerCore"]
        ),
        .testTarget(
            name: "MeasuredSignerCoreTests",
            dependencies: ["MeasuredSignerCore"]
        )
    ]
)
