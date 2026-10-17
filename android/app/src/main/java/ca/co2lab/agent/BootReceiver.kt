package ca.co2lab.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Starts the agent after a reboot or an app update, if this phone is paired. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED ->
                if (Store(context).isPaired) AgentService.start(context)
        }
    }
}
