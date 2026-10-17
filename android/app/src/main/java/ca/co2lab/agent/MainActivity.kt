package ca.co2lab.agent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Setup screen: hub URL, connect, and shortcuts to the permissions the agent needs. */
class MainActivity : Activity() {

    private lateinit var status: TextView
    private lateinit var hubInput: EditText
    private val prefs by lazy { getSharedPreferences("co2lab", MODE_PRIVATE) }

    private val listener: (AgentStatus.State) -> Unit = { render(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }

        column.addView(TextView(this).apply { text = "Co2lab agent"; textSize = 26f })
        status = TextView(this).apply { textSize = 16f; setPadding(0, pad, 0, pad) }
        column.addView(status)

        hubInput = EditText(this).apply {
            hint = "Hub URL, e.g. https://xyz.trycloudflare.com"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("hubUrl", ""))
        }
        column.addView(hubInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        column.addView(button("Connect") {
            val url = hubInput.text.toString().trim()
            prefs.edit().putString("hubUrl", url).apply()
            AgentService.start(this, url, prefs.getString("token", "probe") ?: "probe")
        })
        column.addView(button("Disconnect") { AgentService.stop(this) })
        column.addView(button("1. Turn on accessibility for Co2lab") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        column.addView(button("2. Let it run in the background") { askBatteryExemption() })
        column.addView(TextView(this).apply {
            textSize = 13f
            setPadding(0, pad, 0, 0)
            text = "If accessibility says \"Restricted setting\": open Settings → Apps → Co2lab → ⋮ (top right) → Allow restricted settings, then try again."
        })

        setContentView(ScrollView(this).apply { addView(column) })

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        handleDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    override fun onStart() {
        super.onStart()
        AgentStatus.listen(listener)
    }

    override fun onStop() {
        AgentStatus.unlisten(listener)
        super.onStop()
    }

    /** co2lab://pair?hub=<url>&code=<6 digits> from the dashboard QR. Pairing itself lands in T3. */
    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "co2lab") return
        data.getQueryParameter("hub")?.let { hubInput.setText(it) }
    }

    private fun askBatteryExemption() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
    }

    private fun render(s: AgentStatus.State) {
        val pm = getSystemService(PowerManager::class.java)
        status.text = buildString {
            appendLine("Accessibility: ${if (s.accessibility) "ON" else "OFF"}")
            appendLine("Background: ${if (pm.isIgnoringBatteryOptimizations(packageName)) "allowed" else "may be paused"}")
            appendLine("Hub: ${s.connection}")
            if (s.lastMessage.isNotBlank()) append("Last: ${s.lastMessage}")
        }
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }
}
