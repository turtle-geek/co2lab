package ca.co2lab.agent

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * The supported apps and their recipes, loaded from assets/apps.json (or an override pushed from
 * tools/probe while tuning). Package names are resolved on the phone: known names first, then any
 * launchable app whose name matches.
 */
class AppCatalog(private val context: Context) {

    data class Step(val goal: String, val tap: List<String>, val contains: Boolean, val timeoutMs: Long, val optional: Boolean)

    data class App(
        val id: String,
        val label: String,
        val packages: List<String>,
        val labelMatch: List<String>,
        val report: Boolean,
        val signIn: List<String>,
        val dismiss: List<String>,
        val steps: List<Step>,
        val screens: Int,
        /** Visible text (contains match) -> failure reason, e.g. a missing permission. */
        val blockers: List<Pair<String, String>>,
    )

    data class Launchable(val packageName: String, val label: String)

    val apps: Map<String, App> = load()

    private fun load(): Map<String, App> {
        val bundled = context.assets.open("apps.json").bufferedReader().use { it.readText() }
        val override = Store(context).recipeOverride
        val root = JSONObject(bundled).getJSONObject("apps")
        if (override != null) {
            // Override entries replace bundled ones app by app.
            try {
                val o = JSONObject(override).let { it.optJSONObject("apps") ?: it }
                o.keys().forEach { root.put(it, o.getJSONObject(it)) }
            } catch (_: Exception) {
            }
        }
        val out = linkedMapOf<String, App>()
        root.keys().forEach { id ->
            val a = root.getJSONObject(id)
            val steps = a.optJSONArray("steps") ?: JSONArray()
            out[id] = App(
                id = id,
                label = a.optString("label", id),
                packages = strings(a.optJSONArray("packages")),
                labelMatch = strings(a.optJSONArray("labelMatch")),
                report = a.optBoolean("report", true),
                signIn = strings(a.optJSONArray("signIn")),
                dismiss = strings(a.optJSONArray("dismiss")),
                steps = (0 until steps.length()).map { i ->
                    val s = steps.getJSONObject(i)
                    Step(
                        goal = s.optString("goal", "Next step"),
                        tap = strings(s.optJSONArray("tap")),
                        contains = s.optBoolean("contains", false),
                        timeoutMs = s.optLong("timeoutMs", 10_000),
                        optional = s.optBoolean("optional", false),
                    )
                },
                screens = a.optJSONObject("deals")?.optInt("screens", 5) ?: 5,
                blockers = a.optJSONArray("blockers")?.let { b ->
                    (0 until b.length()).map { b.getJSONObject(it) }.map { it.optString("text") to it.optString("reason") }
                }.orEmpty().filter { it.first.isNotBlank() },
            )
        }
        return out
    }

    /** All apps with a launcher icon. Needs QUERY_ALL_PACKAGES (declared). */
    fun launchables(): List<Launchable> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(intent, 0)
            .map { Launchable(it.activityInfo.packageName, it.loadLabel(pm).toString()) }
            .distinctBy { it.packageName }
            .sortedBy { it.label.lowercase() }
    }

    /** Installed package for [appId], or null if the app is not on this phone. */
    fun resolve(appId: String, cache: List<Launchable>? = null): String? {
        val app = apps[appId] ?: return null
        val pm = context.packageManager
        app.packages.firstOrNull { installed(pm, it) }?.let { return it }
        if (app.labelMatch.isEmpty()) return null
        val all = cache ?: launchables()
        return all.firstOrNull { l ->
            app.labelMatch.any { m -> l.label.contains(m, ignoreCase = true) || l.packageName.contains(m.replace(" ", ""), ignoreCase = true) }
        }?.packageName
    }

    /** appId -> package for every supported app installed here. */
    fun installed(): Map<String, String> {
        val cache = launchables()
        return apps.keys.mapNotNull { id -> resolve(id, cache)?.let { id to it } }.toMap()
    }

    /** Capabilities to report when pairing: `app:<id>` for each installed, reportable app. */
    fun capabilities(): List<String> {
        val inst = installed()
        return apps.values.filter { it.report && inst.containsKey(it.id) }.map { "app:${it.id}" }
    }

    private fun installed(pm: PackageManager, pkg: String) = try {
        pm.getPackageInfo(pkg, 0); true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    private fun strings(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }
}
