package ca.co2lab.agent.protocol

import org.json.JSONArray
import org.json.JSONObject

/**
 * Kotlin mirror of the device side of shared/src/protocol.ts (see shared/PROTOCOL.md).
 * Plain org.json to avoid extra dependencies. Nullable fields are always written as null.
 */
object Msg {
    private fun obj(type: String) = JSONObject().put("type", type)
    private fun orNull(v: Any?) = v ?: JSONObject.NULL

    fun hello(token: String) = obj("hello").put("role", "device").put("token", token)

    fun heartbeat(telemetry: JSONObject, running: List<String>) =
        obj("heartbeat").put("telemetry", telemetry).put("runningSubtaskIds", JSONArray(running))

    fun telemetry(batteryPct: Double?, charging: Boolean?, tempC: Double?, cpuPct: Double? = null) = JSONObject()
        .put("batteryPct", orNull(batteryPct))
        .put("charging", orNull(charging))
        .put("tempC", orNull(tempC))
        .put("cpuPct", orNull(cpuPct))

    fun frame(subtaskId: String?, jpegBase64: String, width: Int, height: Int) = obj("frame")
        .put("subtaskId", orNull(subtaskId)).put("jpegBase64", jpegBase64).put("width", width).put("height", height)

    /** kind: recipe | fallback | extract | screenshot | info */
    fun step(subtaskId: String, kind: String, text: String, progress: Double? = null) = obj("step")
        .put("subtaskId", subtaskId).put("kind", kind).put("text", text)
        .also { if (progress != null) it.put("progress", progress.coerceIn(0.0, 1.0)) }

    fun result(subtaskId: String, images: List<String>, text: String?) = obj("subtask.result")
        .put("subtaskId", subtaskId)
        .put("evidence", JSONObject().put("images", JSONArray(images)).put("text", orNull(text)))

    fun failed(subtaskId: String, reason: String) = obj("subtask.failed").put("subtaskId", subtaskId).put("reason", reason)

    fun proxyRequest(requestId: String, subtaskId: String, goal: String, screenshot: String, nodes: JSONArray, history: List<String>) =
        obj("proxy.request").put("requestId", requestId).put("subtaskId", subtaskId).put("goal", goal)
            .put("screenshot", screenshot).put("nodes", nodes).put("history", JSONArray(history))

    fun pairRequest(code: String, name: String, capabilities: List<String>) = JSONObject()
        .put("code", code).put("name", name).put("kind", "android").put("capabilities", JSONArray(capabilities))
}

data class AgentConfig(val model: String, val screenshotScale: Double, val mode: String) {
    companion object {
        fun parse(o: JSONObject?) = AgentConfig(
            model = o?.optString("model", "flash") ?: "flash",
            screenshotScale = (o?.optDouble("screenshotScale", 0.5) ?: 0.5).let { if (it.isNaN() || it <= 0) 0.5 else it.coerceAtMost(1.0) },
            mode = o?.optString("mode", "recipe") ?: "recipe",
        )
    }
}

data class Assign(val subtaskId: String, val runId: String, val capability: String, val goal: String, val config: AgentConfig) {
    /** "app:tims" -> "tims"; null for capabilities this device cannot run (e.g. "web"). */
    val appId: String? get() = capability.removePrefix("app:").takeIf { capability.startsWith("app:") }

    companion object {
        fun parse(o: JSONObject) = Assign(
            subtaskId = o.getString("subtaskId"),
            runId = o.optString("runId", ""),
            capability = o.getString("capability"),
            goal = o.optString("goal", ""),
            config = AgentConfig.parse(o.optJSONObject("config")),
        )
    }
}

/** One action from the hub's agent proxy. */
sealed class ProxyAction {
    data class TapNode(val nodeId: String) : ProxyAction()
    data class TapXY(val x: Float, val y: Float) : ProxyAction()
    object Back : ProxyAction()
    data class Scroll(val down: Boolean) : ProxyAction()
    data class Wait(val ms: Long) : ProxyAction()
    object Done : ProxyAction()
    data class Fail(val reason: String) : ProxyAction()

    fun describe(): String = when (this) {
        is TapNode -> "tapNode $nodeId"
        is TapXY -> "tapXY ${x.toInt()},${y.toInt()}"
        Back -> "back"
        is Scroll -> "scroll ${if (down) "down" else "up"}"
        is Wait -> "wait $ms"
        Done -> "done"
        is Fail -> "fail: $reason"
    }

    companion object {
        fun parse(o: JSONObject?): ProxyAction = when (o?.optString("kind")) {
            "tapNode" -> TapNode(o.getString("nodeId"))
            "tapXY" -> TapXY(o.getDouble("x").toFloat(), o.getDouble("y").toFloat())
            "back" -> Back
            "scroll" -> Scroll(o.optString("direction", "down") != "up")
            "wait" -> Wait(o.optLong("ms", 1000).coerceIn(0, 10_000))
            "done" -> Done
            "fail" -> Fail(o.optString("reason", "hub gave up"))
            else -> Fail("unknown proxy action ${o?.optString("kind")}")
        }
    }
}
