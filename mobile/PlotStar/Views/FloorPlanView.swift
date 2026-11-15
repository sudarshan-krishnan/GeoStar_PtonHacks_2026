import SwiftUI

/// Level 4 of HAVEN's sample model from above: exit routes (clear or blocked), hazards,
/// monitoring points and the DataBot. Coordinates come from the laptop (src/lib/haven/config.ts).
struct FloorPlanCard: View {
  let state: FacilityState

  var body: some View {
    Card {
      SectionTitle("Level 4 · exit routes", systemImage: "map.fill")
      FloorPlan(state: state)
        .frame(height: 220)
        .accessibilityElement()
        .accessibilityLabel(summary)
      VStack(alignment: .leading, spacing: 10) {
        ForEach(state.routes) { route in
          let chosen = route.id == state.route
          HStack(alignment: .top, spacing: 10) {
            Image(systemName: route.available ? (chosen ? "arrow.right.circle.fill" : "circle") : "xmark.octagon.fill")
              .foregroundStyle(route.available ? Tone.calm.color : Tone.danger.color)
              .font(.headline)
            VStack(alignment: .leading, spacing: 2) {
              Text(route.name + (chosen ? " · use this route" : route.available ? "" : " · blocked"))
                .font(.subheadline.weight(.semibold))
              Text(route.description + (route.stepFree ? "" : " · stairs, not step-free"))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
        }
        if state.route == nil {
          Label("No configured route is clear. Hold staff in the nearest unaffected space.", systemImage: "exclamationmark.triangle.fill")
            .font(.footnote.weight(.medium))
            .foregroundStyle(Tone.danger.color)
        }
      }
      Text("Demo routes on HAVEN's representative model, not a surveyed evacuation plan.")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
  }

  private var summary: String {
    let routes = state.routes.map { "\($0.name) \($0.available ? "clear" : "blocked")" }.joined(separator: ", ")
    let hazards = state.floor.hazards.map(\.kind).joined(separator: " and ")
    return "Level 4 plan. \(routes)." + (hazards.isEmpty ? "" : " Active hazard: \(hazards).")
  }
}

struct FloorPlan: View {
  let state: FacilityState

  var body: some View {
    let animate = !state.floor.hazards.isEmpty
    TimelineView(.animation(minimumInterval: 1 / 30, paused: !animate)) { timeline in
      let t = timeline.date.timeIntervalSinceReferenceDate
      Canvas { ctx, size in draw(&ctx, size: size, t: animate ? t : 0) }
    }
    .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.06))
    }
  }

  private func draw(_ ctx: inout GraphicsContext, size: CGSize, t: Double) {
    let all = state.routes.flatMap(\.path) + state.floor.points.map(\.at) + state.floor.hazards.map(\.at)
      + [state.floor.placement?.at].compactMap { $0 }
    let xs = all.map { $0[0] }
    let zs = all.map { $0[1] }
    let pad = 1.1
    let minX = (xs.min() ?? -6) - pad, maxX = (xs.max() ?? 6) + pad
    let minZ = (zs.min() ?? -3) - pad, maxZ = (zs.max() ?? 3) + pad
    let scale = min(size.width / (maxX - minX), size.height / (maxZ - minZ))
    let ox = (size.width - (maxX - minX) * scale) / 2
    let oz = (size.height - (maxZ - minZ) * scale) / 2
    func at(_ p: [Double]) -> CGPoint {
      CGPoint(x: ox + (p[0] - minX) * scale, y: oz + (p[1] - minZ) * scale)
    }

    // 1 m grid
    var grid = Path()
    for x in stride(from: ceil(minX), through: maxX, by: 1) {
      grid.move(to: at([x, minZ]))
      grid.addLine(to: at([x, maxZ]))
    }
    for z in stride(from: ceil(minZ), through: maxZ, by: 1) {
      grid.move(to: at([minX, z]))
      grid.addLine(to: at([maxX, z]))
    }
    ctx.stroke(grid, with: .color(.white.opacity(0.04)), lineWidth: 0.5)

    // corridors: the floor under every route
    for route in state.routes {
      ctx.stroke(line(route.path, at), with: .color(.white.opacity(0.07)), style: StrokeStyle(lineWidth: 18, lineCap: .round, lineJoin: .round))
    }

    // routes
    for route in state.routes where route.path.count > 1 {
      let path = line(route.path, at)
      let chosen = route.id == state.route
      if route.available {
        ctx.stroke(path, with: .color(Tone.calm.color.opacity(chosen ? 0.95 : 0.35)), style: StrokeStyle(lineWidth: chosen ? 5 : 3, lineCap: .round, lineJoin: .round))
        if chosen {
          ctx.stroke(path, with: .color(.white.opacity(0.9)), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [2, 9], dashPhase: -t * 22))
        }
      } else {
        ctx.stroke(path, with: .color(Tone.danger.color.opacity(0.8)), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round, dash: [6, 6]))
      }
      // stairwell at the end of the Level 4 portion
      if let end = route.path.last {
        let p = at(end)
        let box = CGRect(x: p.x - 9, y: p.y - 9, width: 18, height: 18)
        ctx.fill(Path(roundedRect: box, cornerRadius: 4), with: .color(route.available ? Tone.calm.color : Tone.danger.color))
        var icon = ctx.resolve(Image(systemName: route.available ? "stairs" : "xmark"))
        icon.shading = .color(.black)
        ctx.draw(icon, in: box.insetBy(dx: 3.5, dy: 3.5))
        // label on the side away from the corridor that leads in
        let incoming = route.path.count > 1 ? at(route.path[route.path.count - 2]) : p
        let label = route.id == "east" ? "East stairs" : "West stairs"
        ctx.draw(Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(0.75)), at: CGPoint(x: p.x, y: incoming.y > p.y ? p.y - 17 : p.y + 17))
      }
    }

    // where staff start: the operations room
    if let start = state.routes.first?.path.first {
      let p = at(start)
      ctx.fill(Path(ellipseIn: CGRect(x: p.x - 5, y: p.y - 5, width: 10, height: 10)), with: .color(.white))
      ctx.draw(Text("Ops room").font(.system(size: 9, weight: .semibold)).foregroundStyle(.white.opacity(0.75)), at: CGPoint(x: p.x, y: p.y + 14))
    }

    // monitoring points
    for point in state.floor.points {
      let p = at(point.at)
      let color = protectionColor(point.protection)
      ctx.fill(Path(ellipseIn: CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8)), with: .color(color.opacity(0.9)))
      ctx.stroke(Path(ellipseIn: CGRect(x: p.x - 7, y: p.y - 7, width: 14, height: 14)), with: .color(color.opacity(0.35)), lineWidth: 1)
    }

    // DataBot
    if let bot = state.floor.placement {
      let p = at(bot.at)
      var diamond = Path()
      diamond.move(to: CGPoint(x: p.x, y: p.y - 7))
      diamond.addLine(to: CGPoint(x: p.x + 7, y: p.y))
      diamond.addLine(to: CGPoint(x: p.x, y: p.y + 7))
      diamond.addLine(to: CGPoint(x: p.x - 7, y: p.y))
      diamond.closeSubpath()
      ctx.fill(diamond, with: .color(.accentColor))
    }

    // hazards pulse
    for hazard in state.floor.hazards {
      let p = at(hazard.at)
      let color = Hazard.color(hazard.kind)
      for phase in [0.0, 0.5] {
        let k = (t / 1.6 + phase).truncatingRemainder(dividingBy: 1)
        let r = 10 + k * 30
        ctx.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)), with: .color(color.opacity(0.45 * (1 - k))))
      }
      let core = CGRect(x: p.x - 11, y: p.y - 11, width: 22, height: 22)
      ctx.fill(Path(ellipseIn: core), with: .color(color))
      var icon = ctx.resolve(Image(systemName: Hazard.symbol(hazard.kind)))
      icon.shading = .color(.white)
      ctx.draw(icon, in: core.insetBy(dx: 5, dy: 5))
    }

    // compass
    ctx.draw(Text("N ↑").font(.system(size: 9, weight: .bold)).foregroundStyle(.white.opacity(0.4)), at: CGPoint(x: size.width - 16, y: 12))
  }

  private func line(_ points: [[Double]], _ at: ([Double]) -> CGPoint) -> Path {
    var path = Path()
    guard let first = points.first else { return path }
    path.move(to: at(first))
    for point in points.dropFirst() { path.addLine(to: at(point)) }
    return path
  }

  private func protectionColor(_ protection: String) -> Color {
    switch protection {
    case "fire": Tone.danger.color
    case "leak", "waterUsage": Color(red: 0.35, green: 0.68, blue: 1.0)
    case "electricity": Tone.watch.color
    default: .white
    }
  }
}
