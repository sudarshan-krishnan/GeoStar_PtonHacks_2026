import Foundation

/// Where the laptop's gateway is and the access code it printed.
struct Connection: Equatable {
  var baseURL: URL
  var token: String
}

enum APIError: LocalizedError {
  case unreachable(String)
  case server(status: Int, message: String)
  case unreadable

  var errorDescription: String? {
    switch self {
    case .unreachable(let why):
      "Can't reach the laptop. \(why)"
    case .server(_, let message):
      message
    case .unreadable:
      "The laptop answered in a format this app doesn't understand. Update the app or the web app so they match."
    }
  }

  /// Someone else changed the facility first (HAVEN's revision check), or the step no longer applies.
  var isConflict: Bool {
    if case .server(409, _) = self { true } else { false }
  }
}

/// The laptop's error body: `{ "error": "…" }`.
private struct ServerError: Decodable {
  let error: String
}

/// The phone side of src/app/api/mobile, reached through scripts/mobile-gateway.mjs.
struct API {
  let connection: Connection

  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 8
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }()

  func facilities() async throws -> [FacilitySummary] {
    try await call("api/mobile/facilities", as: FacilityList.self).projects
  }

  func facility(_ id: String) async throws -> FacilityState {
    try await call("api/mobile/facilities/\(id)", as: FacilityState.self)
  }

  func send(_ command: Command, to id: String, revision: Int) async throws -> FacilityState {
    struct Body: Encodable {
      let revision: Int
      let command: Command
    }
    let body = try JSONEncoder().encode(Body(revision: revision, command: command))
    return try await call("api/mobile/facilities/\(id)", method: "POST", body: body, as: FacilityState.self)
  }

  /// Adds the access token.
  func authorized(_ request: URLRequest) -> URLRequest {
    var request = request
    request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
    return request
  }

  func call<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, as type: T.Type) async throws -> T {
    var request = authorized(URLRequest(url: connection.baseURL.appending(path: path)))
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await Self.session.data(for: request)
    } catch let error as URLError {
      throw APIError.unreachable(error.localizedDescription)
    }
    guard let http = response as? HTTPURLResponse else { throw APIError.unreadable }
    guard (200..<300).contains(http.statusCode) else {
      let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error
        ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized
      throw APIError.server(status: http.statusCode, message: message)
    }
    do {
      return try JSONDecoder().decode(T.self, from: data)
    } catch {
      #if DEBUG
        print("PlotStar decode error for \(path):", error)
      #endif
      throw APIError.unreadable
    }
  }
}
