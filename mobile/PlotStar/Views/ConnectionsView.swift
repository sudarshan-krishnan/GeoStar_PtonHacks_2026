import SwiftUI

/// Where the app gets its data (the laptop or the deployed website) and where it flies the drone.
struct ConnectionsView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        Section("Sites and incidents") {
          if let link = app.connection { row(link) }
        }
        Section {
          if let link = app.droneLink {
            row(link)
            Button("Fly through the data link instead") { app.forgetDroneLink() }
          } else {
            Text("Same as above").foregroundStyle(.secondary)
          }
        } header: {
          Text("Drone")
        } footer: {
          Text("The drone always flies through the laptop next to it. A deployed website can't reach a drone.")
        }
        Section("Using the deployed website") {
          Text("On the laptop, run **npm run mobile:pair -- --url https://your-site --role data** and scan the code. Sites and incidents then come from the website, and the laptop stays the drone link. The deployment needs MOBILE_API_KEY set.")
            .font(.footnote)
        }
        Section {
          Button("Disconnect", role: .destructive) {
            app.disconnect()
            dismiss()
          }
        }
      }
      .navigationTitle("Connections")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
    }
  }

  private func row(_ link: Connection) -> some View {
    let website = link.baseURL.scheme == "https"
    return HStack(spacing: 12) {
      Image(systemName: website ? "globe" : "laptopcomputer")
        .font(.title3)
        .foregroundStyle(.tint)
        .frame(width: 30)
      VStack(alignment: .leading, spacing: 2) {
        Text(website ? "Deployed website" : "Laptop gateway").font(.headline)
        Text(link.baseURL.absoluteString).font(.footnote.monospaced()).foregroundStyle(.secondary)
      }
    }
  }
}
