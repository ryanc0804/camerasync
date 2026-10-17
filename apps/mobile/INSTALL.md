# Installing the 8kount app without the app stores

Until 8kount is on the App Store and Google Play, install it straight onto
phones. Both builds below talk to production (https://8kount.app).

## Android

Build once on any computer with Flutter, from `apps/mobile`:

```
flutter build apk --release
```

The file is `build/app/outputs/flutter-apk/app-release.apk`. To put it on a
phone, either:

- **With a cable:** turn on USB debugging (Settings → About phone → tap
  *Build number* 7 times → Developer options → USB debugging), plug in, and
  run `adb install -r build/app/outputs/flutter-apk/app-release.apk`.
- **Without a cable:** send the APK to the phone (Google Drive, email, a
  USB stick), open it, and allow "Install unknown apps" for whatever opened
  it when Android asks.

An older 8kount build (the `com.camerasync…` one, from before the app ID
changed) installs as a separate app. Uninstall it.

**Signing:** the APK is signed with `android/key.properties` if it exists,
otherwise with the building computer's debug key. A phone only takes an
update signed with the same key it was installed with, so build every
update on the same computer (or with the same key.properties), or uninstall
first.

## iPhone (needs a Mac)

A free Apple ID is enough. The install lasts **7 days**, then the app stops
opening until it's installed again (repeat step 6), so install the week you
need it.

### One-time setup on the Mac

1. Install **Xcode** from the Mac App Store and open it once to finish
   setup.
2. Install **Flutter** (https://docs.flutter.dev/get-started/install/macos)
   and **CocoaPods** (`brew install cocoapods`).
3. Get the code: `git clone https://github.com/ryanc0804/camerasync.git`.
4. In Xcode → **Settings → Accounts**, add your Apple ID (+ → Apple ID).

### Each install

1. In `apps/mobile`: `flutter pub get`, then `cd ios && pod install && cd ..`.
2. Open `ios/Runner.xcworkspace` in Xcode (the *workspace*, not the
   .xcodeproj).
3. Select **Runner** (left) → the **Runner** target → **Signing &
   Capabilities** → check *Automatically manage signing* and pick your
   **Personal Team**.
   - If Xcode says the bundle identifier `app.eightkount` can't be
     registered, change it there to something unique like
     `app.eightkount.yourname`. Don't commit that change.
4. Plug in the iPhone, unlock it and tap **Trust** on "Trust This
   Computer?".
5. On the iPhone, turn on **Developer Mode**: Settings → Privacy &
   Security → Developer Mode → On, then restart it. (It only appears after
   the phone has been plugged into Xcode once.)
6. From `apps/mobile`, run `flutter run --release` and pick the iPhone.
7. The first time, the iPhone won't open the app until you trust its
   developer: Settings → General → **VPN & Device Management** → your
   Apple ID → **Trust**.

A free Apple ID can have 3 of these apps on a phone at once. Push
notifications aren't available on free accounts (the app's alerts work
while it's open).
