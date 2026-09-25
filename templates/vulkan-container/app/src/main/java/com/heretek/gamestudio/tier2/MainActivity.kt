package com.heretek.gamestudio.tier2

import android.app.Activity
import android.os.Bundle
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.WindowManager
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

    private lateinit var surfaceView: SurfaceView
    private var initialized = false
    private var surfaceReady = false

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
                nativeFrame()
            }
            surfaceView.postDelayed(this, 16) // ~60 FPS target
        }
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
