package ca.co2lab.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * The agent's hands and eyes: screenshots, reading the on-screen UI tree, tapping, and
 * opening apps. Being an accessibility service also lets us start other apps from the background.
 */
class AgentAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: AgentAccessibilityService? = null
            private set
    }

    data class Shot(val jpegBase64: String, val width: Int, val height: Int, val looksBlank: Boolean)

    private val worker = Executors.newSingleThreadExecutor()

    override fun onServiceConnected() {
        instance = this
        AgentStatus.update { it.copy(accessibility = true) }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        AgentStatus.update { it.copy(accessibility = false) }
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    /** Screenshot of the whole screen, downscaled so its width is at most [maxWidth], as JPEG. */
    fun screenshot(maxWidth: Int, quality: Int = 60, callback: (Result<Shot>) -> Unit) {
        takeScreenshot(Display.DEFAULT_DISPLAY, worker, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                try {
                    val hardware = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                        ?: error("could not read screenshot buffer")
                    val full = hardware.copy(Bitmap.Config.ARGB_8888, false)
                    hardware.recycle()
                    result.hardwareBuffer.close()

                    val scaled = if (full.width > maxWidth) {
                        val h = full.height * maxWidth / full.width
                        Bitmap.createScaledBitmap(full, maxWidth, h, true).also { full.recycle() }
                    } else full

                    val blank = looksBlank(scaled)
                    val out = ByteArrayOutputStream()
                    scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
                    val shot = Shot(
                        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP),
                        scaled.width, scaled.height, blank,
                    )
                    scaled.recycle()
                    callback(Result.success(shot))
                } catch (e: Exception) {
                    callback(Result.failure(e))
                }
            }

            override fun onFailure(errorCode: Int) {
                callback(Result.failure(IllegalStateException("screenshot failed, code $errorCode")))
            }
        })
    }

    /** Apps with secure screens come back solid black. Sample a grid of pixels to detect that. */
    private fun looksBlank(bmp: Bitmap): Boolean {
        val first = bmp.getPixel(0, 0)
        for (gx in 1..9) for (gy in 1..19) {
            if (bmp.getPixel(bmp.width * gx / 10, bmp.height * gy / 20) != first) return false
        }
        return true
    }

    /** Flat list of meaningful nodes in the active window, with path ids like "0.3.1". */
    fun dumpNodes(limit: Int = 300): JSONArray {
        val out = JSONArray()
        val root = rootInActiveWindow ?: return out
        fun walk(node: AccessibilityNodeInfo, id: String) {
            if (out.length() >= limit) return
            val text = node.text?.toString()
            val desc = node.contentDescription?.toString()
            if (!text.isNullOrBlank() || !desc.isNullOrBlank() || node.isClickable) {
                val r = Rect().also { node.getBoundsInScreen(it) }
                out.put(JSONObject().apply {
                    put("id", id)
                    put("text", text ?: JSONObject.NULL)
                    put("desc", desc ?: JSONObject.NULL)
                    put("viewId", node.viewIdResourceName ?: JSONObject.NULL)
                    put("clickable", node.isClickable)
                    put("bounds", JSONArray(listOf(r.left, r.top, r.right, r.bottom)))
                })
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, "$id.$i") }
        }
        walk(root, "0")
        return out
    }

    fun currentPackage(): String? = rootInActiveWindow?.packageName?.toString()

    /** Tap the first node whose text or description contains [text] (case-insensitive). */
    fun clickText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val match = root.findAccessibilityNodeInfosByText(text).firstOrNull() ?: return false
        var node: AccessibilityNodeInfo? = match
        while (node != null && !node.isClickable) node = node.parent
        if (node != null) return node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val r = Rect().also { match.getBoundsInScreen(it) }
        return tap(r.exactCenterX(), r.exactCenterY())
    }

    fun tap(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    fun scroll(down: Boolean): Boolean {
        val m = resources.displayMetrics
        val x = m.widthPixels / 2f
        val (from, to) = if (down) m.heightPixels * 0.75f to m.heightPixels * 0.3f
        else m.heightPixels * 0.3f to m.heightPixels * 0.75f
        val path = Path().apply { moveTo(x, from); lineTo(x, to) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 350))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    fun back() = performGlobalAction(GLOBAL_ACTION_BACK)

    fun home() = performGlobalAction(GLOBAL_ACTION_HOME)

    /** Open another app by package name. Returns false if it is not installed. */
    fun launch(packageName: String): Boolean {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        startActivity(intent)
        return true
    }

    fun installedPackages(filter: String): List<String> =
        packageManager.getInstalledApplications(0)
            .map { it.packageName }
            .filter { it.contains(filter, ignoreCase = true) }
            .sorted()
}
