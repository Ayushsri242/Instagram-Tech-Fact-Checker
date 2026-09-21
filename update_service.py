import re

with open('mobile_app/android/app/src/main/java/com/techfactchecker/app/domain/FloatingBubbleService.kt', 'r') as f:
    content = f.read()

receiver_code = """
    private val commandReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context, intent: android.content.Intent) {
            if (intent.action == "com.techfactchecker.SET_BUBBLE_COLOR") {
                val color = intent.getStringExtra("color") ?: return
                if (::floatingView.isInitialized) {
                    (floatingView as FrameLayout).getChildAt(0).let {
                        (it as TextView).text = "AI"
                        val shape = it.background as android.graphics.drawable.GradientDrawable
                        shape.setColor(Color.parseColor(color))
                    }
                }
            }
        }
    }

    override fun onBind"""

content = content.replace('    override fun onBind', receiver_code)

register_code = """
        val filter = android.content.IntentFilter("com.techfactchecker.SET_BUBBLE_COLOR")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(commandReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(commandReceiver, filter)
        }
        
        startForegroundService"""

content = content.replace('        startForegroundService', register_code)

unregister_code = """
        try {
            unregisterReceiver(commandReceiver)
        } catch (e: Exception) {}
        
        if (::floatingView.isInitialized"""

content = content.replace('        if (::floatingView.isInitialized', unregister_code)

with open('mobile_app/android/app/src/main/java/com/techfactchecker/app/domain/FloatingBubbleService.kt', 'w') as f:
    f.write(content)
