package ca.co2lab.agent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlin.concurrent.thread

/** Setup screen: pairing, live status, and the checklist the phone needs to run all day. */
class MainActivity : Activity() {

    private val store by lazy { Store(this) }
    private lateinit var status: TextView
    private lateinit var statusPill: TextView
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
        window.statusBarColor = Ui.PAGE
        window.navigationBarColor = Ui.PAGE
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad * 2)
        }
        // ----- Brand header (same look as the dashboard) -----
        column.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(this@MainActivity).apply {
                text = "●"
                textSize = 26f
                setTextColor(Ui.GREEN)
                setPadding(0, 0, pad / 2, 0)
            })
            addView(TextView(this@MainActivity).apply {
                text = "CO₂LAB"
                textSize = 26f
                typeface = Ui.bold
                setTextColor(Ui.INK)
                letterSpacing = 0.02f
            })
        })
        column.addView(TextView(this).apply {
            text = "This old phone is part of your agent team: it opens your apps and reports to your hub."
            textSize = 14f
            setTextColor(Ui.MUTED)
            setPadding(0, pad / 4, 0, pad)
        })

        // ----- Live status card -----
        val statusCard = card(column)
        statusPill = TextView(this).apply {
            textSize = 13f
            typeface = Ui.bold
            setPadding(pad * 3 / 4, pad / 4, pad * 3 / 4, pad / 4)
        }
        statusCard.addView(statusPill, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        status = TextView(this).apply {
            textSize = 15f
            setTextColor(Ui.INK)
            setLineSpacing(0f, 1.2f)
            setPadding(0, pad / 2, 0, 0)
            setTextIsSelectable(true)
        }
        statusCard.addView(status)

        // ----- Pairing (not paired yet) -----
        pairBox = section(column, "Pair with your hub")
        pairBox.addView(hint("On the dashboard tap Add device, then tap Scan pairing QR here, or type the hub address and the 6-digit code."))
        hubInput = field("Hub address, e.g. https://co2lab.example.com", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        hubInput.setText(store.hubUrl)
        pairBox.addView(hubInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        codeInput = field("6-digit code", InputType.TYPE_CLASS_NUMBER)
        pairBox.addView(codeInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        nameInput = field("Device name", InputType.TYPE_CLASS_TEXT)
        nameInput.setText(store.deviceName)
        pairBox.addView(nameInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        pairBox.addView(button("Scan pairing QR", primary = true) { scanQr() })
        pairButton = button("Pair with code") { pair() }
        pairBox.addView(pairButton)
        pairMessage = TextView(this).apply { textSize = 14f; setTextColor(Ui.MUTED); setPadding(0, pad / 2, 0, 0) }
        pairBox.addView(pairMessage)

        // ----- Paired -----
        pairedBox = section(column, "Hub")
        pairedLabel = TextView(this).apply { textSize = 15f; setTextColor(Ui.INK); setLineSpacing(0f, 1.2f); setPadding(0, 0, 0, pad / 2) }
        pairedBox.addView(pairedLabel)
        pairedBox.addView(button("Reconnect now", primary = true) { AgentService.start(this) })
        pairedBox.addView(button("Scan a new pairing QR") { scanQr() })
        pairedBox.addView(button("Pair again (forget this hub)") {
            AgentService.stop(this)
            store.unpair()
            AgentStatus.update { it.copy(hubName = null, authFailed = false, connection = "Not paired") }
            refresh()
        })

        // ----- Checklist -----
        val setup = section(column, "Setup checklist")
        checklist = TextView(this).apply { textSize = 15f; setTextColor(Ui.INK); setLineSpacing(0f, 1.35f); setPadding(0, 0, 0, pad / 2) }
        setup.addView(checklist)
        setup.addView(button("Turn on accessibility for Co2lab") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        setup.addView(button("Let CO₂LAB run in the background") { askBatteryExemption() })
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
        setup.addView(hint("If accessibility says \"Restricted setting\": Settings → Apps → CO₂LAB → ⋮ → Allow restricted settings, then try again."))

        // ----- Debug -----
        val debug = section(column, "Debug")
        debug.addView(CheckBox(this).apply {
            text = "Allow probe commands from tools/probe (testing only)"
            isChecked = store.probeEnabled
            setOnCheckedChangeListener { _, on -> store.probeEnabled = on }
        })

        setContentView(ScrollView(this).apply { setBackgroundColor(Ui.PAGE); addView(column) })

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

    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        intent.data = null
        handlePairPayload(data)
    }

    /** Scan the dashboard QR with Google's code scanner (runs in Play services, no camera permission). */
    private fun scanQr() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { code ->
                val raw = code.rawValue.orEmpty()
                val uri = Uri.parse(raw)
                if (uri.scheme == "co2lab" && uri.host == "pair") handlePairPayload(uri)
                else showPair("That QR is not a CO₂LAB pairing code.")
            }
            .addOnFailureListener { showPair("Scanner unavailable: ${it.message}. Type the address and code instead.") }
    }

    /** co2lab://pair?hub=<url>&code=<6 digits> from the dashboard QR: fill in and pair right away. */
    private fun handlePairPayload(data: Uri) {
        if (data.scheme != "co2lab" || data.host != "pair") return
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
        val (pillText, pillBg, pillFg) = when {
            !paired -> Triple("Not paired", Ui.GRAY_PILL, Ui.INK)
            s.authFailed -> Triple("Rejected by the hub", Ui.RED_SOFT, Ui.RED)
            s.task != null -> Triple("Working", Ui.AMBER_SOFT, Ui.INK)
            s.connected -> Triple("Connected", Ui.GREEN_PILL, Ui.GREEN_DEEP)
            else -> Triple("Reconnecting…", Ui.AMBER_SOFT, Ui.INK)
        }
        statusPill.text = pillText
        statusPill.setTextColor(pillFg)
        statusPill.background = Ui.rounded(pillBg, 999f * resources.displayMetrics.density)
        status.text = buildString {
            appendLine(if (paired) s.connection else "Pair this phone with your hub below.")
            if (s.authFailed) appendLine("The hub no longer accepts this phone. Tap Pair again.")
            appendLine("Accessibility: ${if (s.accessibility) "on" else "off"}")
            appendLine("Task: ${s.task ?: "waiting for work"}")
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

    private fun mark(ok: Boolean) = if (ok) "✓" else "○"

    // ---------- Dashboard-style building blocks (colors match dashboard/src/styles.css) ----------

    private val dp get() = resources.displayMetrics.density

    /** A cream rounded card, like the dashboard panels. */
    private fun card(parent: LinearLayout): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            background = Ui.rounded(Ui.CARD, 20 * dp, stroke = Ui.CARD_EDGE, strokeWidth = (1 * dp).toInt())
            elevation = 2 * dp
        }
        parent.addView(box, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { setMargins(0, 0, 0, pad * 3 / 4) })
        return box
    }

    private fun section(parent: LinearLayout, title: String): LinearLayout {
        val box = card(parent)
        box.addView(TextView(this).apply {
            text = title
            textSize = 18f
            typeface = Ui.bold
            setTextColor(Ui.INK)
            setPadding(0, 0, 0, pad / 2)
        })
        return box
    }

    private fun hint(text: String) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(Ui.MUTED)
        setPadding(0, pad / 2, 0, pad / 2)
    }

    private fun field(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        inputType = type
        setTextColor(Ui.INK)
        setHintTextColor(Ui.MUTED)
        background = Ui.rounded(0xFFFFFFFF.toInt(), 12 * dp, stroke = Ui.LINE, strokeWidth = (1 * dp).toInt())
        setPadding(pad * 3 / 4, pad * 3 / 4, pad * 3 / 4, pad * 3 / 4)
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { setMargins(0, pad / 4, 0, pad / 4) }
    }

    private fun button(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        typeface = Ui.bold
        stateListAnimator = null
        setTextColor(if (primary) 0xFFFFFFFF.toInt() else Ui.INK)
        background = Ui.rounded(if (primary) Ui.GREEN else Ui.GREEN_SOFT, 999 * dp)
        setPadding(pad, pad * 3 / 4, pad, pad * 3 / 4)
        layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { setMargins(0, pad / 4, 0, pad / 4) }
        setOnClickListener { onClick() }
    }
}

/** Dashboard design tokens (dashboard/src/styles.css :root). */
private object Ui {
    const val PAGE = 0xFFDFE6EC.toInt()
    const val CARD = 0xFFF8F2E6.toInt()
    const val CARD_EDGE = 0xFFECE3D2.toInt()
    const val INK = 0xFF26301F.toInt()
    const val MUTED = 0xFF8B918A.toInt()
    const val LINE = 0xFFE2D9C7.toInt()
    const val GREEN = 0xFF5C9F4C.toInt()
    const val GREEN_DEEP = 0xFF3F7A33.toInt()
    const val GREEN_SOFT = 0xFFDDE9CF.toInt()
    const val GREEN_PILL = 0xFFCFE6C2.toInt()
    const val AMBER_SOFT = 0xFFF6E3C0.toInt()
    const val RED = 0xFFC8553D.toInt()
    const val RED_SOFT = 0xFFF6D8CF.toInt()
    const val GRAY_PILL = 0xFFE2E2DC.toInt()
    val bold: Typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)

    fun rounded(color: Int, radius: Float, stroke: Int? = null, strokeWidth: Int = 0) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
        if (stroke != null) setStroke(strokeWidth, stroke)
    }
}
