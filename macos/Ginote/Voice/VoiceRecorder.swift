import AppKit
import AVFoundation
import Observation

/// 마이크 녹음(AAC .m4a). 일시정지, 파형용 음량, 60분 상한.
@MainActor
@Observable
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
    static let maxDuration: TimeInterval = 60 * 60

    enum State: Equatable { case idle, preparing, recording, paused, finished, denied, failed(String) }

    private(set) var state: State = .idle
    private(set) var elapsed: TimeInterval = 0
    private(set) var levels: [Float] = []
    private var recorder: AVAudioRecorder?
    private var meterTimer: Timer?
    let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("ginote-voice-\(UUID().uuidString).m4a")
    var onLimitReached: (() -> Void)?

    var hasAudio: Bool { elapsed > 0.3 }

    func start() async {
        state = .preparing
        let granted: Bool
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: granted = true
        case .notDetermined: granted = await AVCaptureDevice.requestAccess(for: .audio)
        default: granted = false
        }
        guard granted else { state = .denied; return }
        do {
            let recorder = try AVAudioRecorder(url: fileURL, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32_000
            ])
            recorder.delegate = self
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: Self.maxDuration) else { state = .failed(String(localized: "녹음을 시작하지 못했습니다.")); return }
            self.recorder = recorder
            NSSound(named: "Tink")?.play()
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
            recorder.record()
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
        recorder?.deleteRecording()
        meterTimer?.invalidate()
        recorder = nil
        state = .idle
    }

    private func startMeter() {
        meterTimer?.invalidate()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 20, repeats: true) { [weak self] _ in
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
            NSSound(named: "Tink")?.play()
            try? await Task.sleep(for: .milliseconds(250))
            NSSound(named: "Tink")?.play()
            self.onLimitReached?()
        }
    }
}
