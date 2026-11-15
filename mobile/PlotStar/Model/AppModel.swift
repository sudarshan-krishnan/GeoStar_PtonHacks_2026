import AudioToolbox
import SwiftUI

/// A new incident the phone noticed.
struct IncidentAlert: Identifiable, Equatable {
  let id = UUID()
  let facility: Facility
  let incident: Incident
}

/// Connection, the facility list and new-incident alerts. Polls while the app is open.
@Observable
final class AppModel {
  private(set) var connection: Connection?
  private(set) var facilities: [FacilitySummary] = []
  private(set) var reachable = true
  private(set) var problem: String?
  private(set) var lastUpdate: Date?
  private(set) var connecting = false
  var connectError: String?
  var path: [Facility] = []
  var tab: Tab = .sites
  var alert: IncidentAlert?
  /// A short message for things that happen while the app is open (e.g. a QR code was scanned).
  var notice: String?
  /// Where the Drone tab flies. Nil means the data connection (the usual laptop case). Set when
  /// the data connection is the deployed website, which can't reach a drone.
  private(set) var droneLink: Connection?

  enum Tab: Hashable { case sites, drone }
  enum DroneMode: String, CaseIterable {
    case fly = "Fly"
    case scan = "LiDAR scan"
  }
  var droneMode: DroneMode = .fly
  /// A saved scan to open in 3D (from a `plotstar://scan/<id>` link).
  var pendingScan: String?
  /// What a pairing code connects: `data` (sites and incidents), `drone`, or `both`.
  enum Role: String { case data, drone, both }
  /// A section to scroll to when a deep link opens a facility (plan, incidents, floor, team…).
  var pendingSection: String?

  /// Active-incident count per facility from the last list, and incident ids already known.
  private var counts: [String: Int] = [:]
  private var seen: [String: Set<String>] = [:]
  private var poller: Task<Void, Never>?
  private var alertTimer: Task<Void, Never>?

  init() {
    if let saved = UserDefaults.standard.string(forKey: "gatewayURL"), let url = URL(string: saved),
      let token = Keychain.load(account: "token")
    {
      connection = Connection(baseURL: url, token: token)
    }
    if let saved = UserDefaults.standard.string(forKey: "droneURL"), let url = URL(string: saved),
      let token = Keychain.load(account: "droneToken")
    {
      droneLink = Connection(baseURL: url, token: token)
    }
  }

  var api: API? { connection.map(API.init) }
  var droneConnection: Connection? { droneLink ?? connection }
  var droneAPI: API? { droneConnection.map(API.init) }

  // MARK: - Connecting

  func connect(address: String, token: String, role requested: Role = .both) async {
    connectError = nil
    guard let url = Self.gatewayURL(address) else {
      connectError = "Enter the address the gateway printed, like http://172.20.10.2:3100."
      return
    }
    let candidate = Connection(baseURL: url, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
    var role = requested
    // A laptop code while the data link is the deployed website: the laptop becomes the drone link.
    if role == .both, connection?.baseURL.scheme == "https", url.scheme == "http" { role = .drone }
    if role == .drone, connection == nil { role = .both }
    connecting = true
    defer { connecting = false }
    do {
      if role == .drone {
        _ = try await API(connection: candidate).droneStatus()
        setDroneLink(candidate)
        notice = "Drone link: \(url.host() ?? url.absoluteString)"
        return
      }
      let list = try await API(connection: candidate).facilities()
      if role == .data, droneLink == nil, let previous = connection, previous.baseURL != url {
        setDroneLink(previous)  // keep flying through the laptop
      }
      if role == .both { setDroneLink(nil) }
      if connection != nil { notice = "Connected to \(url.host() ?? url.absoluteString)" }
      UserDefaults.standard.set(url.absoluteString, forKey: "gatewayURL")
      Keychain.save(candidate.token, account: "token")
      counts = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0.activeIncidents) })
      seen = [:]
      facilities = list
      connection = candidate
      reachable = true
      problem = nil
      lastUpdate = .now
      setActive(true)
    } catch {
      connectError = error.localizedDescription
      if connection != nil { notice = error.localizedDescription }
    }
  }

  private func setDroneLink(_ link: Connection?) {
    droneLink = link
    if let link {
      UserDefaults.standard.set(link.baseURL.absoluteString, forKey: "droneURL")
      Keychain.save(link.token, account: "droneToken")
    } else {
      UserDefaults.standard.removeObject(forKey: "droneURL")
      Keychain.delete(account: "droneToken")
    }
  }

  /// Fly through the data connection again.
  func forgetDroneLink() { setDroneLink(nil) }

  func disconnect() {
    setActive(false)
    setDroneLink(nil)
    Keychain.delete(account: "token")
    connection = nil
    facilities = []
    path = []
    counts = [:]
    seen = [:]
    alert = nil
  }

  /// Accepts "172.20.10.2:3100" or a full URL; keeps only scheme, host and port.
  static func gatewayURL(_ text: String) -> URL? {
    var text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    if !text.contains("://") { text = "http://" + text }
    guard var parts = URLComponents(string: text), let scheme = parts.scheme?.lowercased(),
      ["http", "https"].contains(scheme), let host = parts.host, !host.isEmpty
    else { return nil }
    parts.path = ""
    parts.query = nil
    parts.fragment = nil
    return parts.url
  }

  /// `plotstar://connect?url=…&token=…&role=…` (the gateway's QR code), `plotstar://drone[/scan]`,
  /// `plotstar://scan/<id>` and `plotstar://facility/<id>?section=…`.
  func handle(_ url: URL) {
    guard url.scheme == "plotstar" else { return }
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let value = { (name: String) in items.first { $0.name == name }?.value }
    switch url.host() {
    case "connect":
      if let address = value("url"), let token = value("token") {
        let role = value("role").flatMap(Role.init(rawValue:)) ?? .both
        Task { await connect(address: address, token: token, role: role) }
      }
    case "drone":
      guard connection != nil else { return }
      tab = .drone
      if url.pathComponents.dropFirst().first == "scan" { droneMode = .scan }
    case "scan":
      guard connection != nil, let id = url.pathComponents.dropFirst().first else { return }
      tab = .drone
      droneMode = .scan
      pendingScan = id
    case "facility":
      guard connection != nil, let id = url.pathComponents.dropFirst().first else { return }
      pendingSection = value("section")
      open(id)
    default:
      break
    }
  }

  func open(_ id: String) {
    let facility = facilities.first { $0.id == id }?.facility ?? Facility(id: id, name: "Facility", city: "", type: "")
    tab = .sites
    path = [facility]
  }

  // MARK: - Polling

  func setActive(_ active: Bool) {
    poller?.cancel()
    poller = nil
    guard active, connection != nil else { return }
    poller = Task { [weak self] in
      while !Task.isCancelled {
        await self?.refresh()
        try? await Task.sleep(for: .seconds(2))
      }
    }
  }

  func refresh() async {
    guard let api else { return }
    do {
      let list = try await api.facilities()
      facilities = list
      reachable = true
      problem = nil
      lastUpdate = .now
      for summary in list {
        let before = counts[summary.id]
        counts[summary.id] = summary.activeIncidents
        guard let before, summary.activeIncidents > before else { continue }
        if let state = try? await api.facility(summary.id) {
          absorb(state, fresh: summary.activeIncidents - before)
        }
      }
    } catch {
      reachable = false
      problem = error.localizedDescription
    }
  }

  /// Alerts for each active incident this phone hasn't seen yet. The first look at a facility only
  /// learns its incidents, except the `fresh` newest ones the list just reported as new.
  func absorb(_ state: FacilityState, fresh: Int = 0) {
    let id = state.facility.id
    let active = state.activeIncidents
    counts[id] = active.count
    guard let known = seen[id] else {
      seen[id] = Set(state.incidents.map(\.id))
      for incident in active.prefix(fresh).reversed() { raise(incident, at: state.facility) }
      return
    }
    for incident in active.reversed() where !known.contains(incident.id) { raise(incident, at: state.facility) }
    seen[id] = known.union(state.incidents.map(\.id))
  }

  private func raise(_ incident: Incident, at facility: Facility) {
    alert = IncidentAlert(facility: facility, incident: incident)
    UINotificationFeedbackGenerator().notificationOccurred(incident.critical ? .error : .warning)
    AudioServicesPlayAlertSound(SystemSoundID(incident.critical ? 1005 : 1007))
    alertTimer?.cancel()
    alertTimer = Task { [weak self] in
      try? await Task.sleep(for: .seconds(8))
      if !Task.isCancelled { self?.alert = nil }
    }
  }
}
