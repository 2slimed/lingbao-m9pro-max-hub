# Lingbao M9 Pro Max / Ultra Hub

An independent browser-based configurator for the **Lingbao M9 Pro Max / M9 Ultra** mouse, built by reverse-engineering Lingbao's public web configurator.

The app talks directly to the mouse through **WebHID**. No native driver or Lingbao backend is required for normal configuration.

## Current status

The current configurator can:

- connect to the M9 over WebHID
- identify wired / 2.4 GHz interfaces
- read and write the 128-byte onboard profile
- configure 500 / 1000 / 2000 / 4000 / 8000 Hz polling
- configure variant-specific lift-off distance
- configure six DPI stages, X/Y DPI, active stage and enable state
- configure debounce, Motion Sync, Linear Calibration and deep sleep
- read the live 33-byte button matrix
- remap Left / Right / Middle / Forward / Back buttons
- verify button-matrix writes by reading them back from the device
- inspect raw HID/profile diagnostics
- encode the reverse-engineered macro event format for further testing

Firmware flashing is intentionally not exposed yet.

## Supported variants

Both definitions use VID `0x320F` with PID `0x2299` / `0x22A0`, 128-byte profiles and a 33-byte button matrix.

| Variant | DPI range | LOD |
| --- | ---: | --- |
| M9 Pro Max | 100–26,000 | 1 mm / 2 mm |
| M9 Ultra | 100–42,000 | 0.7 mm / 1 mm / 2 mm |

Because the two variants expose the same USB IDs, the UI allows selecting the capability profile explicitly.

## Run locally

WebHID requires a secure context. `localhost` is accepted by Chromium browsers:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` in Chrome or Edge.

## GitHub Pages

This repository includes a GitHub Actions workflow that deploys the configurator to GitHub Pages on pushes to `main`.

The deployed app must be opened in a Chromium-based browser with WebHID support.

## Safety

The configurator preserves unknown profile/matrix bytes instead of rebuilding them from scratch. Button-matrix writes are immediately read back and byte-for-byte verified before being reported as successful.

## Disclaimer

This is an unofficial community project and is not affiliated with Lingbao. Device configuration is performed at your own risk.
