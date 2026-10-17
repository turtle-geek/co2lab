package ca.co2lab.agent

import ca.co2lab.agent.protocol.Msg
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** POST /api/pair with the one-time code (SPEC §4.1). Blocking: call off the main thread. */
object Pairing {

    data class Paired(val deviceId: String, val token: String)

    class PairError(message: String) : Exception(message)

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    /** Accepts "host", "https://host", "https://host/" and returns "https://host". */
    fun normalizeHub(input: String): String {
        var url = input.trim().trimEnd('/')
        if (url.endsWith("/ws")) url = url.removeSuffix("/ws")
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
        return url
    }

    fun pair(hubUrl: String, code: String, name: String, capabilities: List<String>): Paired {
        val body = Msg.pairRequest(code, name, capabilities).toString()
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder().url("${normalizeHub(hubUrl)}/api/pair").post(body).build()
        val response = try {
            client.newCall(request).execute()
        } catch (e: Exception) {
            throw PairError("Could not reach the hub: ${e.message ?: e.javaClass.simpleName}")
        }
        response.use { r ->
            val text = r.body?.string().orEmpty()
            val json = try { JSONObject(text) } catch (_: Exception) { null }
            if (!r.isSuccessful) {
                val reason = json?.optString("error").orEmpty()
                throw PairError(
                    when (reason) {
                        "code_expired" -> "This code has expired. Make a new one on the dashboard."
                        "code_invalid" -> "Wrong code. Check the 6 digits and try again."
                        "too_many_attempts" -> "Too many wrong tries. Make a new code on the dashboard."
                        "" -> "Hub said ${r.code}"
                        else -> "Hub said: $reason"
                    }
                )
            }
            val deviceId = json?.optString("deviceId").orEmpty()
            val token = json?.optString("token").orEmpty()
            if (deviceId.isBlank() || token.isBlank()) throw PairError("Hub sent an unexpected reply")
            return Paired(deviceId, token)
        }
    }
}
