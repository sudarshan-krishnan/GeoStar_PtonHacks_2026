import SceneKit
import SwiftUI

/// A saved scan in 3D: the room's walls, doors, windows and objects, with each Wi-Fi reading
/// where it was taken (a marker at phone height and a coverage disc on the floor) and rings on
/// dead spots. Drag to orbit, pinch to zoom.
struct ScanViewer: View {
  let scan: SavedScan
  @Environment(\.dismiss) private var dismiss
  @State private var stage: Stage

  init(scan: SavedScan) {
    self.scan = scan
    _stage = State(initialValue: Stage(scan: scan))
  }

  var body: some View {
    NavigationStack {
      ZStack(alignment: .bottom) {
        SceneView(scene: stage.scene, pointOfView: stage.camera, options: [.allowsCameraControl, .autoenablesDefaultLighting])
          .ignoresSafeArea(edges: .bottom)
        summary
      }
      .background(Color.black)
      .navigationTitle(scan.date.formatted(date: .abbreviated, time: .shortened))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
        if FileManager.default.fileExists(atPath: scan.modelURL.path) {
          ToolbarItem(placement: .primaryAction) {
            ShareLink(item: scan.modelURL) { Image(systemName: "square.and.arrow.up") }
          }
        }
      }
    }
  }

  private var summary: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let wifi = scan.wifi, !wifi.isEmpty {
        HStack(spacing: 8) {
          Chip("\(wifi.count(.good)) good", Tone.calm.color)
          Chip("\(wifi.count(.weak)) weak", Tone.watch.color)
          Chip("\(wifi.count(.dead)) dead", Tone.danger.color)
          Spacer()
          Text("\(wifi.deadSpots.count) dead spot\(wifi.deadSpots.count == 1 ? "" : "s")")
            .font(.subheadline.weight(.bold))
            .foregroundStyle(wifi.deadSpots.isEmpty ? Tone.calm.color : Tone.danger.color)
        }
        HStack(spacing: 14) {
          if let latency = wifi.medianLatency { Label("\(Int(latency)) ms median", systemImage: "timer") }
          if let mbps = wifi.medianMbps { Label(String(format: "%.0f Mbps median", mbps), systemImage: "arrow.down.circle") }
          if let best = wifi.best?.mbps { Label(String(format: "best %.0f", best), systemImage: "star.fill") }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        Text("Good: fast enough for sensors, video and the drone link. Weak: under 8 Mbps or over 150 ms. Dead: nothing got through, or under 1 Mbps.")
          .font(.caption2)
          .foregroundStyle(.secondary)
      } else {
        Text("No Wi-Fi readings in this scan. Turn on “Measure Wi-Fi while scanning” to map coverage.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      Text(scan.ceilingHeight.map { String(format: "Ceiling %.2f m · %.1f ft", $0, $0 * 3.28084) } ?? "")
        .font(.caption.weight(.semibold))
    }
    .padding(14)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .padding(12)
  }

  /// The SceneKit scene, built once per scan.
  final class Stage {
    let scene = SCNScene()
    let camera = SCNNode()

    init(scan: SavedScan) {
      scene.background.contents = UIColor(white: 0.02, alpha: 1)
      let root = scene.rootNode
      var points: [SIMD3<Float>] = []
      let surfaces = scan.surfaces ?? []

      for surface in surfaces {
        let d = surface.dimensions
        if surface.kind == "floor", let corners = surface.corners, corners.count >= 3 {
          root.addChildNode(Self.floor(corners))
          points += corners.map { SIMD3($0[0], $0[1], $0[2]) }
          continue
        }
        let thin: Float = surface.kind == "object" ? max(d[2], 0.02) : 0.04
        let box = SCNBox(width: CGFloat(max(d[0], 0.02)), height: CGFloat(max(d[1], 0.02)), length: CGFloat(thin), chamferRadius: 0)
        box.firstMaterial = Self.material(for: surface.kind)
        let node = SCNNode(geometry: box)
        node.simdTransform = surface.matrix
        root.addChildNode(node)
        points.append(SIMD3(surface.matrix.columns.3.x, surface.matrix.columns.3.y, surface.matrix.columns.3.z))
      }

      let floorY = surfaces.filter { $0.kind == "floor" }.compactMap { $0.corners?.first?[1] }.min()
        ?? (scan.wifi?.map(\.y).min()).map { $0 - 1.2 } ?? 0
      for sample in scan.wifi ?? [] {
        let color = Self.color(sample.quality)
        let marker = SCNSphere(radius: sample.quality == .dead ? 0.14 : 0.09)
        marker.firstMaterial = Self.glow(color)
        let node = SCNNode(geometry: marker)
        node.simdPosition = sample.position
        root.addChildNode(node)
        // the coverage "carpet": a disc on the floor under each reading
        let disc = SCNCylinder(radius: 0.45, height: 0.005)
        disc.firstMaterial = Self.glow(color.withAlphaComponent(0.28))
        let carpet = SCNNode(geometry: disc)
        carpet.simdPosition = SIMD3(sample.x, floorY + 0.01, sample.z)
        root.addChildNode(carpet)
        points.append(sample.position)
      }
      for spot in scan.wifi?.deadSpots ?? [] {
        let ring = SCNTorus(ringRadius: 0.7, pipeRadius: 0.03)
        ring.firstMaterial = Self.glow(Self.color(.dead))
        let node = SCNNode(geometry: ring)
        node.simdPosition = SIMD3(spot.x, floorY + 0.03, spot.z)
        let pulse = CABasicAnimation(keyPath: "scale")
        pulse.fromValue = SCNVector3(0.8, 1, 0.8)
        pulse.toValue = SCNVector3(1.25, 1, 1.25)
        pulse.duration = 1.1
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        node.addAnimation(pulse, forKey: "pulse")
        root.addChildNode(node)
      }

      // Look at everything from above and to one side.
      let lo = points.reduce(SIMD3<Float>(repeating: .infinity)) { simd_min($0, $1) }
      let hi = points.reduce(SIMD3<Float>(repeating: -.infinity)) { simd_max($0, $1) }
      let center = points.isEmpty ? .zero : (lo + hi) / 2
      let size = points.isEmpty ? 6 : max(simd_length(hi - lo), 3)
      camera.camera = SCNCamera()
      camera.camera?.zFar = 500
      // Fit the room's width on a portrait screen, seen from above and to the south.
      camera.camera?.projectionDirection = .horizontal
      camera.camera?.fieldOfView = 75
      camera.simdPosition = center + SIMD3(size * 0.08, size * 0.62, size * 0.62)
      // aim a little nearer than the middle, so the room sits above the summary panel
      camera.simdLook(at: center + SIMD3(0, 0, size * 0.14))
      root.addChildNode(camera)

      let ambient = SCNNode()
      ambient.light = SCNLight()
      ambient.light?.type = .ambient
      ambient.light?.intensity = 450
      root.addChildNode(ambient)
    }

    private static func floor(_ corners: [[Float]]) -> SCNNode {
      // Drawn in the x/z plane: the shape's y is the floor's -z (see the rotation below).
      let path = UIBezierPath()
      for (i, c) in corners.enumerated() {
        let p = CGPoint(x: CGFloat(c[0]), y: CGFloat(-c[2]))
        if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
      }
      path.close()
      let shape = SCNShape(path: path, extrusionDepth: 0.02)
      shape.firstMaterial = material(for: "floor")
      let node = SCNNode(geometry: shape)
      node.eulerAngles.x = -.pi / 2
      node.position.y = corners.map { $0[1] }.min() ?? 0
      return node
    }

    private static func material(for kind: String) -> SCNMaterial {
      let m = SCNMaterial()
      m.lightingModel = .physicallyBased
      switch kind {
      case "wall":
        // See-through, and not hiding the readings behind them from any angle.
        m.diffuse.contents = UIColor(white: 0.9, alpha: 0.16)
        m.transparencyMode = .aOne
        m.writesToDepthBuffer = false
      case "door": m.diffuse.contents = UIColor(red: 0.85, green: 0.55, blue: 0.3, alpha: 1)
      case "window", "opening":
        m.diffuse.contents = UIColor(red: 0.45, green: 0.7, blue: 1, alpha: 0.6)
        m.transparencyMode = .aOne
      case "floor": m.diffuse.contents = UIColor(white: 0.16, alpha: 1)
      default:
        m.diffuse.contents = UIColor(white: 0.55, alpha: 0.55)
        m.transparencyMode = .aOne
      }
      m.isDoubleSided = true
      return m
    }

    private static func glow(_ color: UIColor) -> SCNMaterial {
      let m = SCNMaterial()
      m.lightingModel = .constant
      m.diffuse.contents = color
      m.emission.contents = color
      m.isDoubleSided = true
      return m
    }

    private static func color(_ quality: WiFiQuality) -> UIColor {
      switch quality {
      case .good: UIColor(red: 0.36, green: 0.78, blue: 0.52, alpha: 1)
      case .weak: UIColor(red: 0.96, green: 0.78, blue: 0.25, alpha: 1)
      case .dead: UIColor(red: 0.97, green: 0.30, blue: 0.27, alpha: 1)
      }
    }
  }
}
