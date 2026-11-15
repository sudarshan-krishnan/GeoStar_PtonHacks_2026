// Draws a pairing QR code for the phone app with Core Image (macOS, no dependencies).
// Usage: swift scripts/pair-qr.swift "<text>" out.png
import AppKit
import CoreImage

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: pair-qr.swift <text> <out.png>\n".data(using: .utf8)!)
  exit(2)
}
let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(Data(args[1].utf8), forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
guard let code = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 14, y: 14)) else { exit(1) }

// White margin around the code so cameras pick it up from a screen.
let margin: CGFloat = 56
let size = CGSize(width: code.extent.width + margin * 2, height: code.extent.height + margin * 2)
let image = NSImage(size: size)
image.lockFocus()
NSColor.white.setFill()
NSRect(origin: .zero, size: size).fill()
let rep = NSCIImageRep(ciImage: code)
rep.draw(in: NSRect(x: margin, y: margin, width: code.extent.width, height: code.extent.height))
image.unlockFocus()
guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
  let png = bitmap.representation(using: .png, properties: [:])
else { exit(1) }
try png.write(to: URL(fileURLWithPath: args[2]))
