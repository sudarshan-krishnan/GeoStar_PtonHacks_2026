import Foundation
import Network
import simd

/// One Wi-Fi reading, taken where the phone was standing during a room scan.
struct WiFiSample: Codable, Hashable {
  /// The phone's position in metres, in the scan's coordinates (y is up).
  let x: Float
  let y: Float
  let z: Float
  /// Round trip of a tiny request; nil when it didn't get through.
  let latencyMs: Double?
  /// Speed of a 256 KB download; nil when it didn't finish.
  let mbps: Double?
  let at: Date

  var quality: WiFiQuality { WiFiQuality(latencyMs: latencyMs, mbps: mbps) }
  var position: SIMD3<Float> { SIMD3(x, y, z) }
}

/// Good, weak or dead, from what a device in that spot would experience.
enum WiFiQuality: String, Codable, CaseIterable {
  case good, weak, dead

  /// Dead: nothing got through, or too slow to use (under 1 Mbps or over 500 ms).
  /// Weak: works but strained (under 8 Mbps or over 150 ms). Good: everything else.
  init(latencyMs: Double?, mbps: Double?) {
    guard let latency = latencyMs, let speed = mbps else {
      self = .dead
      return
    }
    if speed < 1 || latency > 500 {
      self = .dead
    } else if speed < 8 || latency > 150 {
      self = .weak
    } else {
      self = .good
    }
  }

  var rank: Int {
    switch self {
    case .good: 2
    case .weak: 1
    case .dead: 0
    }
  }
}

/// Measures Wi-Fi where the phone is: response time and download speed against the PlotStar
/// server (the laptop or the deployed website), over Wi-Fi only, never cellular.
/// iOS doesn't let apps read Wi-Fi signal strength, so this measures what devices there would get.
@Observable
final class WiFiProbe {
  /// The phone has a working Wi-Fi path (it isn't the hotspot, or on cellular only).
  private(set) var onWiFi = false
  let host: String
  private let api: API
  private let session: URLSession
  private let monitor = NWPathMonitor()

  init(api: API) {
    self.api = api
    host = api.connection.baseURL.host() ?? "the server"
    let config = URLSessionConfiguration.ephemeral
    config.allowsCellularAccess = false
    config.waitsForConnectivity = false
    config.timeoutIntervalForRequest = 2.5
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.urlCache = nil
    session = URLSession(configuration: config)
    monitor.pathUpdateHandler = { [weak self] path in
      let wifi = path.status == .satisfied && path.usesInterfaceType(.wifi)
      Task { @MainActor in self?.onWiFi = wifi }
    }
    monitor.start(queue: DispatchQueue(label: "plotstar.wifi-path"))
  }

  func stop() { monitor.cancel() }

  /// One reading: response time (ms) and download speed (Mbps); nils for what failed.
  func measure() async -> (latencyMs: Double?, mbps: Double?) {
    guard let latency = await time(kb: 0) else { return (nil, nil) }
    guard let download = await time(kb: 256) else { return (latency, nil) }
    return (latency, 256 * 1024 * 8 / (download / 1000) / 1_000_000)
  }

  private func time(kb: Int) async -> Double? {
    let url = api.connection.baseURL.appending(path: "api/mobile/probe")
      .appending(queryItems: [URLQueryItem(name: "kb", value: "\(kb)"), URLQueryItem(name: "n", value: UUID().uuidString)])
    let request = api.authorized(URLRequest(url: url))
    let start = ContinuousClock.now
    do {
      let (data, response) = try await session.data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200, data.count == kb * 1024 else { return nil }
      return (ContinuousClock.now - start) / .milliseconds(1)
    } catch {
      return nil
    }
  }
}

extension Array where Element == WiFiSample {
  func count(_ quality: WiFiQuality) -> Int { filter { $0.quality == quality }.count }

  /// Dead readings grouped into spots: readings within 1.5 m of each other count once.
  var deadSpots: [SIMD3<Float>] {
    var spots: [SIMD3<Float>] = []
    for sample in self where sample.quality == .dead {
      if !spots.contains(where: { simd_distance($0, sample.position) < 1.5 }) { spots.append(sample.position) }
    }
    return spots
  }

  /// The best-connected reading.
  var best: WiFiSample? { self.filter { $0.mbps != nil }.max { ($0.mbps ?? 0) < ($1.mbps ?? 0) } }

  var medianLatency: Double? { median(compactMap(\.latencyMs)) }
  var medianMbps: Double? { median(compactMap(\.mbps)) }

  private func median(_ values: [Double]) -> Double? {
    guard !values.isEmpty else { return nil }
    let sorted = values.sorted()
    return sorted[sorted.count / 2]
  }
}
