import Foundation
import Vision
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
guard CommandLine.arguments.count == 3 else { fatalError("image.png output.txt") }
let file = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let context = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("Invalid PNG") }
context.setFillColor(CGColor(gray: 1, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: image.width, height: image.height))
context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
guard let opaque = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(file as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("Cannot write RGB PNG") }
CGImageDestinationAddImage(destination, opaque, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Cannot finalize RGB PNG") }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["fr-FR", "en-US"]
try VNImageRequestHandler(url: file).perform([request])
let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
try text.write(toFile: CommandLine.arguments[2], atomically: true, encoding: .utf8)
guard text.count > 80, !text.contains("Espace non actif"), !text.contains("Service de connexion indisponible") else { fatalError("Application not ready: " + text) }
print("OCR verified \(text.count) characters")
