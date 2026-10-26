import AVFoundation
import AVKit
import ExpoModulesCore

struct PresentOptions: Record {
  @Field var url: String = ""
  @Field var title: String = ""
}

/// The §26.6 prototype: the system player, full screen, on an HLS URL. No "Skip intro":
/// `contextualActions` (like `transportBarCustomMenuItems` and `customOverlayViewController`) is
/// tvOS and visionOS only, `API_UNAVAILABLE(ios)` in AVKit.
public class NativePlayerModule: Module {
  private var controller: AVPlayerViewController?
  private let pip = PictureInPictureRestorer()

  public func definition() -> ModuleDefinition {
    Name("NativePlayer")

    AsyncFunction("present") { (options: PresentOptions, promise: Promise) in
      guard let url = URL(string: options.url) else {
        promise.reject("E_URL", "invalid url: \(options.url)")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("E_NO_VIEW", "no view controller to present from")
        return
      }
      self.controller?.player?.pause()
      // Background playback and PiP need the playback category (and UIBackgroundModes audio).
      try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
      try? AVAudioSession.sharedInstance().setActive(true)

      let item = AVPlayerItem(url: url)
      let title = AVMutableMetadataItem()
      title.identifier = .commonIdentifierTitle
      title.value = options.title as NSString
      title.extendedLanguageTag = "und"
      item.externalMetadata = [title]

      let controller = AVPlayerViewController()
      controller.player = AVPlayer(playerItem: item)
      controller.allowsPictureInPicturePlayback = true
      controller.canStartPictureInPictureAutomaticallyFromInline = true
      controller.modalPresentationStyle = .fullScreen
      controller.delegate = self.pip
      self.pip.presenter = presenter
      self.controller = controller
      presenter.present(controller, animated: true) {
        controller.player?.play()
        promise.resolve()
      }
    }.runOnQueue(.main)
  }
}

/// Without it, leaving PiP from the system "restore" button stops playback instead of bringing
/// the full-screen player back.
final class PictureInPictureRestorer: NSObject, AVPlayerViewControllerDelegate {
  weak var presenter: UIViewController?

  func playerViewController(
    _ playerViewController: AVPlayerViewController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler:
      @escaping (Bool) -> Void
  ) {
    guard playerViewController.presentingViewController == nil, let presenter else {
      completionHandler(true)
      return
    }
    presenter.present(playerViewController, animated: true) { completionHandler(true) }
  }
}
