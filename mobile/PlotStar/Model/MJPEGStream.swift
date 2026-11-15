import UIKit

/// Shows the bridge's MJPEG feed (multipart/x-mixed-replace): keeps the newest frame and
/// reconnects on its own when the stream ends (drone off, bridge restarted, network blip).
@Observable
final class MJPEGStream {
  private(set) var frame: UIImage?
  private(set) var live = false
  private var reader: MJPEGReader?
  private var generation = 0
  private var retry: Task<Void, Never>?

  func start(_ request: URLRequest) {
    stop()
    generation += 1
    let current = generation
    let reader = MJPEGReader(request: request) { [weak self] image in
      Task { @MainActor in
        guard let self, self.generation == current else { return }
        self.frame = image.value
        self.live = true
      }
    } onEnd: { [weak self] in
      Task { @MainActor in
        guard let self, self.generation == current else { return }
        self.live = false
        self.retry = Task {
          try? await Task.sleep(for: .seconds(2))
          if !Task.isCancelled, self.generation == current { self.start(request) }
        }
      }
    }
    self.reader = reader
    reader.resume()
  }

  func stop() {
    generation += 1
    retry?.cancel()
    retry = nil
    reader?.cancel()
    reader = nil
    live = false
  }
}

/// Carries a decoded frame from the network queue to the main actor.
struct DecodedFrame: @unchecked Sendable {
  let value: UIImage
}

/// Reads JPEG frames out of the stream on a background queue.
nonisolated final class MJPEGReader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let onFrame: @Sendable (DecodedFrame) -> Void
  private let onEnd: @Sendable () -> Void
  private var buffer = Data()
  private var session: URLSession?
  private var task: URLSessionDataTask?
  private static let start = Data([0xFF, 0xD8])
  private static let end = Data([0xFF, 0xD9])

  init(request: URLRequest, onFrame: @escaping @Sendable (DecodedFrame) -> Void, onEnd: @escaping @Sendable () -> Void) {
    self.onFrame = onFrame
    self.onEnd = onEnd
    super.init()
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15  // no bytes for 15 s: end, then reconnect
    config.timeoutIntervalForResource = 24 * 3600
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
    self.session = session
    task = session.dataTask(with: request)
  }

  func resume() { task?.resume() }

  func cancel() {
    task?.cancel()
    session?.invalidateAndCancel()
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
  ) {
    let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
    completionHandler(ok ? .allow : .cancel)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    buffer.append(data)
    var newest: Data?
    while let soi = buffer.range(of: Self.start),
      let eoi = buffer.range(of: Self.end, in: soi.upperBound..<buffer.endIndex)
    {
      newest = buffer.subdata(in: soi.lowerBound..<eoi.upperBound)
      buffer.removeSubrange(buffer.startIndex..<eoi.upperBound)
    }
    if buffer.count > 4_000_000 { buffer.removeAll() }  // never let a broken stream grow without bound
    if let newest, let image = UIImage(data: newest) { onFrame(DecodedFrame(value: image)) }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    session.finishTasksAndInvalidate()
    onEnd()
  }
}
