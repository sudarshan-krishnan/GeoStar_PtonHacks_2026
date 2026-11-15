import SwiftUI

/// The Drone tab: fly the Tello through the laptop's bridge, or scan a room with the iPhone's LiDAR.
struct DroneView: View {
  @Environment(AppModel.self) private var app
  @State private var showConnections = false

  var body: some View {
    @Bindable var app = app
    NavigationStack {
      VStack(spacing: 0) {
        Picker("Mode", selection: $app.droneMode) {
          ForEach(AppModel.DroneMode.allCases, id: \.self) { Text($0.rawValue) }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        switch app.droneMode {
        case .fly: FlyView()
        case .scan: LiDARScanView()
        }
      }
      .background(Color.black)
      .navigationTitle("Drone")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Connections", systemImage: "link") { showConnections = true }
        }
      }
      .sheet(isPresented: $showConnections) { ConnectionsView() }
    }
  }
}

/// Live feed, telemetry and flight controls. Commands go phone → gateway → web app → bridge → Tello.
struct FlyView: View {
  @Environment(AppModel.self) private var app
  @State private var status: DroneStatus?
  @State private var unreachable: String?
  @State private var stream = MJPEGStream()
  @State private var busy: DroneAction?
  @State private var captures: [DroneCapture] = []
  @State private var notice: String?
  @State private var confirmTakeoff = false
  @State private var cutting = false
  @State private var sent = 0
  @State private var capturing = false

  private var ready: Bool { status?.ready == true }
  private var flying: Bool { status?.flying == true }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        statusCard
        feed
        if flying {
          Label("Flying. Land before you leave this screen or close the app.", systemImage: "exclamationmark.triangle.fill")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Tone.warn.color)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        controls
        if !captures.isEmpty { capturesStrip }
        if status?.expansion == true {
          Text("With the expansion kit, forward moves stop 50 cm short of anything the distance sensor sees (it only looks ahead), and the drone's display shows people nearby what it's doing: a 3-2-1 countdown before take-off, arrows while moving, a red X when it stops.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Text("Each tap moves the drone 30 cm or turns it 45°. The bridge keeps a hovering Tello from landing on its own; it does not land if the phone disconnects.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .padding(16)
    }
    .task(id: app.droneConnection?.baseURL) {
      guard let api = app.droneAPI else { return }
      stream.start(api.droneVideoRequest())
      await loadCaptures()
      while !Task.isCancelled {
        await refresh()
        try? await Task.sleep(for: .seconds(1))
      }
    }
    .onDisappear { stream.stop() }
    .sensoryFeedback(.impact(weight: .medium), trigger: sent)
    .confirmationDialog("Take off?", isPresented: $confirmTakeoff, titleVisibility: .visible) {
      Button("Take off") { send(.takeoff) }
    } message: {
      Text("Clear about 2 m around the drone and keep people back. It rises to about 1 m and hovers.")
    }
    .overlay(alignment: .bottom) {
      if let notice { Toast(text: notice) }
    }
    .animation(.snappy, value: notice)
  }

  // MARK: status

  private var statusCard: some View {
    Card {
      HStack(spacing: 10) {
        Circle()
          .fill(ready ? Tone.calm.color : (status?.bridge == true ? Tone.watch.color : Tone.danger.color))
          .frame(width: 10, height: 10)
        Text(headline).font(.headline)
        Spacer()
        if status?.mock == true { Chip("Simulated", Tone.watch.color) }
      }
      if ready, let status {
        HStack(spacing: 8) {
          metric("battery.75percent", status.battery.map { "\(Int($0))%" } ?? "–", "Battery")
          metric("arrow.up.and.down", status.height.map { String(format: "%.1f m", $0 / 100) } ?? "–", "Height")
          metric("thermometer.medium", status.temp.map { "\(Int($0))°C" } ?? "–", "Temp")
          metric(flying ? "airplane" : "airplane.arrival", flying ? "Flying" : "Landed", "State")
        }
        if status.expansion == true {
          HStack(spacing: 8) {
            metric(
              "sensor.fill", status.aheadCM.map { String(format: "%.1f m", $0 / 100) } ?? "Clear",
              "Ahead (ToF)", warn: status.blockedAhead)
            VStack(spacing: 4) {
              DotMatrix(pattern: status.display)
                .frame(width: 44, height: 44)
              Text("Drone display").font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          }
        }
      } else {
        Text(detail).font(.subheadline).foregroundStyle(.secondary)
      }
    }
  }

  private var headline: String {
    guard let status else { return unreachable == nil ? "Checking the drone…" : "Can't reach the laptop" }
    if !status.bridge { return "Drone bridge isn't running" }
    if status.connected != true { return "Waiting for the drone" }
    return status.mock == true ? "Simulated drone ready" : "Drone connected"
  }

  private var detail: String {
    if let unreachable { return unreachable }
    guard let status else { return "" }
    if !status.bridge {
      if app.droneConnection?.baseURL.scheme == "https" {
        return "The deployed website can't reach a drone. On the laptop, run npm run mobile:pair -- --role drone and scan the code, so the drone flies through the laptop."
      }
      return "Start it on the laptop: npm run mobile:service install (with TELLO_IP set), or python bridge/server.py --tello-ip 172.20.10.14."
    }
    return (status.error.map { "\($0). " } ?? "") + "Turn the Tello on. In station mode it joins your hotspot and the bridge connects on its own."
  }

  private func metric(_ symbol: String, _ value: String, _ label: String, warn: Bool = false) -> some View {
    VStack(spacing: 4) {
      Image(systemName: symbol).font(.subheadline).foregroundStyle(warn ? Tone.danger.color : .secondary)
      Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
        .foregroundStyle(warn ? Tone.danger.color : .primary)
      Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 8)
    .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
  }

  // MARK: feed

  private var feed: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color(white: 0.06))
      if let frame = stream.frame {
        Image(uiImage: frame).resizable().scaledToFit()
      } else {
        VStack(spacing: 10) {
          Image(systemName: "video.slash").font(.largeTitle).foregroundStyle(.secondary)
          Text(ready ? "Waiting for video…" : "No video yet").font(.subheadline).foregroundStyle(.secondary)
        }
      }
    }
    .aspectRatio(4 / 3, contentMode: .fit)
    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    .overlay(alignment: .topLeading) {
      if stream.live {
        Label(status?.mock == true ? "SIM" : "LIVE", systemImage: "circle.fill")
          .font(.caption.weight(.bold))
          .foregroundStyle(.white)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background((status?.mock == true ? Tone.watch.deep : Tone.danger.deep).opacity(0.85), in: Capsule())
          .padding(10)
      }
    }
    .overlay(alignment: .topTrailing) {
      Button(action: capture) {
        Group {
          if capturing { ProgressView() } else { Image(systemName: "camera.fill") }
        }
        .font(.headline)
        .frame(width: 44, height: 44)
        .background(.ultraThinMaterial, in: Circle())
      }
      .disabled(!stream.live || capturing)
      .padding(10)
      .accessibilityLabel("Capture a frame")
    }
  }

  // MARK: controls

  private var controls: some View {
    VStack(spacing: 16) {
      HStack(spacing: 12) {
        bigButton("Take off", "airplane.departure", tint: Tone.calm.color, disabled: !ready || flying || busy != nil) {
          confirmTakeoff = true
        }
        bigButton("Land", "airplane.arrival", tint: .accentColor, disabled: !ready || busy == .land) { send(.land) }
      }
      HStack(alignment: .top, spacing: 16) {
        pad("Height & turn") {
          padButton(.up, "arrow.up", "Up")
          HStack(spacing: 8) {
            padButton(.ccw, "arrow.counterclockwise", "Turn left")
            padButton(.down, "arrow.down", "Down")
            padButton(.cw, "arrow.clockwise", "Turn right")
          }
        }
        pad("Move") {
          padButton(.forward, "arrow.up", "Forward", blocked: status?.blockedAhead == true)
          HStack(spacing: 8) {
            padButton(.left, "arrow.left", "Left")
            padButton(.back, "arrow.down", "Back")
            padButton(.right, "arrow.right", "Right")
          }
        }
      }
      // Emergency: motors stop at once and the drone drops, so it takes a deliberate press.
      Label(cutting ? "Keep holding…" : "Hold to cut motors", systemImage: "exclamationmark.octagon.fill")
        .font(.headline)
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background((cutting ? Tone.danger.color : Tone.danger.deep), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .scaleEffect(cutting ? 0.97 : 1)
        .animation(.snappy, value: cutting)
        .opacity(status?.bridge == true ? 1 : 0.4)
        .onLongPressGesture(minimumDuration: 0.6) {
          if status?.bridge == true { send(.emergency) }
        } onPressingChanged: { cutting = $0 }
        .accessibilityLabel("Emergency motor stop. Press and hold.")
        .accessibilityAction(named: "Cut motors") { send(.emergency) }
    }
  }

  private func bigButton(_ title: String, _ symbol: String, tint: Color, disabled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(title, systemImage: symbol)
        .font(.headline)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
    .buttonStyle(.borderedProminent)
    .tint(tint)
    .controlSize(.large)
    .disabled(disabled)
  }

  private func pad<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(spacing: 8) {
      Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
      content()
    }
    .frame(maxWidth: .infinity)
    .padding(12)
    .background(Color(white: 0.11), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
  }

  private func padButton(_ action: DroneAction, _ symbol: String, _ label: String, blocked: Bool = false) -> some View {
    Button { send(action) } label: {
      Group {
        if busy == action {
          ProgressView()
        } else {
          Image(systemName: blocked ? "hand.raised.fill" : symbol).font(.title3.weight(.semibold))
        }
      }
      .frame(width: 46, height: 46)
      .background(blocked ? Tone.danger.deep : Color.white.opacity(0.08), in: Circle())
    }
    .buttonStyle(.plain)
    .disabled(!ready || !flying || busy != nil || blocked)
    .opacity(ready && flying ? 1 : 0.35)
    .accessibilityLabel(blocked ? "\(label), blocked: something is close ahead" : label)
  }

  // MARK: captures

  private var capturesStrip: some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionTitle("Captured frames", systemImage: "photo.on.rectangle")
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(captures) { capture in
            if let api = app.droneAPI {
              AuthImage(request: api.captureRequest(capture))
                .frame(width: 120, height: 90)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
          }
        }
      }
      Text("Saved on the laptop in captures/.").font(.caption).foregroundStyle(.secondary)
    }
  }

  // MARK: actions

  private func refresh() async {
    guard let api = app.droneAPI else { return }
    do {
      status = try await api.droneStatus()
      unreachable = nil
    } catch {
      unreachable = error.localizedDescription
    }
  }

  private func loadCaptures() async {
    guard let api = app.droneAPI else { return }
    captures = (try? await api.droneCaptures()) ?? []
  }

  private func send(_ action: DroneAction) {
    guard let api = app.droneAPI else { return }
    if action != .emergency { busy = action }
    Task {
      defer { if busy == action { busy = nil } }
      do {
        try await api.drone(action)
        sent += 1
        await refresh()
      } catch {
        flash(error.localizedDescription)
      }
    }
  }

  private func capture() {
    guard let api = app.droneAPI else { return }
    capturing = true
    Task {
      defer { capturing = false }
      do {
        let shot = try await api.droneSnapshot()
        captures.insert(shot, at: 0)
        sent += 1
      } catch {
        flash(error.localizedDescription)
      }
    }
  }

  private func flash(_ text: String) {
    notice = text
    Task {
      try? await Task.sleep(for: .seconds(4))
      if notice == text { notice = nil }
    }
  }
}

/// An image that needs the access token to load.
struct AuthImage: View {
  let request: URLRequest
  @State private var image: UIImage?

  var body: some View {
    ZStack {
      Color.white.opacity(0.06)
      if let image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        ProgressView()
      }
    }
    .task(id: request.url) {
      if let (data, _) = try? await URLSession.shared.data(for: request) { image = UIImage(data: data) }
    }
  }
}

/// A copy of the drone's 8x8 dot-matrix display.
struct DotMatrix: View {
  let pattern: String?

  var body: some View {
    Canvas { ctx, size in
      let cell = min(size.width, size.height) / 8
      let chars = Array(pattern ?? "")
      for i in 0..<64 {
        let rect = CGRect(x: CGFloat(i % 8) * cell, y: CGFloat(i / 8) * cell, width: cell, height: cell).insetBy(dx: cell * 0.12, dy: cell * 0.12)
        let color: Color =
          switch i < chars.count ? chars[i] : "0" {
          case "r": Tone.danger.color
          case "b": Color(red: 0.35, green: 0.6, blue: 1)
          case "p": Color(red: 0.75, green: 0.4, blue: 1)
          default: .white.opacity(0.08)
          }
        ctx.fill(Path(ellipseIn: rect), with: .color(color))
      }
    }
    .accessibilityLabel(pattern == nil ? "Drone display blank" : "Drone display")
  }
}
