## Installing Reprise

Reprise is not signed or notarized yet, so macOS and Windows warn the first time you open it. The files below are the same app, one per platform.

| Your computer                      | Download                                  |
| ---------------------------------- | ----------------------------------------- |
| Mac with Apple silicon (M1 and on) | `Reprise-<version>-mac-arm64.dmg`         |
| Mac with an Intel processor        | `Reprise-<version>-mac-x64.dmg`           |
| Windows 10 or 11, 64-bit           | `Reprise-<version>-windows-x64-setup.exe` |

The `.zip` files hold the same Mac apps without the disk image. Not sure which Mac you have? Apple menu → About This Mac.

### macOS

Open the `.dmg` and drag Reprise to Applications. The first launch is blocked as an app from an unidentified developer:

- **macOS 15 (Sequoia) and later:** open Reprise once and choose **Done** in the warning (not Move to Trash), then go to System Settings → Privacy & Security, scroll to the message about Reprise and choose **Open Anyway**. Confirm with your password. **Open Anyway** is shown for about an hour after the blocked launch; if it is missing, open Reprise again first. The right-click → Open route from older macOS versions no longer works here.
- **macOS 14 and earlier:** Control-click (right-click) Reprise in Finder, choose **Open**, then confirm.

After that it opens normally. If macOS says Reprise "is damaged", the download is incomplete or does not match `SHA256SUMS.txt`: download it again.

### Windows

Run the setup file. SmartScreen shows "Windows protected your PC": choose **More info**, then **Run anyway**. The installer is per-user and does not ask for administrator rights.

### Microphone

On macOS the tuner asks for the microphone the first time you start it. If you answered no, allow Reprise under System Settings → Privacy & Security → Microphone. Windows shows no prompt for desktop apps; if the tuner cannot hear you, check that **Let desktop apps access your microphone** is on under Settings → Privacy & security → Microphone.

### Checking a download

`SHA256SUMS.txt` lists the SHA-256 of every installer. On macOS run `shasum -a 256 <file>`; on Windows run `certutil -hashfile <file> SHA256` or `Get-FileHash <file>`, and compare.
