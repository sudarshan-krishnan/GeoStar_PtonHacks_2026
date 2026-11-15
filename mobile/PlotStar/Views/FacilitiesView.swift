import SwiftUI

/// Every deployed site, the ones that need attention first.
struct FacilitiesView: View {
  @Environment(AppModel.self) private var app
  @State private var showConnections = false

  var body: some View {
    @Bindable var app = app
    let attention = app.facilities.filter(\.needsAttention)
    let calm = app.facilities.filter { !$0.needsAttention }
    NavigationStack(path: $app.path) {
      List {
        Section {
          LinkStatus()
        }
        if !attention.isEmpty {
          Section("Needs attention") {
            ForEach(attention) { row($0) }
          }
        }
        if !calm.isEmpty {
          Section(attention.isEmpty ? "All sites" : "Monitoring") {
            ForEach(calm) { row($0) }
          }
        }
        Section {
          Text("HAVEN simulation mode: readings and incidents are simulated, and sites marked Sample are illustrative. Set up a site's protections in Dashboard 2 on the laptop; respond from here.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .navigationTitle("Sites")
      .navigationDestination(for: Facility.self) { FacilityScreen(facility: $0) }
      .sheet(isPresented: $showConnections) { ConnectionsView() }
      .refreshable { await app.refresh() }
      .overlay {
        if app.facilities.isEmpty && app.reachable {
          ContentUnavailableView(
            "No deployed sites", systemImage: "building.2",
            description: Text("Deploy protections for a site in Dashboard 2 on the laptop and it appears here."))
        }
      }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Connections", systemImage: "link") { showConnections = true }
        }
      }
    }
  }

  private func row(_ summary: FacilitySummary) -> some View {
    NavigationLink(value: summary.facility) { FacilityRow(summary: summary) }
  }
}

extension FacilitySummary {
  var needsAttention: Bool { activeIncidents > 0 || health != "Healthy" }
}

private struct LinkStatus: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    HStack(spacing: 10) {
      Circle()
        .fill(app.reachable ? Tone.calm.color : Tone.danger.color)
        .frame(width: 9, height: 9)
        .shadow(color: app.reachable ? Tone.calm.color : Tone.danger.color, radius: 4)
      if app.reachable {
        if let last = app.lastUpdate {
          Text("Live · updated \(last, style: .relative) ago")
        } else {
          Text("Connecting…")
        }
      } else {
        Text(app.problem ?? "Can't reach the laptop.").lineLimit(2)
      }
    }
    .font(.footnote)
    .foregroundStyle(.secondary)
  }
}

struct FacilityRow: View {
  let summary: FacilitySummary

  var body: some View {
    let tone = Tone(health: summary.health)
    HStack(spacing: 14) {
      Image(systemName: tone.symbol)
        .font(.title3.weight(.semibold))
        .foregroundStyle(tone.color)
        .symbolEffect(.pulse, isActive: tone == .danger)
        .frame(width: 30)
      VStack(alignment: .leading, spacing: 4) {
        Text(summary.facility.name).font(.headline).lineLimit(1)
        HStack(spacing: 6) {
          if summary.sample { Chip("Sample", .secondary) }
          Text("\(summary.facility.type) · \(summary.facility.city)")
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        HStack(spacing: 12) {
          if let kw = summary.readings.electricity {
            usage("bolt.fill", kw, summary.limits.electricity, "kW")
          }
          if let flow = summary.readings.waterUsage {
            usage("drop.fill", flow, summary.limits.waterUsage, "L/min")
          }
          if !summary.deployed { Label("Paused for edits", systemImage: "pause.circle").foregroundStyle(.secondary) }
        }
        .font(.caption)
      }
      Spacer(minLength: 0)
      if summary.activeIncidents > 0 {
        Text("\(summary.activeIncidents)")
          .font(.subheadline.weight(.bold))
          .foregroundStyle(.white)
          .frame(minWidth: 26, minHeight: 26)
          .background(tone.color, in: Circle())
          .accessibilityLabel("\(summary.activeIncidents) active incidents")
      }
    }
    .padding(.vertical, 4)
  }

  private func usage(_ symbol: String, _ value: Double, _ limit: Double, _ unit: String) -> some View {
    let over = value >= limit
    let number = { (x: Double) in x.formatted(.number.precision(.fractionLength(0))) }
    return HStack(spacing: 4) {
      Image(systemName: symbol)
      Text("\(number(value)) / \(number(limit)) \(unit)").lineLimit(1)
    }
    .foregroundStyle(over ? Tone.danger.color : .secondary)
    .accessibilityElement(children: .combine)
  }

}
