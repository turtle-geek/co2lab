package ca.co2lab.agent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/** Setup screen: pairing, live status, and the checklist the phone needs to run all day. */
class MainActivity : Activity() {

    private val store by lazy { Store(this) }
    private lateinit var status: TextView
    private lateinit var checklist: TextView
    private lateinit var pairBox: LinearLayout
    private lateinit var pairedBox: LinearLayout
    private lateinit var pairedLabel: TextView
    private lateinit var pairMessage: TextView
    private lateinit var hubInput: EditText
    private lateinit var codeInput: EditText
    private lateinit var nameInput: EditText
    private lateinit var pairButton: Button
    private var pairing = false

    private val listener: (AgentStatus.State) -> Unit = { render(it) }
    private val pad by lazy { (16 * resources.displayMetrics.density).toInt() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad * 2)
        }
        column.addView(TextView(this).apply { text = "Co2lab agent"; textSize = 26f })
        column.addView(TextView(this).apply {
            text = "This phone opens your deal apps and reports the offers to your hub."
            textSize = 14f
        })

        status = TextView(this).apply { textSize = 15f; setPadding(0, pad, 0, pad); setTextIsSelectable(true) }
        column.addView(status)

        // ----- Pairing (not paired yet) -----
        pairBox = section(column, "Pair with your hub")
        pairBox.addView(hint("On the dashboard tap Add device, then scan the QR with the phone camera, or type the hub address and the 6-digit code here."))
        hubInput = field("Hub address, e.g. https://co2lab.example.com", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        hubInput.setText(store.hubUrl)
        pairBox.addView(hubInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        codeInput = field("6-digit code", InputType.TYPE_CLASS_NUMBER)
        pairBox.addView(codeInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        nameInput = field("Device name", InputType.TYPE_CLASS_TEXT)
        nameInput.setText(store.deviceName)
        pairBox.addView(nameInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        pairButton = button("Pair") { pair() }
        pairBox.addView(pairButton)
        pairBox.addView(button("Scan QR with camera") { openCamera() })
        pairMessage = TextView(this).apply { textSize = 14f }
        pairBox.addView(pairMessage)

        // ----- Paired -----
        pairedBox = section(column, "Hub")
        pairedLabel = TextView(this).apply { textSize = 15f }
        pairedBox.addView(pairedLabel)
        pairedBox.addView(button("Reconnect now") { AgentService.start(this) })
        pairedBox.addView(button("Pair again (forget this hub)") {
            AgentService.stop(this)
            store.unpair()
            AgentStatus.update { it.copy(hubName = null, authFailed = false, connection = "Not paired") }
            refresh()
        })

        // ----- Checklist -----
        val setup = section(column, "Setup checklist")
        checklist = TextView(this).apply { textSize = 15f }
        setup.addView(checklist)
        setup.addView(button("Turn on accessibility for Co2lab") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        setup.addView(button("Let Co2lab run in the background") { askBatteryExemption() })
        setup.addView(button("Turn off Power saving") {
            startActivity(Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS))
        })
        setup.addView(button("Open Battery settings (Battery protection)") {
            startActivity(Intent(Intent.ACTION_POWER_USAGE_SUMMARY))
        })
        setup.addView(CheckBox(this).apply {
            text = "Battery protection is on (Settings → Battery → Battery protection)"
            isChecked = store.batteryProtectionConfirmed
            setOnCheckedChangeListener { _, on -> store.batteryProtectionConfirmed = on; refresh() }
        })
        setup.addView(hint("If accessibility says \"Restricted setting\": Settings → Apps → Co2lab → ⋮ → Allow restricted settings, then try again."))

        // ----- Debug -----
        val debug = section(column, "Debug")
        debug.addView(CheckBox(this).apply {
            text = "Allow probe commands from tools/probe (testing only)"
            isChecked = store.probeEnabled
            setOnCheckedChangeListener { _, on -> store.probeEnabled = on }
        })

        setContentView(ScrollView(this).apply { addView(column) })

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        if (store.isPaired) AgentService.start(this)
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

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onStop() {
        AgentStatus.unlisten(listener)
        super.onStop()
    }

    /** co2lab://pair?hub=<url>&code=<6 digits> from the dashboard QR: fill in and pair right away. */
    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "co2lab" || data.host != "pair") return
        intent.data = null
        val hub = data.getQueryParameter("hub").orEmpty()
        val code = data.getQueryParameter("code").orEmpty()
        if (store.isPaired) {
            AgentService.stop(this)
            store.unpair()
        }
        hubInput.setText(hub)
        codeInput.setText(code)
        refresh()
        if (hub.isNotBlank() && code.matches(Regex("\\d{6}"))) pair()
    }

    private fun pair() {
        if (pairing) return
        val hub = hubInput.text.toString().trim()
        val code = codeInput.text.toString().trim()
        val name = nameInput.text.toString().trim().ifBlank { "Galaxy A54" }
        if (hub.isBlank()) return showPair("Enter the hub address.")
        if (!code.matches(Regex("\\d{6}"))) return showPair("The code has 6 digits.")
        pairing = true
        pairButton.isEnabled = false
        showPair("Pairing…")
        thread {
            val result = runCatching {
                val caps = AppCatalog(this).capabilities()
                if (caps.isEmpty()) throw Pairing.PairError("None of the supported apps (Tim Hortons, McDonald's, Popeyes, WhatsApp) is installed.")
                caps to Pairing.pair(hub, code, name, caps)
            }
            runOnUiThread {
                pairing = false
                pairButton.isEnabled = true
                result.onSuccess { (caps, paired) ->
                    store.hubUrl = Pairing.normalizeHub(hub)
                    store.deviceName = name
                    store.deviceId = paired.deviceId
                    store.capabilities = caps
                    store.token = paired.token
                    codeInput.setText("")
                    showPair("Paired.")
                    AgentStatus.update { it.copy(authFailed = false, hubName = name) }
                    AgentService.start(this)
                    refresh()
                }.onFailure { showPair(it.message ?: "Pairing failed") }
            }
        }
    }

    private fun showPair(text: String) {
        pairMessage.text = text
    }

    private fun openCamera() {
        try {
            startActivity(Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))
        } catch (_: Exception) {
            showPair("No camera app found. Type the address and code instead.")
        }
    }

    private fun askBatteryExemption() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            return
        }
        startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
    }

    /** Samsung stores Battery protection in a global setting on some One UI versions. */
    private fun batteryProtectionDetected(): Boolean = listOf("protect_battery", "battery_protection").any { key ->
        try {
            Settings.Global.getInt(contentResolver, key, 0) != 0 || Settings.System.getInt(contentResolver, key, 0) != 0
        } catch (_: Exception) {
            false
        }
    }

    private fun refresh() = render(AgentStatus.state)

    private fun render(s: AgentStatus.State) {
        val paired = store.isPaired
        pairBox.visibility = if (paired) View.GONE else View.VISIBLE
        pairedBox.visibility = if (paired) View.VISIBLE else View.GONE
        pairedLabel.text = buildString {
            appendLine("Paired as: ${s.hubName ?: store.deviceName}")
            appendLine("Hub: ${store.hubUrl}")
            append("Apps reported: ${store.capabilities.joinToString(", ").ifBlank { "none" }}")
        }

        val pm = getSystemService(PowerManager::class.java)
        val bg = pm.isIgnoringBatteryOptimizations(packageName)
        status.text = buildString {
            appendLine("Hub connection: ${if (paired) s.connection else "not paired"}")
            if (s.authFailed) appendLine("⚠ The hub no longer accepts this phone. Tap Pair again.")
            appendLine("Accessibility: ${if (s.accessibility) "ON" else "OFF"}")
            appendLine("Current task: ${s.task ?: "none"}")
            if (s.lastMessage.isNotBlank()) append("Last: ${s.lastMessage}")
        }

        val protection = store.batteryProtectionConfirmed || batteryProtectionDetected()
        checklist.text = buildString {
            appendLine("${mark(s.accessibility)} Accessibility service on")
            appendLine("${mark(bg)} Background running allowed (no battery optimization)")
            appendLine("${mark(!pm.isPowerSaveMode)} Power saving off")
            appendLine("${mark(protection)} Battery protection on (keeps the battery healthy on the charger)")
            append("${mark(paired && s.connected)} Connected to the hub")
        }
    }

    private fun mark(ok: Boolean) = if (ok) "✅" else "⬜"

    private fun section(parent: LinearLayout, title: String): LinearLayout {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, pad, 0, 0) }
        box.addView(TextView(this).apply { text = title; textSize = 19f; setPadding(0, 0, 0, pad / 2) })
        parent.addView(box, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        return box
    }

    private fun hint(text: String) = TextView(this).apply { this.text = text; textSize = 13f; setPadding(0, pad / 2, 0, pad / 2) }

    private fun field(hint: String, type: Int) = EditText(this).apply { this.hint = hint; inputType = type }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }
}
