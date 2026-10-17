package ca.co2lab.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import ca.co2lab.agent.protocol.Assign
import ca.co2lab.agent.protocol.Msg
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Foreground service that keeps one outgoing WebSocket to the hub open (reconnect 1→10 s),
 * sends heartbeats with telemetry, and hands subtasks to [SubtaskRunner]. START_STICKY plus the
 * stored pairing lets it come back after the app is swiped away or the phone reboots.
 */
class AgentService : Service(), SubtaskRunner.Link {

    companion object {
        private const val TAG = "Co2labAgent"
        private const val CHANNEL = "agent"
        private const val HEARTBEAT_MS = 2_000L
        private const val RECONNECT_MIN_MS = 1_000L
        private const val RECONNECT_MAX_MS = 10_000L

        fun start(context: Context) {
            context.startForegroundService(Intent(context, AgentService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AgentService::class.java))
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private val store by lazy { Store(this) }
    private lateinit var runner: SubtaskRunner

    @Volatile
    private var socket: WebSocket? = null
    @Volatile
    private var ready = false // hello.ok received on the current socket
    private var stopped = false
    private var backoffMs = RECONNECT_MIN_MS
    private var generation = 0

    /** Results and failures that could not be sent; flushed after the next hello.ok. */
    private val outbox = ConcurrentLinkedQueue<String>()

    // Probe (debug) commands run here so they never block the socket thread.
    private val probeWorker = Executors.newSingleThreadExecutor()
    private var probeStreaming = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        runner = SubtaskRunner(this, this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        if (!store.isPaired) {
            AgentStatus.update { it.copy(connection = "Not paired") }
            stopSelf()
            return START_NOT_STICKY
        }
        stopped = false
        AgentStatus.update { it.copy(authFailed = false) }
        connect()
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        socket?.close(1000, "service stopped")
        socket = null
        ready = false
        AgentStatus.update { it.copy(connection = "Not connected", connected = false) }
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Co2lab agent", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setContentTitle("Co2lab agent is on")
            .setContentText("Connected to your hub and ready for tasks")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    }

    // ---------- Connection ----------

    private fun wsUrl(): String {
        val base = Pairing.normalizeHub(store.hubUrl)
        val ws = if (base.startsWith("https://")) "wss://" + base.removePrefix("https://") else "ws://" + base.removePrefix("http://")
        return "$ws/ws"
    }

    private fun connect() {
        main.removeCallbacks(reconnect)
        if (stopped) return
        val token = store.token
        if (token == null) {
            AgentStatus.update { it.copy(connection = "Not paired (token missing)", connected = false) }
            return
        }
        socket?.cancel()
        ready = false
        val gen = ++generation
        AgentStatus.update { it.copy(connection = "Connecting…", connected = false) }
        socket = client.newWebSocket(Request.Builder().url(wsUrl()).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(Msg.hello(token).toString())
                AgentStatus.update { it.copy(connection = "Signing in…") }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (gen == generation) handle(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (gen != generation) return
                if (code == 4001 || code == 4003) authFailed("hub rejected this device ($code ${reason.take(40)})")
                else retry("closed $code ${reason.take(40)}")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (gen == generation) retry(t.message ?: t.javaClass.simpleName)
            }
        })
    }

    private val reconnect = Runnable { connect() }

    private fun retry(why: String) {
        ready = false
        main.removeCallbacks(heartbeat)
        if (stopped) return
        Log.w(TAG, "connection lost: $why")
        AgentStatus.update { it.copy(connection = "Reconnecting in ${backoffMs / 1000} s (${why.take(60)})", connected = false) }
        main.removeCallbacks(reconnect)
        main.postDelayed(reconnect, backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(RECONNECT_MAX_MS)
    }

    private fun authFailed(why: String) {
        ready = false
        main.removeCallbacks(heartbeat)
        main.removeCallbacks(reconnect)
        socket?.cancel()
        socket = null
        Log.w(TAG, "auth failed: $why")
        AgentStatus.update { it.copy(connection = "Rejected by hub. Pair again.", connected = false, authFailed = true, lastMessage = why) }
    }

    override fun send(msg: JSONObject) {
        if (ready) socket?.send(msg.toString())
    }

    override fun sendReliable(msg: JSONObject) {
        val text = msg.toString()
        val s = socket
        if (!ready || s == null || !s.send(text)) outbox.add(text)
    }

    override fun deviceName(): String = AgentStatus.state.hubName ?: store.deviceName

    private val heartbeat = object : Runnable {
        override fun run() {
            send(Msg.heartbeat(telemetry(), runner.owned()))
            main.postDelayed(this, HEARTBEAT_MS)
        }
    }

    private fun telemetry(): JSONObject {
        val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1) ?: -1
        val temp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        return Msg.telemetry(
            batteryPct = if (level >= 0 && scale > 0) level * 100.0 / scale else null,
            charging = if (plugged >= 0) plugged != 0 else null,
            tempC = if (temp != Int.MIN_VALUE) temp / 10.0 else null,
        )
    }

    // ---------- Messages ----------

    private fun handle(text: String) {
        val msg = try { JSONObject(text) } catch (e: Exception) { return }
        when (msg.optString("type")) {
            "hello.ok" -> {
                ready = true
                backoffMs = RECONNECT_MIN_MS
                val name = msg.optString("name").ifBlank { store.deviceName }
                msg.optString("deviceId").takeIf { it.isNotBlank() }?.let { store.deviceId = it }
                AgentStatus.update { it.copy(connection = "Connected as $name", connected = true, hubName = name, authFailed = false) }
                while (true) socket?.send(outbox.poll() ?: break)
                main.removeCallbacks(heartbeat)
                main.post(heartbeat)
            }
            "subtask.assign" -> {
                val a = try { Assign.parse(msg) } catch (e: Exception) { return }
                AgentStatus.update { it.copy(lastMessage = "Assigned ${a.capability}") }
                runner.assign(a)
            }
            "subtask.cancel" -> {
                val id = msg.optString("subtaskId")
                outbox.removeAll { it.contains("\"subtaskId\":\"$id\"") }
                runner.cancel(id)
            }
            "proxy.action" -> runner.onProxyAction(msg.optString("requestId"), msg.optJSONObject("action") ?: JSONObject())
            "error" -> {
                val code = msg.optString("code")
                if (code in setOf("unauthorized", "revoked", "bad_token", "invalid_token")) authFailed("hub: ${msg.optString("message")}")
                else AgentStatus.update { it.copy(lastMessage = "Hub error: ${msg.optString("message")}") }
            }
            "probe.cmd" -> if (store.probeEnabled) probeWorker.execute {
                probe(msg.optString("id"), msg.optString("cmd"), msg.optJSONObject("args") ?: JSONObject())
            }
        }
    }

    // ---------- Debug probe (tools/probe). Only when enabled on the setup screen. ----------

    private fun reply(id: String, ok: Boolean, data: Any? = null, error: String? = null) {
        socket?.send(JSONObject().put("type", "probe.reply").put("id", id).put("ok", ok)
            .put("data", data ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL).toString())
    }

    private fun probe(id: String, cmd: String, args: JSONObject) {
        val a11y = AgentAccessibilityService.instance
        val catalog = AppCatalog(this)
        try {
            when (cmd) {
                "ping" -> reply(id, true, JSONObject().put("accessibility", a11y != null).put("telemetry", telemetry()))
                "apps" -> reply(id, true, JSONObject()
                    .put("installed", JSONObject(catalog.installed()))
                    .put("capabilities", JSONArray(catalog.capabilities()))
                    .put("launchables", JSONArray(catalog.launchables().filter { l ->
                        val f = args.optString("filter", "")
                        f.isBlank() || l.label.contains(f, true) || l.packageName.contains(f, true)
                    }.map { JSONObject().put("package", it.packageName).put("label", it.label) })))
                "recipes" -> {
                    store.recipeOverride = args.optJSONObject("apps")?.let { JSONObject().put("apps", it).toString() }
                    reply(id, true, JSONObject().put("apps", JSONArray(AppCatalog(this).apps.keys)))
                }
                else -> {
                    a11y ?: return reply(id, false, error = "accessibility service is off")
                    when (cmd) {
                        "launch" -> reply(id, a11y.launch(args.optString("package")), error = "not installed")
                        "screenshot" -> {
                            val bmp = a11y.grab()
                            val blank = Images.looksBlank(bmp)
                            val (jpeg, w, h) = Images.jpeg(bmp, args.optInt("maxWidth", 1080), 80)
                            bmp.recycle()
                            reply(id, true, JSONObject().put("jpegBase64", jpeg).put("width", w).put("height", h)
                                .put("looksBlank", blank).put("package", a11y.currentPackage() ?: JSONObject.NULL))
                        }
                        "nodes" -> reply(id, true, JSONObject().put("package", a11y.currentPackage() ?: JSONObject.NULL)
                            .put("nodes", a11y.nodesJson(a11y.nodes())))
                        "clickText" -> {
                            val n = a11y.find(a11y.nodes(), listOf(args.optString("text")), args.optBoolean("contains", true))
                            reply(id, n != null && a11y.click(n), error = "no node with that text")
                        }
                        "tap" -> reply(id, a11y.tap(args.optDouble("x").toFloat(), args.optDouble("y").toFloat()))
                        "scroll" -> reply(id, a11y.scroll(args.optString("direction", "down") == "down"))
                        "back" -> reply(id, a11y.back())
                        "home" -> reply(id, a11y.home())
                        "stream" -> {
                            probeStreaming = args.optBoolean("on", true)
                            if (probeStreaming) probeWorker.execute(probeFrames)
                            reply(id, true)
                        }
                        else -> reply(id, false, error = "unknown command $cmd")
                    }
                }
            }
        } catch (e: Exception) {
            reply(id, false, error = e.message ?: e.javaClass.simpleName)
        }
    }

    private val probeFrames: Runnable = object : Runnable {
        override fun run() {
            val svc = AgentAccessibilityService.instance ?: return
            if (!probeStreaming || !store.probeEnabled) return
            try {
                val bmp = svc.grab()
                val (jpeg, w, h) = Images.jpeg(bmp, 720)
                bmp.recycle()
                send(Msg.frame(null, jpeg, w, h))
            } catch (_: Exception) {
            }
            main.postDelayed({ probeWorker.execute(this) }, 1_000)
        }
    }
}
