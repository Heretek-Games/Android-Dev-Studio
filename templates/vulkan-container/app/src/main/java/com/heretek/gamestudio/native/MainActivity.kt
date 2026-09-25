package com.heretek.gamestudio.native

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
 * Copies the exported scene (scene.native) out of the APK assets into internal
 * storage, hands the path to the native scene loader, and drives the native
 * frame entry point from a SurfaceView callback loop.
 */
class MainActivity : Activity(), SurfaceHolder.Callback {

    private external fun nativeInit(scenePath: String): Boolean
    private external fun nativeDrawCalls(): Int
    private external fun nativeInstanceCount(): Int
    private external fun nativeFrame()
    private external fun nativeShutdown()

    private lateinit var surfaceView: SurfaceView
    private var initialized = false

    companion object {
        init {
            System.loadLibrary("heretek_native")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val sceneFile = File(filesDir, "scene.native")
        if (!sceneFile.exists()) {
            assets.open("scene.native").use { input ->
                FileOutputStream(sceneFile).use { output -> input.copyTo(output) }
            }
        }
        initialized = nativeInit(sceneFile.absolutePath)

        surfaceView = SurfaceView(this)
        surfaceView.holder.addCallback(this)
        setContentView(surfaceView, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        // Native frame loop entry (swapchain presentation lands with the
        // Tier 2 pipeline; today the scene graph is live in native memory).
        if (initialized) {
            surfaceView.post(frameLoop)
        }
    }

    private val frameLoop = object : Runnable {
        override fun run() {
            nativeFrame()
            surfaceView.postDelayed(this, 16) // ~60 FPS target
        }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {}

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        surfaceView.removeCallbacks(frameLoop)
    }

    override fun onDestroy() {
        surfaceView.removeCallbacks(frameLoop)
        nativeShutdown()
        super.onDestroy()
    }
}
