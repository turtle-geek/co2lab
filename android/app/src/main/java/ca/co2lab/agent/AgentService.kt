package ca.co2lab.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
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
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Foreground service that keeps one outgoing WebSocket to the hub open, sends heartbeats with
 * battery telemetry, streams screen frames, and runs commands with [AgentAccessibilityService].
 *
 * Probe build: besides the real `hello`/`heartbeat`/`frame` messages, it answers `probe.cmd`
 * messages from tools/probe so we can check each capability on the phone. T3 replaces
 * `probe.cmd` with `subtask.assign` recipes.
 */
class AgentService : Service() {

    companion object {
        const val EXTRA_HUB_URL = "hubUrl"
        const val EXTRA_TOKEN = "token"
        private const val TAG = "Co2labAgent"
        private const val CHANNEL = "agent"
        private const val HEARTBEAT_MS = 2_000L
        private const val FRAME_MS = 1_000L
        private const val FRAME_MAX_WIDTH = 720

        fun start(context: Context, hubUrl: String, token: String) {
            val intent = Intent(context, AgentService::class.java)
                .putExtra(EXTRA_HUB_URL, hubUrl)
                .putExtra(EXTRA_TOKEN, token)
            context.startForegroundService(intent)
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

    private var socket: WebSocket? = null
    private var hubUrl = ""
    private var token = ""
    private var stopped = false
    private var backoffMs = 1_000L
    private var streaming = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        hubUrl = intent?.getStringExtra(EXTRA_HUB_URL) ?: hubUrl
        token = intent?.getStringExtra(EXTRA_TOKEN) ?: token
        stopped = false
        connect()
        return START_STICKY
    }

    override fun onDestroy() {
        stopped = true
        main.removeCallbacksAndMessages(null)
        socket?.close(1000, "service stopped")
        AgentStatus.update { it.copy(connection = "Not connected") }
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Co2lab agent", NotificationManager.IMPORTANCE_LOW))
        val notification = Notification.Builder(this, CHANNEL)
            .setContentTitle("Co2lab agent is on")
            .setContentText("Connected to your hub and ready for tasks")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
        startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    }

    // ---------- Connection ----------

    private fun wsUrl(): String {
        val base = hubUrl.trim().trimEnd('/')
        val ws = when {
            base.startsWith("https://") -> "wss://" + base.removePrefix("https://")
            base.startsWith("http://") -> "ws://" + base.removePrefix("http://")
            else -> base
        }
        return if (ws.endsWith("/ws")) ws else "$ws/ws"
    }

    private fun connect() {
        if (stopped || hubUrl.isBlank()) return
        socket?.cancel()
        AgentStatus.update { it.copy(connection = "Connecting…") }
        val request = Request.Builder().url(wsUrl()).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                backoffMs = 1_000L
                send(JSONObject().put("type", "hello").put("role", "device").put("token", token))
                AgentStatus.update { it.copy(connection = "Connected") }
                main.post(heartbeat)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                main.post { handle(text) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retry("closed: $reason")

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                retry(t.message ?: t.javaClass.simpleName)
        })
    }

    private fun retry(why: String) {
        main.removeCallbacks(heartbeat)
        streaming = false
        if (stopped) return
        Log.w(TAG, "connection lost: $why")
        AgentStatus.update { it.copy(connection = "Reconnecting (${why.take(60)})") }
        main.postDelayed({ connect() }, backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(10_000L)
    }

    private fun send(json: JSONObject) {
        socket?.send(json.toString())
    }

    private val heartbeat = object : Runnable {
        override fun run() {
            send(JSONObject().put("type", "heartbeat").put("telemetry", telemetry()).put("runningSubtaskIds", JSONArray()))
            main.postDelayed(this, HEARTBEAT_MS)
        }
    }

    private val frameLoop = object : Runnable {
        override fun run() {
            if (!streaming) return
            val a11y = AgentAccessibilityService.instance
            if (a11y == null) {
                main.postDelayed(this, FRAME_MS)
                return
            }
            a11y.screenshot(FRAME_MAX_WIDTH) { result ->
                result.onSuccess { shot ->
                    send(JSONObject().put("type", "frame").put("subtaskId", JSONObject.NULL)
                        .put("jpegBase64", shot.jpegBase64).put("width", shot.width).put("height", shot.height))
                }
                main.postDelayed(this, FRAME_MS)
            }
        }
    }

    private fun telemetry(): JSONObject {
        val battery = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val plugged = battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
        val temp = battery?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        return JSONObject()
            .put("batteryPct", if (level >= 0 && scale > 0) level * 100.0 / scale else JSONObject.NULL)
            .put("charging", plugged != 0)
            .put("tempC", if (temp != Int.MIN_VALUE) temp / 10.0 else JSONObject.NULL)
            .put("cpuPct", JSONObject.NULL)
    }

    // ---------- Messages ----------

    private fun handle(text: String) {
        val msg = try { JSONObject(text) } catch (e: Exception) { return }
        when (msg.optString("type")) {
            "hello.ok" -> AgentStatus.update { it.copy(connection = "Connected as ${msg.optString("name")}") }
            "error" -> AgentStatus.update { it.copy(lastMessage = "Hub error: ${msg.optString("message")}") }
            "probe.cmd" -> probe(msg.optString("id"), msg.optString("cmd"), msg.optJSONObject("args") ?: JSONObject())
        }
    }

    private fun replyBool(id: String, ok: Boolean, error: String = "failed") =
        if (ok) reply(id, true) else reply(id, false, error = error)

    private fun reply(id: String, ok: Boolean, data: Any? = null, error: String? = null) {
        send(JSONObject().put("type", "probe.reply").put("id", id).put("ok", ok)
            .put("data", data ?: JSONObject.NULL).put("error", error ?: JSONObject.NULL))
    }

    private fun probe(id: String, cmd: String, args: JSONObject) {
        AgentStatus.update { it.copy(lastMessage = "Probe: $cmd") }
        val a11y = AgentAccessibilityService.instance
        if (cmd != "ping" && a11y == null) return reply(id, false, error = "accessibility service is off")
        when (cmd) {
            "ping" -> reply(id, true, JSONObject().put("accessibility", a11y != null).put("telemetry", telemetry()))
            "packages" -> reply(id, true, JSONArray(a11y!!.installedPackages(args.optString("filter", ""))))
            "launch" -> replyBool(id, a11y!!.launch(args.optString("package")), "not installed")
            "screenshot" -> a11y!!.screenshot(args.optInt("maxWidth", 1080), quality = 80) { r ->
                r.onSuccess { s ->
                    reply(id, true, JSONObject().put("jpegBase64", s.jpegBase64).put("width", s.width)
                        .put("height", s.height).put("looksBlank", s.looksBlank).put("package", a11y.currentPackage() ?: JSONObject.NULL))
                }.onFailure { reply(id, false, error = it.message) }
            }
            "nodes" -> reply(id, true, JSONObject().put("package", a11y!!.currentPackage() ?: JSONObject.NULL).put("nodes", a11y.dumpNodes()))
            "clickText" -> replyBool(id, a11y!!.clickText(args.optString("text")), "no node with that text")
            "tap" -> replyBool(id, a11y!!.tap(args.optDouble("x").toFloat(), args.optDouble("y").toFloat()))
            "scroll" -> replyBool(id, a11y!!.scroll(args.optString("direction", "down") == "down"))
            "back" -> replyBool(id, a11y!!.back())
            "home" -> replyBool(id, a11y!!.home())
            "stream" -> {
                streaming = args.optBoolean("on", true)
                if (streaming) main.post(frameLoop)
                reply(id, true)
            }
            else -> reply(id, false, error = "unknown command $cmd")
        }
    }
}
