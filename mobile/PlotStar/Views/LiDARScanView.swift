import ARKit
import RoomPlan
import SwiftUI

/// Room scans with the iPhone's LiDAR (Apple RoomPlan): walk a space, get its walls, doors and
/// windows as a 3D model with the numbers a site visit needs, like ceiling (clear) height. With
/// "Measure Wi-Fi" on, the same walk maps Wi-Fi: each reading is placed where it was taken and
/// dead spots are flagged as you go. The Tello has no LiDAR; this uses the phone.
struct LiDARScanView: View {
  @Environment(AppModel.self) private var app
  @State private var scans = SavedScan.all()
  @State private var scanning = false
  @State private var viewing: SavedScan?
  @State private var measureWiFi = true
  @State private var probe: WiFiProbe?
  @State private var check: String?
  @State private var reachable = false

  private let supported = RoomCaptureSession.isSupported

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Label("Scan a room with LiDAR", systemImage: "cube.transparent").font(.headline)
          Text("Walk the space slowly and point the phone at every wall, the floor and the ceiling. You get a 3D model with ceiling (clear) height, floor area, walls, doors and windows.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
          Toggle(isOn: $measureWiFi) {
            VStack(alignment: .leading, spacing: 2) {
              Text("Measure Wi-Fi while scanning").font(.subheadline.weight(.semibold))
              Text(wifiStatus).font(.caption).foregroundStyle(wifiReady ? Tone.calm.color : .secondary)
            }
          }
          Button {
            scanning = true
          } label: {
            Label("Start scan", systemImage: "viewfinder")
              .fontWeight(.semibold)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 4)
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .disabled(!supported)
          if !supported {
            Text("This device has no LiDAR (iPhone Pro models from 12 Pro have it). You can still open saved scans.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 6)
      }
      if !scans.isEmpty {
        Section("Saved scans") {
          ForEach(scans) { scan in
            ScanRow(scan: scan) { viewing = scan }
          }
          .onDelete { offsets in
            for i in offsets { scans[i].delete() }
            scans.remove(atOffsets: offsets)
          }
        }
      }
      Section {
        Text("Wi-Fi is measured as response time and download speed to your PlotStar server, because iOS doesn't let apps read signal strength. Use the map to place wireless sensors (like HAVEN's DataBot) and the drone link, and to find where staff lose the network. Data halls run on wired fiber, so it doesn't rate a spot for servers.")
          .font(.caption)
          .foregroundStyle(.secondary)
        Text("RoomPlan is built for rooms up to about 9 m (30 ft) across. In a warehouse, scan offices, electrical rooms and single bays. Measurements are estimates.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .scrollContentBackground(.hidden)
    .fullScreenCover(isPresented: $scanning) {
      RoomScanScreen(probe: wifiReady ? probe : nil) {
        scans.insert($0, at: 0)
        viewing = $0
      }
    }
    .fullScreenCover(item: $viewing) { ScanViewer(scan: $0) }
    .task(id: measureWiFi) { await checkWiFi() }
    .onChange(of: app.pendingScan, initial: true) { _, id in
      guard let id else { return }
      app.pendingScan = nil
      scans = SavedScan.all()
      viewing = scans.first { $0.id == id }
    }
    .onDisappear { probe?.stop() }
  }

  private var wifiReady: Bool { measureWiFi && reachable && probe?.onWiFi == true }

  private var wifiStatus: String {
    guard measureWiFi else { return "Off" }
    guard let probe else { return "Not connected to a PlotStar server" }
    if !probe.onWiFi { return "Join the building's Wi-Fi first (not your hotspot): the survey measures the Wi-Fi this phone is on." }
    return check ?? "Checking \(probe.host)…"
  }

  private func checkWiFi() async {
    guard measureWiFi, let api = app.api else { return }
    let probe = self.probe ?? WiFiProbe(api: api)
    self.probe = probe
    reachable = false
    check = nil
    // Give the path monitor a moment, then try the server once over Wi-Fi.
    try? await Task.sleep(for: .milliseconds(400))
    let (latency, mbps) = await probe.measure()
    if let latency {
      reachable = true
      check = "Ready: \(probe.host) answers in \(Int(latency)) ms" + (mbps.map { String(format: " · %.0f Mbps", $0) } ?? "")
    } else {
      check = "Can't reach \(probe.host) over this Wi-Fi. Use the deployed website, or put the laptop on this Wi-Fi and allow it (MOBILE_ALLOW)."
    }
  }
}

private struct ScanRow: View {
  let scan: SavedScan
  let open: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(scan.date.formatted(date: .abbreviated, time: .shortened)).font(.headline)
        Spacer()
        Button("3D", systemImage: "cube", action: open)
          .buttonStyle(.bordered)
          .controlSize(.small)
        if FileManager.default.fileExists(atPath: scan.modelURL.path) {
          ShareLink(item: scan.modelURL) { Image(systemName: "square.and.arrow.up") }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
      }
      Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
        GridRow {
          fact("Ceiling height", scan.ceilingHeight.map { String(format: "%.2f m · %.1f ft", $0, $0 * 3.28084) } ?? "–")
          fact("Floor area", scan.floorArea.map { String(format: "%.0f m² · %.0f sq ft", $0, $0 * 10.7639) } ?? "–")
        }
        GridRow {
          fact("Walls", "\(scan.walls) · \(String(format: "%.1f m", scan.wallLength)) total")
          fact("Doors · windows", "\(scan.doors) · \(scan.windows)")
        }
      }
      if let wifi = scan.wifi, !wifi.isEmpty {
        HStack(spacing: 8) {
          Image(systemName: "wifi").foregroundStyle(.secondary)
          Text("\(wifi.count) readings")
          Chip("\(wifi.count(.good)) good", Tone.calm.color)
          if wifi.count(.weak) > 0 { Chip("\(wifi.count(.weak)) weak", Tone.watch.color) }
          if !wifi.deadSpots.isEmpty { Chip("\(wifi.deadSpots.count) dead spot\(wifi.deadSpots.count == 1 ? "" : "s")", Tone.danger.color) }
        }
        .font(.caption)
      }
    }
    .padding(.vertical, 4)
  }

  private func fact(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(label).font(.caption).foregroundStyle(.secondary)
      Text(value).font(.subheadline.weight(.semibold))
    }
  }
}

// MARK: - Capture

/// Full-screen RoomPlan capture: scan (and survey Wi-Fi), tap Done to process, then Save.
private struct RoomScanScreen: View {
  let probe: WiFiProbe?
  let onSaved: (SavedScan) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var controller = RoomScanController()
  @State private var saveError: String?

  var body: some View {
    ZStack(alignment: .top) {
      RoomCaptureContainer(controller: controller)
        .ignoresSafeArea()
        .onAppear { controller.start(probe: probe) }
      VStack(spacing: 10) {
        HStack {
          Button("Cancel") {
            controller.stop()
            dismiss()
          }
          .buttonStyle(.bordered)
          Spacer()
          if controller.result != nil {
            Button("Save", action: save).buttonStyle(.borderedProminent)
          } else {
            Button(controller.finishing ? "Processing…" : "Done") { controller.stop() }
              .buttonStyle(.borderedProminent)
              .disabled(controller.finishing)
          }
        }
        .controlSize(.large)
        if let alert = controller.wifiAlert {
          Label(alert, systemImage: "wifi.exclamationmark")
            .font(.headline)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Tone.danger.deep, in: Capsule())
            .transition(.move(edge: .top).combined(with: .opacity))
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
      .animation(.snappy, value: controller.wifiAlert)
    }
    .overlay(alignment: .bottom) {
      if probe != nil, controller.result == nil { wifiHUD }
    }
    .sensoryFeedback(.error, trigger: controller.alerts)
    .alert("Couldn't save the scan", isPresented: .constant(saveError != nil || controller.failure != nil)) {
      Button("OK") {
        saveError = nil
        controller.failure = nil
      }
    } message: {
      Text(saveError ?? controller.failure ?? "")
    }
  }

  private var wifiHUD: some View {
    let last = controller.wifi.last
    let tone: Tone =
      switch last?.quality {
      case .good: .calm
      case .weak: .watch
      case .dead: .danger
      case nil: .recovering
      }
    return HStack(spacing: 10) {
      Image(systemName: last?.quality == .dead ? "wifi.slash" : "wifi")
        .foregroundStyle(tone.color)
      if let last {
        Text(last.latencyMs.map { "\(Int($0)) ms" } ?? "no response")
        Text(last.mbps.map { String(format: "%.0f Mbps", $0) } ?? "–")
      } else {
        Text("Measuring Wi-Fi…")
      }
      Text("·")
      Text("\(controller.wifi.count) readings, \(controller.wifi.deadSpots.count) dead")
    }
    .font(.subheadline.weight(.semibold).monospacedDigit())
    .foregroundStyle(.white)
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(.ultraThinMaterial, in: Capsule())
    .padding(.bottom, 40)
  }

  private func save() {
    guard let room = controller.result else { return }
    do {
      let scan = SavedScan(room: room, wifi: controller.wifi)
      try FileManager.default.createDirectory(at: SavedScan.folder, withIntermediateDirectories: true)
      try room.export(to: scan.modelURL, exportOptions: .parametric)
      try scan.save()
      onSaved(scan)
      dismiss()
    } catch {
      saveError = error.localizedDescription
    }
  }
}

private struct RoomCaptureContainer: UIViewRepresentable {
  let controller: RoomScanController
  func makeUIView(context: Context) -> RoomCaptureView { controller.view }
  func updateUIView(_ view: RoomCaptureView, context: Context) {}
}

@Observable
final class RoomScanController {
  let view = RoomCaptureView(frame: .zero)
  fileprivate(set) var result: CapturedRoom?
  fileprivate(set) var finishing = false
  var failure: String?
  /// Wi-Fi readings taken during this scan, placed where the phone was.
  private(set) var wifi: [WiFiSample] = []
  /// "Dead spot here" while it's showing; `alerts` counts them (drives the haptic).
  private(set) var wifiAlert: String?
  private(set) var alerts = 0
  private let delegate = Delegate()
  private var running = false
  private var survey: Task<Void, Never>?
  private var lastAlert = Date.distantPast

  init() {
    delegate.owner = self
    view.delegate = delegate
  }

  func start(probe: WiFiProbe?) {
    guard !running else { return }
    running = true
    view.captureSession.run(configuration: RoomCaptureSession.Configuration())
    if let probe { survey = Task { await surveyLoop(probe) } }
  }

  /// Ends capture; RoomPlan then processes the scan and shows the finished model.
  func stop() {
    survey?.cancel()
    guard running else { return }
    running = false
    finishing = true
    view.captureSession.stop()
  }

  private func surveyLoop(_ probe: WiFiProbe) async {
    while !Task.isCancelled {
      let started = ContinuousClock.now
      if let spot = position() {
        let (latency, mbps) = await probe.measure()
        guard !Task.isCancelled else { return }
        let sample = WiFiSample(x: spot.x, y: spot.y, z: spot.z, latencyMs: latency, mbps: mbps, at: .now)
        let previous = wifi.last?.quality
        wifi.append(sample)
        notify(sample.quality, previous: previous)
      }
      try? await Task.sleep(until: started + .seconds(1.5))
    }
  }

  /// Where the phone is now, in the scan's coordinates (the same space as the walls).
  private func position() -> SIMD3<Float>? {
    guard let frame = view.captureSession.arSession.currentFrame,
      case .normal = frame.camera.trackingState
    else { return nil }
    let p = frame.camera.transform.columns.3
    return SIMD3(p.x, p.y, p.z)
  }

  private func notify(_ quality: WiFiQuality, previous: WiFiQuality?) {
    let worse = quality.rank < (previous?.rank ?? 2)
    guard quality != .good, worse || Date.now.timeIntervalSince(lastAlert) > 6 else { return }
    lastAlert = .now
    alerts += 1
    let text = quality == .dead ? "Wi-Fi dead spot here" : "Weak Wi-Fi here"
    wifiAlert = text
    Task {
      try? await Task.sleep(for: .seconds(3))
      if wifiAlert == text { wifiAlert = nil }
    }
  }

  @objc(PlotStarRoomCaptureDelegate)
  final class Delegate: NSObject, @preconcurrency RoomCaptureViewDelegate {
    weak var owner: RoomScanController?

    override init() { super.init() }
    // RoomCaptureViewDelegate inherits NSCoding; there is nothing to archive.
    required init?(coder: NSCoder) { super.init() }
    func encode(with coder: NSCoder) {}

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: (any Error)?) -> Bool { true }

    func captureView(didPresent processedResult: CapturedRoom, error: (any Error)?) {
      owner?.finishing = false
      if let error { owner?.failure = error.localizedDescription }
      owner?.result = processedResult
    }
  }
}

// MARK: - Saved scans

/// A wall, door, window, opening, floor or object, enough to redraw the room in 3D.
struct SavedSurface: Codable, Hashable {
  /// wall | door | window | opening | floor | object
  let kind: String
  /// Column-major 4x4 transform in the scan's coordinates.
  let transform: [Float]
  /// Width, height, depth in metres.
  let dimensions: [Float]
  /// Floors: the outline in scan coordinates, when RoomPlan provides one.
  let corners: [[Float]]?

  var matrix: simd_float4x4 {
    guard transform.count == 16 else { return matrix_identity_float4x4 }
    let t = transform
    return simd_float4x4(
      SIMD4(t[0], t[1], t[2], t[3]), SIMD4(t[4], t[5], t[6], t[7]),
      SIMD4(t[8], t[9], t[10], t[11]), SIMD4(t[12], t[13], t[14], t[15]))
  }
}

/// A scan on this phone: the USDZ model, plus a JSON summary with the room's geometry and any
/// Wi-Fi readings, in Documents/Scans.
struct SavedScan: Codable, Identifiable {
  let id: String
  let date: Date
  let walls: Int
  let doors: Int
  let windows: Int
  let openings: Int
  let objects: [String: Int]
  /// Tallest wall, in metres: the room's ceiling (clear) height.
  let ceilingHeight: Double?
  /// Square metres, from the floor outline.
  let floorArea: Double?
  /// Metres of wall.
  let wallLength: Double
  let surfaces: [SavedSurface]?
  let wifi: [WiFiSample]?

  static var folder: URL { URL.documentsDirectory.appending(path: "Scans", directoryHint: .isDirectory) }
  var modelURL: URL { Self.folder.appending(path: "\(id).usdz") }
  private var infoURL: URL { Self.folder.appending(path: "\(id).json") }

  static func all() -> [SavedScan] {
    let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.pathExtension == "json" }
      .compactMap { try? JSONDecoder().decode(SavedScan.self, from: Data(contentsOf: $0)) }
      .sorted { $0.date > $1.date }
  }

  func save() throws { try JSONEncoder().encode(self).write(to: infoURL) }

  func delete() {
    try? FileManager.default.removeItem(at: modelURL)
    try? FileManager.default.removeItem(at: infoURL)
  }
}

extension SavedScan {
  init(room: CapturedRoom, wifi: [WiFiSample]) {
    let now = Date.now
    id = "scan-" + now.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false)).replacingOccurrences(of: ":", with: "")
    date = now
    walls = room.walls.count
    doors = room.doors.count
    windows = room.windows.count
    openings = room.openings.count
    objects = Dictionary(grouping: room.objects) { String(describing: $0.category) }.mapValues(\.count)
    ceilingHeight = room.walls.map { Double($0.dimensions.y) }.max()
    wallLength = room.walls.reduce(0) { $0 + Double($1.dimensions.x) }
    let area = room.floors.map(Self.area).reduce(0, +)
    floorArea = area > 0 ? area : nil
    surfaces = room.walls.map { Self.saved("wall", $0) } + room.doors.map { Self.saved("door", $0) }
      + room.windows.map { Self.saved("window", $0) } + room.openings.map { Self.saved("opening", $0) }
      + room.floors.map { Self.saved("floor", $0) }
      + room.objects.map {
        SavedSurface(kind: "object", transform: Self.flat($0.transform), dimensions: [$0.dimensions.x, $0.dimensions.y, $0.dimensions.z], corners: nil)
      }
    self.wifi = wifi.isEmpty ? nil : wifi
  }

  private static func saved(_ kind: String, _ surface: CapturedRoom.Surface) -> SavedSurface {
    // Floor outlines are in the surface's own coordinates; store them in scan coordinates.
    let corners: [[Float]]? =
      kind == "floor"
      ? surface.polygonCorners.map { c in
        let w = surface.transform * SIMD4(c.x, c.y, c.z, 1)
        return [w.x, w.y, w.z]
      } : nil
    return SavedSurface(
      kind: kind, transform: flat(surface.transform),
      dimensions: [surface.dimensions.x, surface.dimensions.y, surface.dimensions.z], corners: corners)
  }

  private static func flat(_ m: simd_float4x4) -> [Float] {
    [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
  }

  /// The floor polygon's area, on whichever two axes its corners spread across.
  private static func area(_ surface: CapturedRoom.Surface) -> Double {
    let corners = surface.polygonCorners
    guard corners.count >= 3 else { return Double(surface.dimensions.x * surface.dimensions.y) }
    let spread = (0..<3).map { axis in
      (corners.map { $0[axis] }.max() ?? 0) - (corners.map { $0[axis] }.min() ?? 0)
    }
    let axes = (0..<3).sorted { spread[$0] > spread[$1] }
    let (a, b) = (axes[0], axes[1])
    var sum: Float = 0
    for i in corners.indices {
      let p = corners[i], q = corners[(i + 1) % corners.count]
      sum += p[a] * q[b] - q[a] * p[b]
    }
    return Double(abs(sum) / 2)
  }
}
