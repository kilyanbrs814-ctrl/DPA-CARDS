// Generate a square, opaque iOS icon using the existing official DPA Cards logo.
// Called after `npx cap add ios`. Requires only macOS AppKit (no third-party dependencies).
import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: swift make-ios-icon.swift <source-logo.png> <AppIcon-512@2x.png>")
}
let sourcePath = CommandLine.arguments[1]
let targetPath = CommandLine.arguments[2]
guard let source = NSImage(contentsOfFile: sourcePath), source.size.width > 0, source.size.height > 0 else {
    fatalError("Cannot load the existing DPA Cards brand asset at \(sourcePath)")
}
let side = 1024
guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
                                   bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                   isPlanar: false, colorSpaceName: .deviceRGB,
                                   bytesPerRow: 0, bitsPerPixel: 0) else {
    fatalError("Cannot allocate an App Store icon canvas")
}
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fatalError("Cannot create an icon drawing context")
}
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor(calibratedRed: 246/255, green: 245/255, blue: 241/255, alpha: 1.0).setFill()
NSBezierPath.fill(NSRect(x: 0, y: 0, width: side, height: side))
let ratio = source.size.width / source.size.height
let width = min(CGFloat(side) * 0.82, CGFloat(side) * 0.70 * ratio)
let height = width / ratio
let rect = NSRect(x: (CGFloat(side) - width)/2, y: (CGFloat(side) - height)/2,
                  width: width, height: height)
source.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1.0)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()
guard let data = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Cannot serialize the app icon")
}
try data.write(to: URL(fileURLWithPath: targetPath), options: .atomic)
print("Wrote branded opaque 1024x1024 iOS icon: \(targetPath)")
