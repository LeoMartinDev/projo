Pod::Spec.new do |s|
  s.name           = 'NativePlayer'
  s.version        = '0.1.0'
  s.summary        = 'projo player prototype: AVPlayerViewController from an Expo module (PRODUCT.md §26.6)'
  s.license        = 'UNLICENSED'
  s.author         = 'projo'
  s.homepage       = 'https://github.com/LeoMartinDev/projo'
  s.platforms      = { :ios => '17.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
