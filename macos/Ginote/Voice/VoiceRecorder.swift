import AppKit
import AVFoundation
import Observation

/// 녹음기가 쓰는 AVAudioRecorder 기능. 테스트는 마이크 없이 흉내 낸 녹음기를 끼운다.
@MainActor
protocol AudioRecording: AnyObject {
    var delegate: (any AVAudioRecorderDelegate)? { get set }
    var isMeteringEnabled: Bool { get set }
    var currentTime: TimeInterval { get }
    func record(forDuration duration: TimeInterval) -> Bool
    func record() -> Bool
    func pause()
    func stop()
    func deleteRecording() -> Bool
    func updateMeters()
    func averagePower(forChannel channelNumber: Int) -> Float
}

extension AVAudioRecorder: AudioRecording {}

/// 마이크 녹음(AAC .m4a). 일시정지, 파형용 음량, 60분 상한.
@MainActor
@Observable
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    static let maxDuration: TimeInterval = 60 * 60
    /// 파형·시간을 읽는 간격. 테스트가 줄여 쓴다.
    static var meterInterval: TimeInterval = 1.0 / 20
    /// 마이크 권한과 녹음기. 단위 테스트에서는 기본값부터 마이크를 쓰지 않는다(권한 창·실제 녹음 없음).
    static var authorizationStatus: () -> AVAuthorizationStatus = {
        AppModel.isUnitTest ? .denied : AVCaptureDevice.authorizationStatus(for: .audio)
    }
    static var requestAccess: () async -> Bool = { await AVCaptureDevice.requestAccess(for: .audio) }
    static var makeRecorder: (URL, [String: Any]) throws -> any AudioRecording = { try AVAudioRecorder(url: $0, settings: $1) }

    enum State: Equatable { case idle, preparing, recording, paused, finished, denied, failed(String) }

    private(set) var state: State = .idle
    private(set) var elapsed: TimeInterval = 0
    private(set) var levels: [Float] = []
    private var recorder: (any AudioRecording)?
    private var meterTimer: Timer?
    let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("ginote-voice-\(UUID().uuidString).m4a")
    var onLimitReached: (() -> Void)?

    var hasAudio: Bool { elapsed > 0.3 }

    func start() async {
        state = .preparing
        let granted: Bool
        switch Self.authorizationStatus() {
        case .authorized: granted = true
        case .notDetermined: granted = await Self.requestAccess()
        default: granted = false
        }
        guard granted else { state = .denied; return }
        do {
            let recorder = try Self.makeRecorder(fileURL, [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32_000
            ])
            recorder.delegate = self
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: Self.maxDuration) else { state = .failed(String(localized: "녹음을 시작하지 못했습니다.")); return }
            self.recorder = recorder
            SystemActions.play("Tink")
            state = .recording
            startMeter()
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func togglePause() {
        guard let recorder else { return }
        if state == .recording {
            recorder.pause()
            state = .paused
        } else if state == .paused {
            _ = recorder.record()
            state = .recording
        }
    }

    /// 녹음을 끝내고 파일 내용을 돌려준다.
    func finish() -> Data? {
        guard let recorder else { return nil }
        elapsed = recorder.currentTime > 0 ? recorder.currentTime : elapsed
        recorder.stop()
        meterTimer?.invalidate()
        state = .finished
        return try? Data(contentsOf: fileURL)
    }

    func discard() {
        recorder?.stop()
        _ = recorder?.deleteRecording()
        meterTimer?.invalidate()
        recorder = nil
        state = .idle
    }

    private func startMeter() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: Self.meterInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let recorder = self.recorder else { return }
                recorder.updateMeters()
                if self.state == .recording { self.elapsed = recorder.currentTime }
                let power = recorder.averagePower(forChannel: 0)
                let level = self.state == .recording ? max(0, min(1, (power + 50) / 50)) : 0
                self.levels.append(level)
                if self.levels.count > 120 { self.levels.removeFirst(self.levels.count - 120) }
            }
        }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            // 60분 상한에 닿으면 알림음을 두 번 내고 자동으로 완료한다.
            guard self.state == .recording, self.elapsed >= Self.maxDuration - 1 else { return }
            SystemActions.play("Tink")
            try? await Task.sleep(for: .milliseconds(250))
            SystemActions.play("Tink")
            self.onLimitReached?()
        }
    }
}
