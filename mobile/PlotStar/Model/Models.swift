import Foundation

// The JSON the laptop sends, mirrored from src/lib/haven (engine.ts, portfolio.ts, mobile.ts).

struct Facility: Codable, Hashable, Identifiable {
  let id: String
  let name: String
  let city: String
  let type: String
}

/// One row of `GET /api/mobile/facilities`: HAVEN's deployed-project summary.
struct FacilitySummary: Codable, Identifiable {
  struct Usage: Codable {
    let electricity: Double?
    let waterUsage: Double?
  }
  let facility: Facility
  let sample: Bool
  let deployed: Bool
  let health: String
  let activeIncidents: Int
  let readings: Usage
  let limits: Limits
  let deployedAt: String?
  var id: String { facility.id }
}

struct FacilityList: Codable {
  let projects: [FacilitySummary]
}

struct Limits: Codable {
  let electricity: Double
  let waterUsage: Double
}

/// `GET /api/mobile/facilities/<id>`: the stored state plus what Dashboard 2 derives from it.
struct FacilityState: Codable {
  let facility: Facility
  let revision: Int
  let mode: String
  let deployed: Bool
  let recovering: Bool
  let health: String
  let severity: Severity
  let readings: Readings
  let limits: Limits
  let thresholds: Thresholds
  let enabled: Enabled
  let incidents: [Incident]
  let primaryIncidentId: String?
  let plan: ResponsePlan?
  let route: String?
  let routes: [Route]
  let team: Team?
  let call: Call?
  let operations: Operations
  let systems: [FacilitySystem]
  let timeline: [Activity]
  let floor: Floor

  var activeIncidents: [Incident] { incidents.filter { $0.status != "resolved" } }
}

struct Severity: Codable {
  let level: Int
  let label: String
  let reasons: [String]
}

struct Readings: Codable {
  let electricity: Double
  let waterUsage: Double
  let leak: Double
  let fire: Double
}

struct Thresholds: Codable {
  let leak: Double
  let fire: Double
}

struct Enabled: Codable {
  let electricity: Bool
  let waterUsage: Bool
  let leak: Bool
  let fire: Bool
}

struct Incident: Codable, Identifiable, Hashable {
  let id: String
  /// electricity | waterUsage | leak | fire
  let kind: String
  let name: String
  let zone: String
  /// warning | critical
  let severity: String
  /// active | acknowledged | resolved
  let status: String
  let message: String
  let recommendation: String
  let createdAt: String

  var critical: Bool { severity == "critical" }
}

struct ResponsePlan: Codable {
  let key: String
  let id: String
  /// pending_approval | approved
  let status: String
  let approvedAt: String?
  let title: String
  let steps: [String]
  let rationale: String
  let instruction: String
  let route: String
  let lifeSafety: Bool

  var approved: Bool { status == "approved" }
}

struct Route: Codable, Identifiable {
  let id: String
  let name: String
  let description: String
  let stepFree: Bool
  let available: Bool
  /// Level 4 portion of the route, as (x, z) points in metres.
  let path: [[Double]]
}

struct Team: Codable {
  struct Progress: Codable {
    let status: String
    let updatedAt: String
  }
  let incidentId: String
  let workOrder: String
  let maintenance: Progress
  let security: Progress
}

struct Call: Codable {
  struct Line: Codable, Hashable {
    let speaker: String
    let text: String
  }
  let id: String
  let incidentId: String
  let startedAt: String
  let transcript: [Line]
  let report: String
}

struct Operations: Codable {
  let reported: Int
  let online: Int
  let percent: Int?
  let degraded: Int
  let offline: Int
  let rerouted: Int
}

struct FacilitySystem: Codable, Identifiable {
  let id: String
  let tag: String
  let name: String
  let family: String
  let zone: String
  let monitored: Bool
  /// operational | affected | unavailable | rerouted
  let status: String
  let detail: String
}

struct Activity: Codable, Identifiable {
  let id: String
  let agent: String
  let message: String
  let at: String
}

struct Floor: Codable {
  struct Point: Codable, Identifiable {
    let id: String
    let label: String
    let protection: String
    let zone: String
    let at: [Double]
  }
  struct Hazard: Codable, Hashable {
    let kind: String
    let at: [Double]
  }
  struct Placement: Codable {
    let name: String
    let at: [Double]
  }
  let points: [Point]
  let hazards: [Hazard]
  let placement: Placement?
}

/// What the phone can send (`POST /api/mobile/facilities/<id>`), in HAVEN's action format.
enum Command: Encodable {
  /// leak | fire | usage
  case trigger(String)
  case acknowledge(incidentId: String)
  case reset
  case finishRecovery
  case approvePlan(key: String)
  /// maintenance | security
  case teamUpdate(String)
  case emergencyCall

  private enum Keys: String, CodingKey { case action, kind, incidentId, key, team }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    switch self {
    case .trigger(let kind):
      try c.encode("trigger", forKey: .action)
      try c.encode(kind, forKey: .kind)
    case .acknowledge(let id):
      try c.encode("acknowledge", forKey: .action)
      try c.encode(id, forKey: .incidentId)
    case .reset:
      try c.encode("reset", forKey: .action)
    case .finishRecovery:
      try c.encode("finish-recovery", forKey: .action)
    case .approvePlan(let key):
      try c.encode("approve-plan", forKey: .action)
      try c.encode(key, forKey: .key)
    case .teamUpdate(let team):
      try c.encode("team-update", forKey: .action)
      try c.encode(team, forKey: .team)
    case .emergencyCall:
      try c.encode("emergency-call", forKey: .action)
    }
  }
}

/// The laptop's timestamps are JavaScript ISO strings, with milliseconds.
enum Timestamps {
  static let precise: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
  static let plain = ISO8601DateFormatter()
  static func date(_ text: String?) -> Date? {
    guard let text else { return nil }
    return precise.date(from: text) ?? plain.date(from: text)
  }
}
