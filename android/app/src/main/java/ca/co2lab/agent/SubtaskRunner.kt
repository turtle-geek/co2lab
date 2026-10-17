package ca.co2lab.agent

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import ca.co2lab.agent.protocol.Assign
import ca.co2lab.agent.protocol.Msg
import ca.co2lab.agent.protocol.ProxyAction
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * Runs assigned app subtasks one at a time (SPEC §4.3): open the app fresh, follow its recipe to
 * the deals screen, screenshot while scrolling, and send the screenshots as evidence. When the
 * recipe gets stuck (or mode = vision) it asks the hub's agent proxy for one action at a time.
 */
class SubtaskRunner(private val context: Context, private val link: Link) {

    interface Link {
        /** Best-effort send (frames, steps, proxy requests). */
        fun send(msg: JSONObject)
        /** Must arrive: kept and resent after a reconnect (results, failures). */
        fun sendReliable(msg: JSONObject)
        fun deviceName(): String
    }

    /** Ends a subtask with a reason the owner sees on the tree card. */
    class Failure(val reason: String) : Exception(reason)
    private class Cancelled : Exception()

    companion object {
        private const val TAG = "Co2labRunner"
        const val MAX_PROXY_ACTIONS = 8
        private const val PROXY_TIMEOUT_MS = 45_000L
        private const val LAUNCH_TIMEOUT_MS = 15_000L
        private const val FRAME_MAX_WIDTH = 720
        private const val FRAME_MS = 1_000L
    }

    private val queue = LinkedBlockingQueue<Assign>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()
    private val proxyReplies = ConcurrentHashMap<String, LinkedBlockingQueue<JSONObject>>()

    @Volatile
    private var current: Assign? = null
    private var proxySeq = 0

    private val thread = Thread({ loop() }, "co2lab-runner").apply { isDaemon = true; start() }

    /** Ids the device owns right now (running + queued), for heartbeats. */
    fun owned(): List<String> = listOfNotNull(current?.subtaskId) + queue.map { it.subtaskId }

    fun assign(a: Assign) {
        if (owned().contains(a.subtaskId)) return
        cancelled.remove(a.subtaskId)
        queue.put(a)
    }

    fun cancel(subtaskId: String) {
        cancelled += subtaskId
        queue.removeAll { it.subtaskId == subtaskId }
        proxyReplies.values.forEach { it.offer(JSONObject().put("kind", "cancelled")) }
    }

    fun onProxyAction(requestId: String, action: JSONObject) {
        proxyReplies[requestId]?.offer(action)
    }

    // ---------- Loop ----------

    private fun loop() {
        while (true) {
            val a = queue.take()
            if (cancelled.contains(a.subtaskId)) continue
            current = a
            AgentStatus.update { it.copy(task = "${a.capability}: starting") }
            val frames = FrameStreamer(a.subtaskId).also { it.start() }
            try {
                val (images, text) = run(a)
                check(a)
                link.sendReliable(Msg.result(a.subtaskId, images, text))
                AgentStatus.update { it.copy(lastMessage = "Done ${a.capability}: ${images.size} screenshots") }
            } catch (e: Cancelled) {
                AgentStatus.update { it.copy(lastMessage = "Cancelled ${a.capability}") }
            } catch (e: Failure) {
                if (!cancelled.contains(a.subtaskId)) link.sendReliable(Msg.failed(a.subtaskId, e.reason))
                AgentStatus.update { it.copy(lastMessage = "Failed ${a.capability}: ${e.reason}") }
            } catch (e: Exception) {
                Log.e(TAG, "subtask crashed", e)
                val reason = "agent error on ${link.deviceName()}: ${e.message ?: e.javaClass.simpleName}"
                if (!cancelled.contains(a.subtaskId)) link.sendReliable(Msg.failed(a.subtaskId, reason))
                AgentStatus.update { it.copy(lastMessage = "Failed ${a.capability}: $reason") }
            } finally {
                frames.stop()
                AgentAccessibilityService.instance?.home()
                current = null
                AgentStatus.update { it.copy(task = null) }
            }
        }
    }

    private fun check(a: Assign) {
        if (cancelled.contains(a.subtaskId)) throw Cancelled()
    }

    private fun step(a: Assign, kind: String, text: String, progress: Double? = null) {
        check(a)
        Log.i(TAG, "[$kind] $text")
        AgentStatus.update { it.copy(task = "${a.capability}: $text") }
        link.send(Msg.step(a.subtaskId, kind, text, progress))
    }

    private fun sleep(a: Assign, ms: Long) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            check(a)
            Thread.sleep(minOf(150L, end - System.currentTimeMillis()).coerceAtLeast(1))
        }
    }

    private fun a11y(): AgentAccessibilityService =
        AgentAccessibilityService.instance ?: throw Failure("accessibility service is off on ${link.deviceName()}")

    /** Returns (evidence images, evidence text). */
    private fun run(a: Assign): Pair<List<String>, String?> {
        val catalog = AppCatalog(context)
        val appId = a.appId ?: throw Failure("${link.deviceName()} cannot run ${a.capability}")
        val app = catalog.apps[appId] ?: throw Failure("${link.deviceName()} has no recipe for ${a.capability}")
        val pkg = catalog.resolve(appId) ?: throw Failure("${app.label} is not installed on ${link.deviceName()}")
        val svc = a11y()

        step(a, "recipe", "Opening ${app.label}", 0.05)
        svc.home()
        sleep(a, 600)
        if (!svc.launchFresh(pkg)) throw Failure("${app.label} is not installed on ${link.deviceName()}")
        waitForPackage(a, pkg, app.label)
        sleep(a, 2_500) // let the start screen settle (splash, banners)

        if (a.config.mode == "vision") {
            step(a, "fallback", "Vision mode: asking the hub for each action", 0.15)
            proxy(a, a.goal.ifBlank { "Open the screen that lists all current deals or offers in ${app.label}" }, pkg, app)
        } else {
            app.steps.forEachIndexed { i, s ->
                val progress = 0.15 + 0.35 * i / app.steps.size.coerceAtLeast(1)
                step(a, "recipe", s.goal, progress)
                val ok = runStep(a, s, app, pkg)
                if (!ok && !s.optional) {
                    step(a, "fallback", "Recipe stuck at \"${s.goal}\", asking the hub", progress)
                    proxy(a, "${s.goal} in ${app.label} (overall goal: ${a.goal})", pkg, app)
                    return capture(a, app, pkg)
                }
            }
        }
        return capture(a, app, pkg)
    }

    private fun waitForPackage(a: Assign, pkg: String, label: String) {
        val end = System.currentTimeMillis() + LAUNCH_TIMEOUT_MS
        while (System.currentTimeMillis() < end) {
            if (a11y().currentPackage() == pkg) return
            sleep(a, 300)
        }
        throw Failure("$label did not open on ${link.deviceName()}")
    }

    /** One recipe step: wait for one of the target texts and tap it; dismiss known popups meanwhile. */
    private fun runStep(a: Assign, s: AppCatalog.Step, app: AppCatalog.App, pkg: String): Boolean {
        val end = System.currentTimeMillis() + s.timeoutMs
        while (System.currentTimeMillis() < end) {
            val svc = a11y()
            val nodes = svc.nodes()
            val target = svc.find(nodes, s.tap, s.contains)
            if (target != null && svc.currentPackage() == pkg) {
                svc.click(target)
                step(a, "recipe", "Tapped \"${target.label()}\"")
                sleep(a, 2_000)
                return true
            }
            checkSignIn(app, nodes)
            svc.find(nodes, app.dismiss)?.let {
                step(a, "recipe", "Dismissed popup \"${it.label()}\"")
                svc.click(it)
                sleep(a, 1_200)
                return@let
            }
            if (svc.currentPackage() != pkg) {
                // A system dialog or another app took over; try to get back.
                svc.back()
                sleep(a, 800)
                if (svc.currentPackage() != pkg) svc.launchFresh(pkg)
            }
            sleep(a, 700)
        }
        return false
    }

    private fun checkSignIn(app: AppCatalog.App, nodes: List<AgentAccessibilityService.Node>) {
        if (app.signIn.isEmpty()) return
        val svc = a11y()
        val hit = svc.find(nodes, app.signIn) ?: return
        throw Failure("${app.label} shows a sign-in screen (\"${hit.label()}\") on ${link.deviceName()}: sign in on the phone first")
    }

    private fun checkBlockers(app: AppCatalog.App, nodes: List<AgentAccessibilityService.Node>) {
        for ((text, reason) in app.blockers) {
            if (a11y().find(nodes, listOf(text), contains = true) != null) throw Failure("$reason (${link.deviceName()})")
        }
    }

    // ---------- Capture ----------

    private fun capture(a: Assign, app: AppCatalog.App, pkg: String): Pair<List<String>, String?> {
        val svc = a11y()
        val images = mutableListOf<String>()
        val texts = LinkedHashSet<String>()
        var lastSignature = ""
        val screens = app.screens.coerceIn(1, 10)
        for (i in 0 until screens) {
            check(a)
            val nodes = svc.nodes()
            if (i == 0) {
                checkSignIn(app, nodes)
                checkBlockers(app, nodes)
            }
            val signature = nodes.joinToString("|") { it.label() }
            if (i > 0 && signature == lastSignature) {
                step(a, "screenshot", "Reached the end of the list")
                break
            }
            lastSignature = signature
            val shot = grabChecked(a, app)
            val width = (shot.width * a.config.screenshotScale).roundToInt().coerceAtLeast(160)
            val (jpeg, w, h) = Images.jpeg(shot, width, quality = 70)
            shot.recycle()
            images += jpeg
            nodes.forEach { n -> n.label().trim().takeIf { it.isNotEmpty() }?.let { texts += it } }
            step(a, "screenshot", "Screenshot ${i + 1} of up to $screens (${w}x$h)", 0.55 + 0.4 * (i + 1) / screens)
            if (i < screens - 1) {
                svc.scroll(down = true)
                sleep(a, 1_300)
                if (svc.currentPackage() != pkg) break
            }
        }
        val text = texts.joinToString("\n").take(20_000).ifBlank { null }
        step(a, "extract", "Sending ${images.size} screenshots to the hub", 0.97)
        return images to text
    }

    /** Screenshot that fails the subtask if the app blocks screenshots (secure flag = black image). */
    private fun grabChecked(a: Assign, app: AppCatalog.App): Bitmap {
        repeat(3) { attempt ->
            check(a)
            val bmp = a11y().grab()
            if (!Images.looksBlank(bmp)) return bmp
            bmp.recycle()
            if (attempt < 2) sleep(a, 1_000)
        }
        throw Failure("${app.label} blocks screenshots (screen is black) on ${link.deviceName()}")
    }

    // ---------- Agent proxy fallback ----------

    /** Ask the hub for up to [MAX_PROXY_ACTIONS] actions toward [goal]. Returns when the hub says done. */
    private fun proxy(a: Assign, goal: String, pkg: String, app: AppCatalog.App) {
        val history = mutableListOf<String>()
        for (n in 1..MAX_PROXY_ACTIONS) {
            check(a)
            val svc = a11y()
            val nodes = svc.nodes()
            val shot = grabChecked(a, app)
            val (jpeg, _, _) = Images.jpeg(shot, FRAME_MAX_WIDTH, quality = 60)
            shot.recycle()
            val requestId = "${a.subtaskId}-p${++proxySeq}"
            val box = LinkedBlockingQueue<JSONObject>(4)
            proxyReplies[requestId] = box
            val reply = try {
                link.send(Msg.proxyRequest(requestId, a.subtaskId, goal, jpeg, svc.nodesJson(nodes), history))
                box.poll(PROXY_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            } finally {
                proxyReplies.remove(requestId)
            }
            check(a)
            reply ?: throw Failure("hub agent did not answer within ${PROXY_TIMEOUT_MS / 1000} s")
            val action = ProxyAction.parse(reply)
            history += action.describe()
            step(a, "fallback", "Hub action $n/$MAX_PROXY_ACTIONS: ${action.describe()}", 0.2 + 0.3 * n / MAX_PROXY_ACTIONS)
            when (action) {
                is ProxyAction.Done -> return
                is ProxyAction.Fail -> throw Failure("${app.label}: ${action.reason}")
                is ProxyAction.TapNode -> {
                    val node = nodes.firstOrNull { it.id == action.nodeId }
                        ?: throw Failure("hub chose node ${action.nodeId}, which is not on screen")
                    svc.click(node)
                }
                is ProxyAction.TapXY -> svc.tap(action.x, action.y)
                is ProxyAction.Back -> svc.back()
                is ProxyAction.Scroll -> svc.scroll(action.down)
                is ProxyAction.Wait -> sleep(a, action.ms)
            }
            sleep(a, 1_500)
            if (svc.currentPackage() != pkg) {
                // The hub left the app (e.g. a link opened a browser); bring it back.
                history += "(left ${app.label}, reopened it)"
                svc.launchFresh(pkg)
                sleep(a, 2_500)
            }
        }
        throw Failure("could not reach the deals screen in ${app.label} after $MAX_PROXY_ACTIONS hub actions")
    }

    // ---------- Live frames ----------

    /** Sends ~1 frame per second tagged with the subtask while it runs. */
    private inner class FrameStreamer(private val subtaskId: String) {
        @Volatile
        private var on = true
        private val t = Thread({
            while (on) {
                val started = System.currentTimeMillis()
                try {
                    AgentAccessibilityService.instance?.let { svc ->
                        val bmp = svc.grab()
                        val (jpeg, w, h) = Images.jpeg(bmp, FRAME_MAX_WIDTH, quality = 60)
                        bmp.recycle()
                        if (on) link.send(Msg.frame(subtaskId, jpeg, w, h))
                    }
                } catch (_: InterruptedException) {
                    break
                } catch (e: Exception) {
                    Log.w(TAG, "frame failed: ${e.message}")
                }
                val wait = FRAME_MS - (System.currentTimeMillis() - started)
                try {
                    if (wait > 0) Thread.sleep(wait)
                } catch (_: InterruptedException) {
                    break
                }
            }
        }, "co2lab-frames")

        fun start() = t.start()
        fun stop() {
            on = false
            t.interrupt()
        }
    }
}
