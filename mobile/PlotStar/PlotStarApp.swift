import SwiftUI

@main
struct PlotStarApp: App {
  @State private var app = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(app)
        .onOpenURL { app.handle($0) }
        .preferredColorScheme(.dark)
        #if DEBUG
          // The simulator has no camera for the pairing QR code, and links opened from outside
          // ask for confirmation. Debug builds open PLOTSTAR_OPEN (a plotstar:// link) at launch:
          // SIMCTL_CHILD_PLOTSTAR_OPEN='plotstar://connect?…' xcrun simctl launch booted dev.plotstar.mobile
          .task {
            if let link = ProcessInfo.processInfo.environment["PLOTSTAR_OPEN"], let url = URL(string: link) {
              app.handle(url)
            }
          }
        #endif
    }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var phase

  var body: some View {
    Group {
      if app.connection == nil {
        ConnectView()
      } else {
        MainTabs()
      }
    }
    .overlay(alignment: .bottom) {
      if let notice = app.notice {
        Toast(text: notice).padding(.bottom, 56)
      }
    }
    .animation(.snappy, value: app.notice)
    .task(id: app.notice) {
      guard app.notice != nil else { return }
      try? await Task.sleep(for: .seconds(4))
      app.notice = nil
    }
    .overlay(alignment: .top) {
      if let alert = app.alert {
        AlertBanner(alert: alert) {
          app.alert = nil
          app.pendingSection = "incidents"
          app.open(alert.facility.id)
        }
        .padding(.horizontal, 12)
        .transition(.move(edge: .top).combined(with: .opacity))
      }
    }
    .animation(.spring(duration: 0.45, bounce: 0.25), value: app.alert)
    .onChange(of: phase, initial: true) { _, phase in
      app.setActive(phase == .active)
    }
  }
}

struct MainTabs: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    @Bindable var app = app
    TabView(selection: $app.tab) {
      FacilitiesView()
        .tabItem { Label("Sites", systemImage: "building.2.fill") }
        .tag(AppModel.Tab.sites)
      DroneView()
        .tabItem { Label("Drone", systemImage: "airplane") }
        .tag(AppModel.Tab.drone)
    }
  }
}
