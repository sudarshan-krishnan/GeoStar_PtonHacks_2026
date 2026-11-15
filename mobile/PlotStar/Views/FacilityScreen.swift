import SwiftUI

/// One facility's incident command: status, the response plan to approve, incidents to
/// acknowledge, exit routes, readings, teams, the simulated call and the activity log.
struct FacilityScreen: View {
  @Environment(AppModel.self) private var app
  let facility: Facility

  @State private var state: FacilityState?
  @State private var loadError: String?
  @State private var busy = false
  @State private var notice: String?
  @State private var confirmApproval = false
  @State private var succeeded = 0

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        if let state {
          content(state)
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        } else if let loadError {
          ContentUnavailableView("Can't load this site", systemImage: "wifi.exclamationmark", description: Text(loadError))
            .padding(.top, 80)
        } else {
          ProgressView().padding(.top, 140)
        }
      }
      .onChange(of: state == nil, initial: true) { scrollToPending(proxy) }
      .onChange(of: app.pendingSection) { scrollToPending(proxy) }
    }
    .background(Color.black)
    .navigationTitle(state?.facility.name ?? facility.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) { demoMenu }
    }
    .task(id: facility.id) {
      while !Task.isCancelled {
        await load()
        try? await Task.sleep(for: .seconds(1.5))
      }
    }
    .sensoryFeedback(.success, trigger: succeeded)
    .confirmationDialog("Approve this response plan?", isPresented: $confirmApproval, titleVisibility: .visible) {
      Button("Approve and share guidance") {
        if let key = state?.plan?.key { send(.approvePlan(key: key)) }
      }
    } message: {
      Text(state?.plan?.instruction ?? "")
    }
    .overlay(alignment: .bottom) {
      if let notice { Toast(text: notice) }
    }
    .animation(.snappy, value: notice)
  }

  @ViewBuilder
  private func content(_ state: FacilityState) -> some View {
    VStack(spacing: 16) {
      StatusHeader(state: state, busy: busy) { send(.finishRecovery) }
      if let plan = state.plan {
        PlanCard(plan: plan, busy: busy) { confirmApproval = true }.id("plan")
      }
      if !state.activeIncidents.isEmpty {
        VStack(alignment: .leading, spacing: 12) {
          SectionTitle("Active incidents", systemImage: "bell.badge.fill")
          ForEach(state.activeIncidents) { incident in
            IncidentCard(incident: incident, busy: busy) { send(.acknowledge(incidentId: incident.id)) }
          }
        }
        .id("incidents")
      }
      FloorPlanCard(state: state).id("floor")
      ReadingsCard(state: state).id("readings")
      if let team = state.team {
        TeamCard(team: team, busy: busy) { send(.teamUpdate($0)) }.id("team")
      }
      if state.deployed && state.primaryIncidentId != nil {
        CallCard(call: state.call, busy: busy) { send(.emergencyCall) }.id("call")
      }
      SystemsCard(state: state).id("systems")
      ActivityCard(items: state.timeline).id("activity")
    }
  }

  private var demoMenu: some View {
    Menu {
      Section("Simulate an incident") {
        Button("Water leak", systemImage: "drop.fill") { send(.trigger("leak")) }
        Button("Fire alarm", systemImage: "flame.fill") { send(.trigger("fire")) }
        Button("Usage spike", systemImage: "bolt.fill") { send(.trigger("usage")) }
      }
      Section {
        Button("Reset simulation", systemImage: "arrow.counterclockwise") { send(.reset) }
      }
    } label: {
      Label("Demo", systemImage: "slider.horizontal.3")
    }
    .disabled(state == nil || busy)
  }

  /// Deep links and alert banners can ask for a section (plan, incidents, floor, team…).
  private func scrollToPending(_ proxy: ScrollViewProxy) {
    guard state != nil, let section = app.pendingSection else { return }
    app.pendingSection = nil
    Task {
      try? await Task.sleep(for: .milliseconds(250))
      withAnimation { proxy.scrollTo(section, anchor: .top) }
    }
  }

  private func load() async {
    guard let api = app.api else { return }
    do {
      let fresh = try await api.facility(facility.id)
      // A poll that started before a command finished must not roll the screen back.
      if fresh.revision >= (state?.revision ?? -1) { state = fresh }
      loadError = nil
      app.absorb(fresh)
    } catch {
      if state == nil { loadError = error.localizedDescription }
    }
  }

  private func send(_ command: Command) {
    guard let api = app.api, let current = state else { return }
    busy = true
    Task {
      defer { busy = false }
      do {
        let next = try await api.send(command, to: facility.id, revision: current.revision)
        state = next
        app.absorb(next)
        succeeded += 1
      } catch let error as APIError where error.isConflict {
        flash(error.localizedDescription)
        await load()
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

// MARK: - Status

private struct StatusHeader: View {
  let state: FacilityState
  let busy: Bool
  let finishRecovery: () -> Void

  var body: some View {
    let tone = Tone(level: state.severity.level, recovering: state.recovering)
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Label("Simulation", systemImage: "testtube.2")
          .font(.caption.weight(.bold))
          .textCase(.uppercase)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(.white.opacity(0.16), in: Capsule())
        Spacer()
        Text("\(state.facility.type) · \(state.facility.city)")
          .font(.caption)
          .opacity(0.85)
          .lineLimit(1)
      }
      HStack(spacing: 14) {
        Image(systemName: tone.symbol)
          .font(.system(size: 38, weight: .bold))
          .symbolEffect(.pulse, isActive: tone == .danger)
        VStack(alignment: .leading, spacing: 2) {
          Text(state.health).font(.title2.bold())
          Text(state.severity.level > 0 ? "Severity \(state.severity.level) · \(state.severity.label)" : "All monitored systems normal")
            .font(.subheadline.weight(.medium))
            .opacity(0.9)
        }
      }
      if !state.severity.reasons.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          ForEach(state.severity.reasons, id: \.self) { reason in
            Label(reason, systemImage: "smallcircle.filled.circle")
              .font(.footnote)
              .labelStyle(TightLabel())
          }
        }
      }
      HStack {
        if let percent = state.operations.percent {
          Label("\(state.operations.online) of \(state.operations.reported) systems online (\(percent)%)", systemImage: "server.rack")
            .font(.footnote.weight(.medium))
        }
        Spacer()
      }
      if !state.deployed {
        Label("Protections are being edited on the laptop. Monitoring is paused.", systemImage: "pause.circle.fill")
          .font(.footnote.weight(.medium))
      }
      if state.recovering && state.activeIncidents.isEmpty {
        Button(action: finishRecovery) {
          Label("Complete recovery", systemImage: "checkmark.circle.fill").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(.white.opacity(0.25))
        .disabled(busy)
      }
    }
    .foregroundStyle(.white)
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      LinearGradient(colors: [tone.deep, tone.deep.opacity(0.75), Color(white: 0.08)], startPoint: .topLeading, endPoint: .bottomTrailing),
      in: RoundedRectangle(cornerRadius: 24, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(tone.color.opacity(0.55), lineWidth: 1.5)
    }
    .padding(.top, 8)
    .animation(.smooth, value: state.severity.level)
  }
}

private struct TightLabel: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      configuration.icon.font(.system(size: 6))
      configuration.title
    }
  }
}

// MARK: - Response plan

private struct PlanCard: View {
  let plan: ResponsePlan
  let busy: Bool
  let approve: () -> Void
  @State private var showWhy = false

  var body: some View {
    Card(tint: plan.approved ? Tone.calm.color : Tone.warn.color) {
      HStack {
        SectionTitle("Response plan", systemImage: "list.bullet.clipboard.fill")
        Spacer()
        Chip(plan.approved ? "Approved" : "Needs approval", plan.approved ? Tone.calm.color : Tone.warn.color)
      }
      Text(plan.title).font(.title3.bold())
      if plan.lifeSafety {
        Label(plan.instruction, systemImage: "figure.walk.motion")
          .font(.headline)
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      }
      VStack(alignment: .leading, spacing: 10) {
        ForEach(Array(plan.steps.enumerated()), id: \.offset) { index, step in
          HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(index + 1)")
              .font(.caption.weight(.bold))
              .frame(width: 20, height: 20)
              .background(Color.white.opacity(0.12), in: Circle())
            Text(step).font(.subheadline)
          }
        }
      }
      DisclosureGroup("Why this plan", isExpanded: $showWhy) {
        Text(plan.rationale)
          .font(.footnote)
          .foregroundStyle(.secondary)
          .padding(.top, 6)
      }
      .font(.subheadline.weight(.medium))
      if plan.approved {
        let when = Timestamps.date(plan.approvedAt)
        Label(when.map { "Approved \($0.formatted(date: .omitted, time: .shortened)) · \(plan.id). Guidance shared with staff." } ?? "Approved", systemImage: "checkmark.seal.fill")
          .font(.footnote.weight(.medium))
          .foregroundStyle(Tone.calm.color)
      } else {
        Button(action: approve) {
          Label("Approve and share guidance", systemImage: "checkmark.seal.fill")
            .fontWeight(.semibold)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(busy)
        Text("HAVEN generates the plan; a person approves it before staff see the guidance.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

// MARK: - Incidents

private struct IncidentCard: View {
  let incident: Incident
  let busy: Bool
  let acknowledge: () -> Void

  var body: some View {
    let color = incident.critical ? Tone.danger.color : Tone.warn.color
    Card(tint: incident.status == "active" ? color : nil) {
      HStack(alignment: .top, spacing: 12) {
        HazardIcon(kind: incident.kind)
        VStack(alignment: .leading, spacing: 3) {
          Text(incident.name).font(.headline)
          Text("\(incident.zone) · Level 4").font(.subheadline).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        VStack(alignment: .trailing, spacing: 4) {
          Chip(incident.critical ? "Critical" : "Warning", color)
          Text(incident.createdAt.ago).font(.caption).foregroundStyle(.secondary)
        }
      }
      Text(incident.message).font(.subheadline)
      Label(incident.recommendation, systemImage: "wrench.and.screwdriver.fill")
        .font(.footnote)
        .foregroundStyle(.secondary)
      if incident.status == "active" {
        Button(action: acknowledge) {
          Label("Acknowledge", systemImage: "hand.raised.fill")
            .fontWeight(.semibold)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
        }
        .buttonStyle(.bordered)
        .tint(color)
        .controlSize(.large)
        .disabled(busy)
      } else {
        Label("Acknowledged. Hazard and route exclusions stay active until it clears.", systemImage: "checkmark.circle.fill")
          .font(.footnote.weight(.medium))
          .foregroundStyle(Tone.calm.color)
      }
    }
  }
}

// MARK: - Readings

private struct ReadingsCard: View {
  let state: FacilityState

  var body: some View {
    Card {
      SectionTitle("Live readings", systemImage: "waveform.path.ecg")
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
        Meter(title: "Electricity", symbol: "bolt.fill", value: state.readings.electricity, limit: state.limits.electricity, unit: "kW", enabled: state.enabled.electricity)
        Meter(title: "Water flow", symbol: "drop.fill", value: state.readings.waterUsage, limit: state.limits.waterUsage, unit: "L/min", enabled: state.enabled.waterUsage)
        Meter(title: "Moisture", symbol: "humidity.fill", value: state.readings.leak, limit: state.thresholds.leak, unit: "%", enabled: state.enabled.leak)
        Meter(title: "Smoke / heat", symbol: "flame.fill", value: state.readings.fire, limit: state.thresholds.fire, unit: "", enabled: state.enabled.fire, alarm: true)
      }
      Text("Simulated readings against this site's limits.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }
}

private struct Meter: View {
  let title: String
  let symbol: String
  let value: Double
  let limit: Double
  let unit: String
  let enabled: Bool
  var alarm = false

  var body: some View {
    let over = enabled && value >= limit
    let color = over ? Tone.danger.color : Tone.calm.color
    VStack(alignment: .leading, spacing: 8) {
      Label(title, systemImage: symbol)
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
      if !enabled {
        Text("Off").font(.title3.bold()).foregroundStyle(.secondary)
      } else if alarm {
        Text(over ? "Alarm" : "Clear").font(.title3.bold()).foregroundStyle(over ? color : .primary)
      } else {
        Text("\(value.formatted(.number.precision(.fractionLength(0)))) \(unit)")
          .font(.title3.bold())
          .foregroundStyle(over ? color : .primary)
          .contentTransition(.numericText(value: value))
        ProgressView(value: min(value / max(limit, 1), 1))
          .tint(color)
        Text("limit \(limit.formatted(.number.precision(.fractionLength(0)))) \(unit)")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
    .background(Color.white.opacity(over ? 0.09 : 0.05), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .animation(.smooth, value: value)
  }
}

// MARK: - Teams

private struct TeamCard: View {
  let team: Team
  let busy: Bool
  let update: (String) -> Void

  var body: some View {
    Card {
      HStack {
        SectionTitle("Teams on site", systemImage: "person.2.fill")
        Spacer()
        Text(team.workOrder).font(.caption.monospaced()).foregroundStyle(.secondary)
      }
      TeamProgress(
        name: "Maintenance", symbol: "wrench.and.screwdriver.fill",
        steps: [("open", "Work order open"), ("in_progress", "Investigating"), ("investigated", "Investigated")],
        current: team.maintenance.status, busy: busy
      ) { update("maintenance") }
      Divider().overlay(Color.white.opacity(0.08))
      TeamProgress(
        name: "Security", symbol: "shield.lefthalf.filled",
        steps: [("pending", "Pending"), ("acknowledged", "Acknowledged"), ("dispatched", "Dispatched"), ("on_scene", "On scene")],
        current: team.security.status, busy: busy
      ) { update("security") }
      Text("Simulated team reports. Acknowledgements are recorded separately from confirmed safety.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }
}

private struct TeamProgress: View {
  let name: String
  let symbol: String
  let steps: [(String, String)]
  let current: String
  let busy: Bool
  let advance: () -> Void

  var body: some View {
    let index = steps.firstIndex { $0.0 == current } ?? 0
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Label(name, systemImage: symbol).font(.subheadline.weight(.semibold))
        Spacer()
        Text(steps[index].1).font(.subheadline).foregroundStyle(Tone.calm.color)
      }
      HStack(spacing: 6) {
        ForEach(steps.indices, id: \.self) { i in
          Capsule()
            .fill(i <= index ? Tone.calm.color : Color.white.opacity(0.12))
            .frame(height: 6)
        }
      }
      .animation(.smooth, value: index)
      if index < steps.count - 1 {
        Button("Log: \(steps[index + 1].1.lowercased())", systemImage: "arrow.right.circle", action: advance)
          .font(.subheadline.weight(.medium))
          .disabled(busy)
      }
    }
  }
}

// MARK: - Emergency services (simulated)

private struct CallCard: View {
  let call: Call?
  let busy: Bool
  let start: () -> Void

  var body: some View {
    Card {
      SectionTitle("Emergency services", systemImage: "phone.fill")
      if let call {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(call.transcript, id: \.self) { line in
            VStack(alignment: .leading, spacing: 2) {
              Text(line.speaker).font(.caption.weight(.bold)).foregroundStyle(.secondary)
              Text(line.text).font(.subheadline)
            }
          }
        }
        Text(call.report).font(.footnote).foregroundStyle(.secondary)
      } else {
        Text("Run HAVEN's simulated call: a scripted report of this incident for responders. No real call is made.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
        Button(action: start) {
          Label("Run simulated call", systemImage: "phone.arrow.up.right.fill").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .disabled(busy)
      }
    }
  }
}

// MARK: - Systems and activity

private struct SystemsCard: View {
  let state: FacilityState

  var body: some View {
    Card {
      SectionTitle("Building systems", systemImage: "square.stack.3d.up.fill")
      ForEach(state.systems.filter(\.monitored)) { system in
        HStack(alignment: .top, spacing: 10) {
          Text(system.tag)
            .font(.caption.monospaced().weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: 66, alignment: .leading)
          VStack(alignment: .leading, spacing: 2) {
            Text(system.name).font(.subheadline.weight(.medium))
            Text(system.detail).font(.caption).foregroundStyle(.secondary)
          }
          Spacer(minLength: 0)
          Chip(label(system.status), color(system.status))
        }
      }
    }
  }

  private func label(_ status: String) -> String {
    switch status {
    case "operational": "OK"
    case "affected": "Affected"
    case "unavailable": "Offline"
    case "rerouted": "Rerouted"
    default: status
    }
  }

  private func color(_ status: String) -> Color {
    switch status {
    case "operational": Tone.calm.color
    case "affected": Tone.warn.color
    case "unavailable": Tone.danger.color
    default: Tone.recovering.color
    }
  }
}

private struct ActivityCard: View {
  let items: [Activity]

  var body: some View {
    Card {
      SectionTitle("Activity", systemImage: "clock.arrow.circlepath")
      if items.isEmpty {
        Text("Nothing yet.").font(.subheadline).foregroundStyle(.secondary)
      }
      ForEach(items.prefix(12)) { item in
        VStack(alignment: .leading, spacing: 3) {
          HStack {
            Text(item.agent).font(.caption.weight(.bold)).foregroundStyle(.tint)
            Spacer()
            Text(item.at.ago).font(.caption2).foregroundStyle(.secondary)
          }
          Text(item.message).font(.footnote)
        }
        .padding(.vertical, 2)
      }
    }
  }
}
