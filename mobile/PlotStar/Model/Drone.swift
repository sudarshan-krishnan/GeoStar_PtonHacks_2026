import Foundation

/// `GET /api/mobile/drone/status`: the Tello bridge (bridge/server.py) as the web app sees it.
struct DroneStatus: Decodable {
  /// False when the web app can't reach the bridge at all.
  let bridge: Bool
  let connected: Bool?
  /// The bridge runs with `--mock`: a simulated drone and feed.
  let mock: Bool?
  let error: String?
  let battery: Double?
  let height: Double?
  let temp: Double?
  let flying: Bool?
  let video: Bool?
  /// The RoboMaster TT kit (dot matrix + forward ToF sensor) answered.
  let expansion: Bool?
  /// Distance to whatever is ahead, from the ToF sensor; nil when nothing is in range.
  let aheadCM: Double?
  /// The 64 characters on the 8x8 display: r red, b blue, p purple, 0 off. Nil when blank.
  let display: String?

  var ready: Bool { bridge && connected == true }

  /// The bridge refuses forward moves that would end within 50 cm of something (bridge/server.py).
  var blockedAhead: Bool { expansion == true && (aheadCM ?? .infinity) - 30 < 50 }

  private enum CodingKeys: String, CodingKey {
    case bridge, connected, mock, error, battery, height, temp, flying, video, expansion, display
    case aheadCM = "ahead_cm"
  }
}

/// A frame saved by the bridge (`POST /api/mobile/drone/snapshot`, `GET …/snapshots`).
struct DroneCapture: Decodable, Identifiable, Hashable {
  /// The bridge's path, e.g. `/captures/20261114-153000-123.jpg`.
  let url: String
  let time: Double
  let simulated: Bool
  var id: String { url }
}

/// The bridge's flight commands. Moves are 30 cm and turns 45° (bridge/server.py).
enum DroneAction: String {
  case takeoff, land, up, down, left, right, forward, back, cw, ccw, emergency
}

/// Any JSON object the caller doesn't need to read.
private struct Ignored: Decodable {}

extension API {
  func droneStatus() async throws -> DroneStatus {
    try await call("api/mobile/drone/status", as: DroneStatus.self)
  }

  func drone(_ action: DroneAction) async throws {
    let body = try JSONEncoder().encode(["action": action.rawValue])
    _ = try await call("api/mobile/drone/command", method: "POST", body: body, as: Ignored.self)
  }

  func droneSnapshot() async throws -> DroneCapture {
    try await call("api/mobile/drone/snapshot", method: "POST", body: Data("{}".utf8), as: DroneCapture.self)
  }

  func droneCaptures() async throws -> [DroneCapture] {
    try await call("api/mobile/drone/snapshots", as: [DroneCapture].self)
  }

  /// The live MJPEG feed, with the access token.
  func droneVideoRequest() -> URLRequest {
    authorized(URLRequest(url: connection.baseURL.appending(path: "api/mobile/drone/video")))
  }

  /// A saved frame (`/captures/<name>` on the bridge).
  func captureRequest(_ capture: DroneCapture) -> URLRequest {
    let name = capture.url.split(separator: "/").last.map(String.init) ?? ""
    return authorized(URLRequest(url: connection.baseURL.appending(path: "api/mobile/drone/captures/\(name)")))
  }
}
