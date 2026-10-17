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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The agent's hands and eyes: screenshots, reading the on-screen UI tree, tapping, and
 * opening apps. Being an accessibility service also lets us start other apps from the background.
 * Blocking methods must be called from a worker thread, never the main thread.
 */
class AgentAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: AgentAccessibilityService? = null
            private set

        /** Android rejects screenshots taken closer together than this. */
        private const val MIN_SHOT_GAP_MS = 400L
    }

    /** One node of the active window, with a path id like "0.3.1" (see shared UiNode). */
    data class Node(
        val id: String,
        val text: String?,
        val desc: String?,
        val viewId: String?,
        val clickable: Boolean,
        val bounds: Rect,
        val info: AccessibilityNodeInfo,
    ) {
        fun label(): String = text?.takeIf { it.isNotBlank() } ?: desc ?: ""

        fun toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("text", text ?: JSONObject.NULL)
            .put("desc", desc ?: JSONObject.NULL)
            .put("viewId", viewId ?: JSONObject.NULL)
            .put("clickable", clickable)
            .put("bounds", JSONArray(listOf(bounds.left, bounds.top, bounds.right, bounds.bottom)))
    }

    private val shotExecutor = Executors.newSingleThreadExecutor()
    private val shotLock = Object()
    private var lastShotAt = 0L

    override fun onServiceConnected() {
        instance = this
        AgentStatus.update { it.copy(accessibility = true) }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        AgentStatus.update { it.copy(accessibility = false) }
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        AgentStatus.update { it.copy(accessibility = false) }
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    // ---------- Screenshots ----------

    /** Full-resolution screenshot (blocking). Serialized and spaced so frames and captures can share it. */
    fun grab(): Bitmap {
        synchronized(shotLock) {
            var lastError = "screenshot failed"
            repeat(4) {
                val wait = lastShotAt + MIN_SHOT_GAP_MS - System.currentTimeMillis()
                if (wait > 0) Thread.sleep(wait)
                lastShotAt = System.currentTimeMillis()
                val latch = CountDownLatch(1)
                var bmp: Bitmap? = null
                var code = -1
                takeScreenshot(Display.DEFAULT_DISPLAY, shotExecutor, object : TakeScreenshotCallback {
                    override fun onSuccess(result: ScreenshotResult) {
                        try {
                            val hw = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                            bmp = hw?.copy(Bitmap.Config.ARGB_8888, false)
                            hw?.recycle()
                        } finally {
                            result.hardwareBuffer.close()
                            latch.countDown()
                        }
                    }

                    override fun onFailure(errorCode: Int) {
                        code = errorCode
                        latch.countDown()
                    }
                })
                if (!latch.await(5, TimeUnit.SECONDS)) lastError = "screenshot timed out"
                bmp?.let { return it }
                if (code != -1) lastError = "screenshot failed, code $code"
                // Code 3 = too soon after the last one; anything else may be transient too.
                Thread.sleep(MIN_SHOT_GAP_MS)
            }
            throw IllegalStateException(lastError)
        }
    }

    fun nodesJson(nodes: List<Node>): JSONArray = JSONArray().also { a -> nodes.forEach { a.put(it.toJson()) } }

    // ---------- UI tree ----------

    /**
     * Flat list of meaningful nodes in the active window. The root ("0") is always first so the
     * hub can read the screen size from its bounds.
     */
    fun nodes(limit: Int = 300): List<Node> {
        val out = mutableListOf<Node>()
        val root = rootInActiveWindow ?: return out
        fun walk(node: AccessibilityNodeInfo, id: String) {
            if (out.size >= limit) return
            if (!node.isVisibleToUser && id != "0") return
            val text = node.text?.toString()
            val desc = node.contentDescription?.toString()
            if (id == "0" || !text.isNullOrBlank() || !desc.isNullOrBlank() || node.isClickable) {
                val r = Rect().also { node.getBoundsInScreen(it) }
                out += Node(id, text, desc, node.viewIdResourceName, node.isClickable, r, node)
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { walk(it, "$id.$i") }
        }
        walk(root, "0")
        return out
    }

    fun currentPackage(): String? = rootInActiveWindow?.packageName?.toString()

    /** First node whose text or description matches one of [texts] (case-insensitive). */
    fun find(nodes: List<Node>, texts: List<String>, contains: Boolean = false): Node? {
        // Try texts in order so the recipe's first choice wins.
        for (t in texts) {
            val want = t.trim()
            nodes.firstOrNull { n ->
                listOfNotNull(n.text, n.desc).any { v ->
                    val have = v.trim()
                    if (contains) have.contains(want, ignoreCase = true) else have.equals(want, ignoreCase = true)
                } && n.bounds.width() > 0 && n.bounds.height() > 0
            }?.let { return it }
        }
        return null
    }

    /** Click [node] through its nearest clickable ancestor, or tap its center as a fallback. */
    fun click(node: Node): Boolean {
        var n: AccessibilityNodeInfo? = node.info
        while (n != null && !n.isClickable) n = n.parent
        if (n != null && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        return tap(node.bounds.exactCenterX(), node.bounds.exactCenterY())
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
        val (from, to) = if (down) m.heightPixels * 0.72f to m.heightPixels * 0.32f
        else m.heightPixels * 0.32f to m.heightPixels * 0.72f
        val path = Path().apply { moveTo(x, from); lineTo(x, to) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 450))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    fun back() = performGlobalAction(GLOBAL_ACTION_BACK)

    fun home() = performGlobalAction(GLOBAL_ACTION_HOME)

    /** Open an app on its start screen (clears its task so we never resume a stale screen). */
    fun launchFresh(packageName: String): Boolean {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        startActivity(intent)
        return true
    }

    /** Open an app the normal way (resumes its last screen). Probe use only. */
    fun launch(packageName: String): Boolean {
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        startActivity(intent)
        return true
    }
}

/** Image helpers shared by frames, evidence, and proxy requests. */
object Images {
    /** Scale so the width is at most [maxWidth], encode as JPEG, base64 without a data: prefix. */
    fun jpeg(full: Bitmap, maxWidth: Int, quality: Int = 60): Triple<String, Int, Int> {
        val scaled = if (full.width > maxWidth) {
            Bitmap.createScaledBitmap(full, maxWidth, full.height * maxWidth / full.width, true)
        } else full
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        val result = Triple(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP), scaled.width, scaled.height)
        if (scaled !== full) scaled.recycle()
        return result
    }

    /** Apps with secure screens come back solid black. Sample a grid of pixels to detect that. */
    fun looksBlank(bmp: Bitmap): Boolean {
        val first = bmp.getPixel(0, 0)
        val dark = android.graphics.Color.red(first) < 16 && android.graphics.Color.green(first) < 16 && android.graphics.Color.blue(first) < 16
        if (!dark) return false
        for (gx in 1..9) for (gy in 1..19) {
            if (bmp.getPixel(bmp.width * gx / 10, bmp.height * gy / 20) != first) return false
        }
        return true
    }
}
