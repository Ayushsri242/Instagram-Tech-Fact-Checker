import re

with open('mobile_app/android/app/src/main/java/com/techfactchecker/mobile/TechFactCheckerModule.kt', 'r') as f:
    content = f.read()

methods = """
    @ReactMethod
    fun setBubbleColor(colorHex: String, promise: Promise) {
        try {
            val intent = android.content.Intent("com.techfactchecker.SET_BUBBLE_COLOR")
            intent.putExtra("color", colorHex)
            intent.setPackage(reactContext.packageName)
            reactContext.sendBroadcast(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("COLOR_ERROR", e.message)
        }
    }

    @ReactMethod
    fun showNotification(title: String, message: String, promise: Promise) {
        try {
            val channelId = "doomscroll_updates"
            val manager = reactContext.getSystemService(android.app.NotificationManager::class.java)
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val channel = android.app.NotificationChannel(
                    channelId, 
                    "Doomscroll Updates", 
                    android.app.NotificationManager.IMPORTANCE_HIGH
                )
                manager?.createNotificationChannel(channel)
            }
            
            val notification = androidx.core.app.NotificationCompat.Builder(reactContext, channelId)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_menu_search)
                .setAutoCancel(true)
                .build()
                
            manager?.notify(System.currentTimeMillis().toInt(), notification)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("NOTIF_ERROR", e.message)
        }
    }

    @ReactMethod"""

content = content.replace('    @ReactMethod\n    fun generateResponse', methods + '\n    fun generateResponse')

with open('mobile_app/android/app/src/main/java/com/techfactchecker/mobile/TechFactCheckerModule.kt', 'w') as f:
    f.write(content)
