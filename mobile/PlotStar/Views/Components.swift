import SwiftUI

/// Status colors. Always paired with a symbol and a word, never color alone.
enum Tone: Equatable {
  case calm, watch, warn, danger, recovering

  init(health: String) {
    switch health {
    case "Critical incident": self = .danger
    case "Warning": self = .warn
    case "Recovering": self = .recovering
    default: self = .calm
    }
  }

  /// HAVEN severity: 0 Normal, 1 Advisory, 2 Operational, 3 Life Safety, 4 Confirmed Emergency.
  init(level: Int, recovering: Bool) {
    switch level {
    case 3...: self = .danger
    case 2: self = .warn
    case 1: self = .watch
    default: self = recovering ? .recovering : .calm
    }
  }

  var color: Color {
    switch self {
    case .calm: Color(red: 0.36, green: 0.78, blue: 0.52)
    case .watch: Color(red: 0.96, green: 0.78, blue: 0.25)
    case .warn: Color(red: 0.98, green: 0.55, blue: 0.22)
    case .danger: Color(red: 0.97, green: 0.30, blue: 0.27)
    case .recovering: Color(red: 0.40, green: 0.65, blue: 1.0)
    }
  }

  /// A deep background that keeps white text readable.
  var deep: Color {
    switch self {
    case .calm: Color(red: 0.13, green: 0.30, blue: 0.21)
    case .watch: Color(red: 0.45, green: 0.35, blue: 0.04)
    case .warn: Color(red: 0.55, green: 0.24, blue: 0.06)
    case .danger: Color(red: 0.58, green: 0.10, blue: 0.09)
    case .recovering: Color(red: 0.11, green: 0.25, blue: 0.50)
    }
  }

  var symbol: String {
    switch self {
    case .calm: "checkmark.shield.fill"
    case .watch: "exclamationmark.circle.fill"
    case .warn: "exclamationmark.triangle.fill"
    case .danger: "exclamationmark.octagon.fill"
    case .recovering: "arrow.triangle.2.circlepath"
    }
  }
}

enum Hazard {
  static func symbol(_ kind: String) -> String {
    switch kind {
    case "fire": "flame.fill"
    case "leak": "drop.fill"
    case "electricity": "bolt.fill"
    case "waterUsage": "speedometer"
    default: "exclamationmark.triangle.fill"
    }
  }

  static func color(_ kind: String) -> Color {
    switch kind {
    case "fire": Tone.danger.color
    case "leak": Color(red: 0.35, green: 0.68, blue: 1.0)
    case "electricity": Tone.watch.color
    default: Tone.warn.color
    }
  }
}

struct Card<Content: View>: View {
  var tint: Color?
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 12) { content }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color(white: 0.11), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .strokeBorder(tint?.opacity(0.7) ?? Color.white.opacity(0.06), lineWidth: tint == nil ? 1 : 1.5)
      }
  }
}

struct SectionTitle: View {
  let text: String
  let symbol: String
  init(_ text: String, systemImage: String) {
    self.text = text
    self.symbol = systemImage
  }
  var body: some View {
    Label(text, systemImage: symbol)
      .font(.footnote.weight(.semibold))
      .textCase(.uppercase)
      .foregroundStyle(.secondary)
  }
}

struct Chip: View {
  let text: String
  let color: Color
  init(_ text: String, _ color: Color) {
    self.text = text
    self.color = color
  }
  var body: some View {
    Text(text)
      .font(.caption.weight(.bold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .background(color.opacity(0.18), in: Capsule())
      .foregroundStyle(color)
  }
}

struct HazardIcon: View {
  let kind: String
  var size: CGFloat = 36
  var body: some View {
    Image(systemName: Hazard.symbol(kind))
      .font(.system(size: size * 0.46, weight: .bold))
      .foregroundStyle(.white)
      .frame(width: size, height: size)
      .background(Hazard.color(kind).gradient, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
  }
}

/// Slides in from the top when a new incident arrives; tap to open it.
struct AlertBanner: View {
  let alert: IncidentAlert
  let open: () -> Void

  var body: some View {
    Button(action: open) {
      HStack(spacing: 12) {
        Image(systemName: Hazard.symbol(alert.incident.kind))
          .font(.title2.weight(.bold))
          .symbolEffect(.pulse)
          .frame(width: 44, height: 44)
          .background(.white.opacity(0.18), in: Circle())
        VStack(alignment: .leading, spacing: 2) {
          Text(alert.incident.name).font(.headline)
          Text("\(alert.facility.name) · \(alert.incident.zone)")
            .font(.subheadline)
            .opacity(0.9)
            .lineLimit(1)
        }
        Spacer(minLength: 0)
        Image(systemName: "chevron.right").font(.headline)
      }
      .padding(14)
      .foregroundStyle(.white)
      .background((alert.incident.critical ? Tone.danger.deep : Tone.warn.deep).gradient, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .strokeBorder((alert.incident.critical ? Tone.danger.color : Tone.warn.color).opacity(0.8), lineWidth: 1.5)
      }
      .shadow(color: .black.opacity(0.5), radius: 18, y: 8)
    }
    .buttonStyle(.plain)
    .accessibilityLabel("New incident: \(alert.incident.name) at \(alert.facility.name). Open.")
  }
}

struct Toast: View {
  let text: String
  var body: some View {
    Text(text)
      .font(.subheadline.weight(.medium))
      .multilineTextAlignment(.center)
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(.ultraThinMaterial, in: Capsule())
      .padding(.bottom, 24)
      .padding(.horizontal, 20)
      .transition(.move(edge: .bottom).combined(with: .opacity))
  }
}

extension String {
  /// "2 min ago" from one of the laptop's ISO timestamps.
  var ago: String {
    guard let date = Timestamps.date(self) else { return "" }
    if Date.now.timeIntervalSince(date) < 45 { return "just now" }
    return date.formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated))
  }
}
