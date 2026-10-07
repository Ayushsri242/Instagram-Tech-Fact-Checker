package com.techfactchecker.app.domain

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

class FloatingBubbleService : Service() {

    private companion object {
        const val FLOW_TAG = AnalysisService.FLOW_TAG
        const val PROGRESS_CHANNEL_ID = AnalysisService.CHANNEL_ID
    }

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: View
    private lateinit var closeView: View


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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()

        val filter = android.content.IntentFilter("com.techfactchecker.SET_BUBBLE_COLOR")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(commandReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(commandReceiver, filter)
        }
        
        startForegroundService()
        createCloseView()
        createFloatingBubble()
    }

    private fun startForegroundService() {
        val channelId = "floating_bubble_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Doomscroll Mode",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Doomscroll Mode Active")
            .setContentText("Tap the bubble to analyze a copied reel")
            .setSmallIcon(android.R.drawable.ic_menu_search)
            .build()

        startForeground(1, notification)
    }

    private fun createCloseView() {
        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            150, 150, layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        params.y = 150

        val container = FrameLayout(this)
        val text = TextView(this).apply {
            text = "X"
            setTextColor(Color.WHITE)
            textSize = 24f
            gravity = Gravity.CENTER
            
            val shape = android.graphics.drawable.GradientDrawable()
            shape.shape = android.graphics.drawable.GradientDrawable.OVAL
            shape.setColor(Color.parseColor("#FF5252"))
            background = shape
            
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        
        container.addView(text)
        container.visibility = View.GONE
        closeView = container

        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        windowManager.addView(closeView, params)
    }

    private fun createFloatingBubble() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            120,
            120,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )

        params.gravity = Gravity.TOP or Gravity.START
        params.x = 0
        params.y = 300

        val container = FrameLayout(this)
        val text = TextView(this).apply {
            text = "AI"
            setTextColor(Color.WHITE)
            textSize = 16f
            gravity = Gravity.CENTER
            
            val shape = android.graphics.drawable.GradientDrawable()
            shape.shape = android.graphics.drawable.GradientDrawable.OVAL
            shape.setColor(Color.parseColor("#00E5FF")) // Cyan
            background = shape
            
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        
        container.addView(text)
        floatingView = container

        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isClick = false

        floatingView.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    Log.d("FloatingBubble", "Touch DOWN")
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isClick = true
                    closeView.visibility = View.VISIBLE
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()
                    // 150 pixels of wiggle room so normal taps aren't ignored
                    if (Math.abs(dx) > 150 || Math.abs(dy) > 150) {
                        isClick = false
                    }
                    params.x = initialX + dx
                    params.y = initialY + dy
                    windowManager.updateViewLayout(floatingView, params)
                    
                    val screenWidth = resources.displayMetrics.widthPixels
                    val screenHeight = resources.displayMetrics.heightPixels
                    val isNearClose = event.rawY > screenHeight - 400 && event.rawX > screenWidth / 2 - 200 && event.rawX < screenWidth / 2 + 200
                    closeView.alpha = if (isNearClose) 0.5f else 1.0f
                    
                    true
                }
                MotionEvent.ACTION_UP -> {
                    Log.d("FloatingBubble", "Touch UP, isClick=$isClick")
                    closeView.visibility = View.GONE
                    
                    val screenWidth = resources.displayMetrics.widthPixels
                    val screenHeight = resources.displayMetrics.heightPixels
                    val isNearClose = event.rawY > screenHeight - 400 && event.rawX > screenWidth / 2 - 200 && event.rawX < screenWidth / 2 + 200
                    
                    if (isNearClose && !isClick) {
                        stopSelf()
                        return@setOnTouchListener true
                    }
                    
                    if (isClick) {
                        v.performClick()
                        handleBubbleClick()
                    }
                    true
                }
                else -> false
            }
        }

        windowManager.addView(floatingView, params)
    }

    private fun handleBubbleClick() {
        Log.d("FloatingBubble", "Bubble clicked!")
        
        // Android 13+ strictly blocks background clipboard reads.
        // We temporarily request window focus so Android grants us clipboard access.
        val layoutParams = floatingView.layoutParams as WindowManager.LayoutParams
        layoutParams.flags = layoutParams.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        windowManager.updateViewLayout(floatingView, layoutParams)

        floatingView.postDelayed({
            readClipboard()
            // Drop focus immediately so user can keep scrolling
            layoutParams.flags = layoutParams.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            windowManager.updateViewLayout(floatingView, layoutParams)
        }, 150)
    }

    private fun readClipboard() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val hasClip = clipboard.hasPrimaryClip()
        Log.d("FloatingBubble", "Has clip? $hasClip")
        
        if (hasClip && clipboard.primaryClip?.itemCount!! > 0) {
            val text = clipboard.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
            Log.d("FloatingBubble", "Clipboard read: $text")
            
            if (text.contains("instagram.com")) {
                (floatingView as FrameLayout).getChildAt(0).let {
                    (it as TextView).text = "..."
                    val shape = it.background as android.graphics.drawable.GradientDrawable
                    shape.setColor(Color.parseColor("#FF9800"))
                }
                FlowLog.init(this)
                FlowLog.i("bubble: tapped, link " + (Regex("(?:reel|p)/([A-Za-z0-9_-]+)").find(text)?.groupValues?.get(1) ?: text.take(60)) + " handed to JS")
                postReceivedNotification()
                // Saved first, so the link survives JS not listening yet.
                PendingReels.add(this, text)
                checkPickedUp(text)
                val intent = Intent("com.techfactchecker.REEL_COPIED")
                intent.setPackage(packageName)
                intent.putExtra("url", text)
                sendBroadcast(intent)
            } else {
                FlowLog.init(this)
                FlowLog.i("bubble: tapped, but clipboard has no instagram link")
            }
        } else {
            FlowLog.init(this)
            FlowLog.i("bubble: tapped, clipboard empty or unreadable")
        }
    }

    /**
     * Confirms the tap natively, the instant it happens.
     *
     * Everything after the tap - turning the bubble blue, the "analysing"
     * notification, the analysis itself - runs in JavaScript. On the OnePlus test
     * phone the OEM freezer (`OplusHansManager: freeze uid ...`) suspended the
     * app process while Instagram was in front, so JS did not run until the app
     * was reopened: the bubble sat orange and nothing told the user their tap had
     * registered at all. This notification does not depend on JS. When JS does
     * run, AnalysisService posts into the same slot and replaces it.
     */
    /**
     * If JS has not taken the link a few seconds after the tap, the app is not
     * running (first tap after an update, or Android closed it). Say so and
     * offer to open it, instead of an orange bubble that never changes. The
     * link stays saved; the app queues it as soon as it starts.
     */
    private fun checkPickedUp(url: String) {
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (!PendingReels.contains(this, url)) return@postDelayed
            FlowLog.i("bubble: link not picked up after 6s - app not running, asking to open it")
            try {
                val manager = getSystemService(NotificationManager::class.java) ?: return@postDelayed
                val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                }
                val notification = NotificationCompat.Builder(this, PROGRESS_CHANNEL_ID)
                    .setContentTitle("Reel saved - tap to start")
                    .setContentText("Assay is not running. Open it and the reel is checked automatically.")
                    .setSmallIcon(android.R.drawable.ic_menu_search)
                    .setAutoCancel(true)
                if (launch != null) {
                    notification.setContentIntent(
                        android.app.PendingIntent.getActivity(
                            this, 7, launch,
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                        )
                    )
                }
                manager.notify(AnalysisService.NOTIFICATION_ID, notification.build())
            } catch (e: Exception) {
                FlowLog.w("bubble: could not post open-app notification: " + e.message)
            }
        }, 6000)
    }

    private fun postReceivedNotification() {
        try {
            val manager = getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(PROGRESS_CHANNEL_ID, "Analysis progress", NotificationManager.IMPORTANCE_LOW)
                )
            }
            val notification = NotificationCompat.Builder(this, PROGRESS_CHANNEL_ID)
                .setContentTitle("Reel received")
                .setContentText("Starting the fact check...")
                .setSmallIcon(android.R.drawable.ic_menu_search)
                .setProgress(0, 0, true)
                .build()
            manager.notify(AnalysisService.NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            FlowLog.w("bubble: could not post received notification: " + e.message)
        }
    }

    override fun onDestroy() {
        super.onDestroy()

        try {
            unregisterReceiver(commandReceiver)
        } catch (e: Exception) {}
        
        if (::floatingView.isInitialized) {
            windowManager.removeView(floatingView)
        }
        if (::closeView.isInitialized) {
            windowManager.removeView(closeView)
        }
    }
}
