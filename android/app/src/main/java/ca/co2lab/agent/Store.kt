package ca.co2lab.agent

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Pairing data. The device token is encrypted with an AES-GCM key that lives in the Android
 * Keystore (never leaves secure hardware), so a copy of the prefs file alone is useless.
 */
class Store(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences("co2lab", Context.MODE_PRIVATE)

    var hubUrl: String
        get() = prefs.getString("hubUrl", "") ?: ""
        set(v) = prefs.edit().putString("hubUrl", v).apply()

    var deviceName: String
        get() = prefs.getString("deviceName", "Galaxy A54") ?: "Galaxy A54"
        set(v) = prefs.edit().putString("deviceName", v).apply()

    var deviceId: String
        get() = prefs.getString("deviceId", "") ?: ""
        set(v) = prefs.edit().putString("deviceId", v).apply()

    var capabilities: List<String>
        get() = (prefs.getString("capabilities", "") ?: "").split(',').filter { it.isNotBlank() }
        set(v) = prefs.edit().putString("capabilities", v.joinToString(",")).apply()

    /** Debug only: let tools/probe send probe.cmd messages. Off by default. */
    var probeEnabled: Boolean
        get() = prefs.getBoolean("probeEnabled", false)
        set(v) = prefs.edit().putBoolean("probeEnabled", v).apply()

    /** Recipe overrides pushed from tools/probe while tuning (JSON, same shape as assets/apps.json). */
    var recipeOverride: String?
        get() = prefs.getString("recipeOverride", null)
        set(v) = prefs.edit().putString("recipeOverride", v).apply()

    /** Battery protection cannot be read reliably on every One UI version, so the user ticks it. */
    var batteryProtectionConfirmed: Boolean
        get() = prefs.getBoolean("batteryProtection", false)
        set(v) = prefs.edit().putBoolean("batteryProtection", v).apply()

    var token: String?
        get() = prefs.getString("tokenEnc", null)?.let { decrypt(it) }
        set(v) {
            if (v == null) prefs.edit().remove("tokenEnc").apply()
            else prefs.edit().putString("tokenEnc", encrypt(v)).apply()
        }

    val isPaired: Boolean get() = hubUrl.isNotBlank() && prefs.contains("tokenEnc")

    fun unpair() {
        prefs.edit().remove("tokenEnc").remove("deviceId").apply()
    }

    // ---------- Keystore ----------

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val body = cipher.doFinal(plain.toByteArray())
        return b64(cipher.iv) + ":" + b64(body)
    }

    private fun decrypt(stored: String): String? = try {
        val (iv, body) = stored.split(':', limit = 2)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, unb64(iv)))
        String(cipher.doFinal(unb64(body)))
    } catch (e: Exception) {
        null
    }

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)

    private companion object {
        const val KEY_ALIAS = "co2lab-device-token"
    }
}
