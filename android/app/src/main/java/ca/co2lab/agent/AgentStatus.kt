package ca.co2lab.agent

import android.os.Handler
import android.os.Looper

/** Small observable status shared by the services and the screen. */
object AgentStatus {
    data class State(
        val accessibility: Boolean = false,
        val connection: String = "Not connected",
        val connected: Boolean = false,
        /** Name the hub knows this device by (from hello.ok). */
        val hubName: String? = null,
        /** True when the hub rejected our token; the user must pair again. */
        val authFailed: Boolean = false,
        val task: String? = null,
        val lastMessage: String = "",
    )

    @Volatile
    var state = State()
        private set

    private val listeners = mutableSetOf<(State) -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    @Synchronized
    fun update(change: (State) -> State) {
        state = change(state)
        val snapshot = state
        val targets = listeners.toList()
        main.post { targets.forEach { it(snapshot) } }
    }

    @Synchronized
    fun listen(listener: (State) -> Unit) {
        listeners += listener
        listener(state)
    }

    @Synchronized
    fun unlisten(listener: (State) -> Unit) {
        listeners -= listener
    }
}
