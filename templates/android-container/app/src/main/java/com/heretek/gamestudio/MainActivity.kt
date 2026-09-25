package com.heretek.gamestudio

import android.annotation.SuppressLint
import org.json.JSONObject
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val TAG = "Heretek3DGame"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        // Must run after setContentView: window.insetsController dereferences the
        // decor view, which does not exist during the earliest part of onCreate.
        hideSystemUI()

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(url)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (consoleMessage != null) {
                    Log.d(
                        "StudioGameLog",
                        "[${consoleMessage.messageLevel()}] ${consoleMessage.message()} -- From line ${consoleMessage.lineNumber()} of ${consoleMessage.sourceId()}"
                    )
                }
                return true
            }
        }

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true

        // Force hardware acceleration for WebGL2 60 FPS
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        // Native Android Bridge
        webView.addJavascriptInterface(AndroidGameBridge(this), "AndroidBridge")

        // Load bundled game
        val targetUrl = "https://appassets.androidplatform.net/assets/game/index.html"
        Log.i(TAG, "Loading 3D Android Game from: $targetUrl")
        webView.loadUrl(targetUrl)
    }

    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemUI()
        }
    }

    inner class AndroidGameBridge(private val context: Context) {
        @JavascriptInterface
        fun vibrate(durationMs: Long) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                    val vibrator = vibratorManager.defaultVibrator
                    vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator.vibrate(durationMs)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Vibrate failed: ${e.message}")
            }
        }

        @JavascriptInterface
        fun log(tag: String, message: String) {
            Log.d("StudioGameLog", "[$tag] $message")
        }

        /**
         * Device/build context for the packaged studio: the WebView has no dev-server
         * bridges, so this is the authoritative device identity inside the APK.
         */
        @JavascriptInterface
        fun deviceInfo(): String {
            return try {
                val info = JSONObject()
                info.put("nativeBridge", true)
                info.put("model", Build.MODEL)
                info.put("manufacturer", Build.MANUFACTURER)
                info.put("device", Build.DEVICE)
                info.put("sdkInt", Build.VERSION.SDK_INT)
                info.put("abis", Build.SUPPORTED_ABIS.joinToString(","))
                info.put("packageName", context.packageName)
                val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
                info.put("appVersion", packageInfo.versionName ?: "unknown")
                info.toString()
            } catch (e: Exception) {
                Log.e(TAG, "deviceInfo failed: ${e.message}")
                "{}"
            }
        }
    }
}
