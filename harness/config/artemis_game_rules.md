# Artemis Autonomous 3D Game QA Mindset & Guidelines

When testing 3D Android games developed in **Heretek 3D Android Studio**, AI agents and test runners must follow these core principles:

## 1. Dynamic-First, Coordinate-Fallback Locator Pattern
* **On-Screen Virtual Sticks**:
  - Locate virtual analog joysticks dynamically via bounding box `#joystick-container` or screen quarter quadrant (Bottom-Left: 0–30% X, 70–100% Y).
  - Use relative vector drags from the stick center rather than absolute screen coordinates.
* **Action Buttons**:
  - Prioritize OCR / Text matching for on-screen labels (`JUMP`, `ACTION`, `FIRE`).
  - Fall back to standard mobile touch coordinates when custom 3D mesh overlays are rendered directly to WebGL canvas.

## 2. Timing & Physics Compensation
* **Rapier3D Simulation Step**:
  - Allow 100–300ms latency after initiating touch joystick drags for physics momentum and character acceleration to take effect.
  - For jump assertions, wait until peak arc (~400ms) before evaluating height or collision triggers.

## 3. Telemetry & Logcat Diagnostics
* Monitor Logcat tag `StudioGameLog`:
  - `[INFO]`: General engine and scene state transitions.
  - `[WARN]`: Dropped frames (<60 FPS) or asset loading delays.
  - `[ERROR]`: Shader compilation failures, physics NaN bounds, or uncaught exceptions.
* Any unhandled error in Logcat halts test runs and triggers the Studio AI Copilot self-healing routine.
