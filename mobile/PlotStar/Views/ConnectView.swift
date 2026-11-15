import SwiftUI

/// First run: pair with the gateway on the laptop (QR code via the Camera app, or typed in).
struct ConnectView: View {
  @Environment(AppModel.self) private var app
  @State private var address = UserDefaults.standard.string(forKey: "gatewayURL") ?? ""
  @State private var token = ""

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        VStack(alignment: .leading, spacing: 12) {
          Image(systemName: "shield.lefthalf.filled")
            .font(.system(size: 44, weight: .semibold))
            .foregroundStyle(.tint)
          Text("PlotStar")
            .font(.largeTitle.bold())
          Text("Incident alerts and response for the sites you protect with HAVEN.")
            .font(.title3)
            .foregroundStyle(.secondary)
        }
        .padding(.top, 36)

        VStack(alignment: .leading, spacing: 14) {
          step(1, "On the laptop, start the web app with **npm run dev**, then **npm run mobile:gateway**.")
          step(2, "Scan the QR code it opens with the iPhone Camera, or type the address and access code below.")
          step(3, "Keep the phone and the laptop on the same private network, like your hotspot.")
        }

        VStack(spacing: 12) {
          TextField("Address, like http://172.20.10.2:3100", text: $address)
            .keyboardType(.URL)
            .textContentType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(14)
            .background(Color(white: 0.13), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          SecureField("Access code", text: $token)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(14)
            .background(Color(white: 0.13), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
          Button {
            Task { await app.connect(address: address, token: token) }
          } label: {
            Group {
              if app.connecting { ProgressView() } else { Text("Connect").fontWeight(.semibold) }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .disabled(address.isEmpty || token.isEmpty || app.connecting)
        }

        if let error = app.connectError {
          Label(error, systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline)
            .foregroundStyle(Tone.warn.color)
        }

        Text("Readings and incidents come from HAVEN's simulation mode. No sensors, alarms or emergency services are connected.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      .padding(24)
    }
    .scrollDismissesKeyboard(.interactively)
  }

  private func step(_ n: Int, _ text: LocalizedStringKey) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text("\(n)")
        .font(.footnote.weight(.bold))
        .frame(width: 24, height: 24)
        .background(Color.accentColor.opacity(0.2), in: Circle())
        .foregroundStyle(.tint)
      Text(text).font(.subheadline)
    }
  }
}
