package com.heretek.gamestudio.tier2

import android.app.Activity
import android.os.Bundle
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.io.File
import java.io.FileOutputStream

/**
 * Heretek Tier 2 — native Vulkan container activity.
 *
 * Copies the exported scene (scene.native) and the compiled SPIR-V shaders out
 * of the APK assets into internal storage, hands the paths to the native
 * renderer, and drives the frame loop from a SurfaceView callback.
 */
class MainActivity : Activity(), SurfaceHolder.Callback {

    private external fun nativeInit(scenePath: String, shaderDir: String): Boolean
    private external fun nativeSurfaceCreated(surface: android.view.Surface, width: Int, height: Int): Boolean
    private external fun nativeSurfaceDestroyed()
    private external fun nativeDrawCalls(): Int
    private external fun nativeInstanceCount(): Int
    private external fun nativeTerrainLeaves(): Int
    private external fun nativeTerrainVertices(): Int
    private external fun nativeCaptureFrame(path: String): Boolean
    private external fun nativeFrame()
    private external fun nativeShutdown()
    /** Experiment 1 (delta-loop spike): batched per-frame instance sync. */
    private external fun nativeSyncInstances(slots: IntArray, xyz: FloatArray): Int

    private lateinit var surfaceView: SurfaceView
    private var initialized = false
    private var surfaceReady = false

    // ---- Experiment 1 probe state (delta-loop spike) ----
    @Volatile private var pendingSlots: IntArray? = null
    @Volatile private var pendingXyz: FloatArray? = null
    private val frameDeltasNs = ArrayList<Long>(1024)
    private val syncCostsNs = ArrayList<Long>(1024)
    private var lastFrameNs: Long = 0
    private var syncFrames = 0
    private var syncPushes = 0
    private var probeView: WebView? = null
    private var probeWarned = false

    private inner class SyncBridge {
        @JavascriptInterface
        fun push(payload: String) {
            // Binder thread: parse compact "slot,x,y,z;..." and stage for the frame loop.
            try {
                val entries = payload.split(';')
                val slots = IntArray(entries.size)
                val xyz = FloatArray(entries.size * 3)
                for (i in entries.indices) {
                    val p = entries[i].split(',')
                    slots[i] = p[0].toInt()
                    xyz[i * 3] = p[1].toFloat()
                    xyz[i * 3 + 1] = p[2].toFloat()
                    xyz[i * 3 + 2] = p[3].toFloat()
                }
                pendingSlots = slots
                pendingXyz = xyz
                if (syncPushes == 0) {
                    android.util.Log.i("HeretekTier2", "sync probe: first push received (${slots.size} movers)")
                }
                syncPushes++
            } catch (e: Exception) {
                android.util.Log.w("HeretekTier2", "sync payload parse failed: ${e.message}")
            }
        }
    }

    companion object {
        init {
            System.loadLibrary("heretek_native")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val sceneFile = copyAsset("scene.native", File(filesDir, "scene.native"))
        val shaderDir = File(filesDir, "shaders").apply { mkdirs() }
        copyAsset("shaders/cull.comp.spv", File(shaderDir, "cull.comp.spv"))
        copyAsset("shaders/scene.vert.spv", File(shaderDir, "scene.vert.spv"))
        copyAsset("shaders/scene.frag.spv", File(shaderDir, "scene.frag.spv"))
        copyAsset("shaders/terrain.vert.spv", File(shaderDir, "terrain.vert.spv"))
        copyAsset("shaders/terrain.frag.spv", File(shaderDir, "terrain.frag.spv"))
        copyAsset("shaders/foliage.vert.spv", File(shaderDir, "foliage.vert.spv"))

        initialized = nativeInit(sceneFile.absolutePath, shaderDir.absolutePath)
        if (initialized) {
            android.util.Log.i(
                "HeretekTier2",
                "Scene ready — draws=${nativeDrawCalls()} instances=${nativeInstanceCount()} " +
                    "terrainLeaves=${nativeTerrainLeaves()} terrainVertices=${nativeTerrainVertices()}"
            )
        }

        surfaceView = SurfaceView(this)
        surfaceView.holder.addCallback(this)
        setContentView(
            surfaceView,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        // Experiment 1: hidden WebView driving the fixed-dt waypoint stepper.
        // Driven explicitly via evaluateJavascript (rAF throttles in hidden views).
        val probeView = WebView(this)
        probeView.layoutParams = ViewGroup.LayoutParams(1, 1)
        probeView.settings.javaScriptEnabled = true
        probeView.addJavascriptInterface(SyncBridge(), "Sync")
        (surfaceView.parent as ViewGroup).addView(probeView)
        probeView.loadUrl("file:///android_asset/sync_probe.html")
        this.probeView = probeView
    }

    private fun copyAsset(assetPath: String, target: File): File {
        // Always refresh extracted assets: the APK's bundled scene/shaders are the
        // source of truth, and a stale copy silently renders the previous build.
        var bytes = 0L
        assets.open(assetPath).use { input ->
            FileOutputStream(target).use { output ->
                bytes = input.copyTo(output)
            }
        }
        android.util.Log.i("HeretekTier2", "Synced asset $assetPath (${bytes} bytes)")
        return target
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        surfaceReady = initialized &&
            nativeSurfaceCreated(holder.surface, surfaceView.width, surfaceView.height)
        android.util.Log.i(
            "HeretekTier2",
            "surfaceCreated ${surfaceView.width}x${surfaceView.height} — frame loop: $surfaceReady"
        )
        if (surfaceReady) {
            surfaceView.post(frameLoop)
            // One-shot renderer readback for on-device verification (pulled via run-as).
            surfaceView.postDelayed({
                val frameFile = File(filesDir, "native_frame.ppm")
                val requested = nativeCaptureFrame(frameFile.absolutePath)
                android.util.Log.i(
                    "HeretekTier2",
                    "frame capture requested=$requested -> ${frameFile.absolutePath}"
                )
            }, 2000)
            // Second capture later in the run: comparing the two readbacks proves
            // time-driven GPU effects (foliage wind) are actually animating.
            surfaceView.postDelayed({
                val lateFrame = File(filesDir, "native_frame_late.ppm")
                nativeCaptureFrame(lateFrame.absolutePath)
                android.util.Log.i("HeretekTier2", "late frame capture -> ${lateFrame.absolutePath}")
            }, 6000)
        }
    }

    private val frameLoop = object : Runnable {
        override fun run() {
            if (surfaceReady) {
                val nowNs = System.nanoTime()
                if (lastFrameNs != 0L) {
                    frameDeltasNs.add(nowNs - lastFrameNs)
                }
                lastFrameNs = nowNs
                // Experiment 1: tick the JS stepper explicitly (hidden views
                // throttle rAF), then apply the latest staged sync batch, timed.
                try {
                    probeView?.evaluateJavascript(
                        "window.__probeTick ? window.__probeTick(Date.now()) : 'no-probe'"
                    ) { value ->
                        if (!probeWarned && value != null && (value.contains("no-probe") || value.contains("undefined"))) {
                            probeWarned = true
                            android.util.Log.w("HeretekTier2", "sync probe page not ready: $value")
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.w("HeretekTier2", "probe tick failed: ${e.message}")
                }
                val slots = pendingSlots
                val xyz = pendingXyz
                if (slots != null && xyz != null) {
                    pendingSlots = null
                    pendingXyz = null
                    val t0 = System.nanoTime()
                    val applied = nativeSyncInstances(slots, xyz)
                    syncCostsNs.add(System.nanoTime() - t0)
                    if (applied != slots.size) {
                        android.util.Log.w(
                            "HeretekTier2",
                            "sync partial: applied=$applied of ${slots.size}"
                        )
                    }
                }
                nativeFrame()
                syncFrames++
                if (syncFrames == 600) {
                    reportSyncStats()
                }
            }
            surfaceView.postDelayed(this, 16) // ~60 FPS target
        }
    }

    private fun reportSyncStats() {
        if (frameDeltasNs.isEmpty()) return
        val sorted = frameDeltasNs.sorted()
        fun pct(p: Double): Double =
            sorted[((sorted.size * p).toInt()).coerceIn(0, sorted.size - 1)] / 1_000_000.0
        val meanSyncUs = if (syncCostsNs.isEmpty()) -1.0
        else syncCostsNs.average() / 1_000.0
        android.util.Log.i(
            "HeretekTier2",
            "SYNC_STATS frames=${sorted.size} p50=${"%.2f".format(pct(0.5))}ms " +
                "p95=${"%.2f".format(pct(0.95))}ms max=${"%.2f".format(pct(1.0))}ms " +
                "syncBatches=${syncCostsNs.size} meanSync=${"%.1f".format(meanSyncUs)}us"
        )
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceView.removeCallbacks(frameLoop)
        if (surfaceReady) {
            nativeSurfaceDestroyed()
            surfaceReady = false
        }
    }

    override fun onDestroy() {
        surfaceView.removeCallbacks(frameLoop)
        nativeShutdown()
        super.onDestroy()
    }
}
