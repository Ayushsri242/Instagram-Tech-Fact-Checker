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
import android.widget.ImageView
import android.widget.TextView
import androidx.core.app.NotificationCompat

class FloatingBubbleService : Service() {

    private companion object {
        const val FLOW_TAG = AnalysisService.FLOW_TAG
        const val PROGRESS_CHANNEL_ID = AnalysisService.CHANNEL_ID
        const val READY_COLOR = "#00E5FF"
        const val CONFIRM_COLOR = "#FFC107"
        const val CONFIRM_MS = 8000L
    }

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: View
    // The bubble's circle: a dark fill with a ring whose colour is the state.
    private lateinit var bubbleBody: View
    private val bubbleRing = android.graphics.drawable.GradientDrawable()
    private lateinit var closeView: View


    private val commandReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: android.content.Context, intent: android.content.Intent) {
            // Hidden while Assay itself is open: it sat on top of screen titles
            // ("AI oduction Agentic RAG Course", Oct 13 screen recording).
            if (intent.action == "com.techfactchecker.SET_BUBBLE_VISIBLE") {
                if (::floatingView.isInitialized) {
                    floatingView.visibility = if (intent.getBooleanExtra("visible", true)) View.VISIBLE else View.GONE
                }
                return
            }
            if (intent.action == "com.techfactchecker.SET_BUBBLE_COLOR") {
                val color = intent.getStringExtra("color") ?: return
        
                setBubble(color)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()

        val filter = android.content.IntentFilter("com.techfactchecker.SET_BUBBLE_COLOR")
        filter.addAction("com.techfactchecker.SET_BUBBLE_VISIBLE")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(commandReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(commandReceiver, filter)
        }
        
        // Remembered so the bubble comes back after an update or a reboot.
        BubbleState.set(this, true)
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

        // Oct 13: was a 120 px flat cyan circle with white "AI" - poor contrast,
        // too small on dense screens, and "Again?" did not fit. Now a 56 dp
        // circle with the app icon and a coloured ring; no text to overflow.
        // The window is 8 dp larger so the shadow is not clipped.
        val size = dp(56)
        val params = WindowManager.LayoutParams(
            size + dp(8),
            size + dp(8),
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )

        params.gravity = Gravity.TOP or Gravity.START
        params.x = 0
        params.y = 300

        val container = FrameLayout(this)
        bubbleRing.shape = android.graphics.drawable.GradientDrawable.OVAL
        bubbleRing.setColor(Color.parseColor("#0F141C"))
        bubbleRing.setStroke(dp(3), Color.parseColor(READY_COLOR))
        val body = FrameLayout(this).apply {
            background = bubbleRing
            elevation = dp(5).toFloat()
            clipToOutline = true
            layoutParams = FrameLayout.LayoutParams(size, size, Gravity.CENTER)
        }
        val icon = ImageView(this).apply {
            setImageResource(com.techfactchecker.mobile.R.drawable.bubble_icon) // a plain PNG: the mipmap is an adaptive icon on API 26+
            scaleType = ImageView.ScaleType.FIT_CENTER
            setPadding(dp(4), dp(4), dp(4), dp(4))
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        body.addView(icon)
        container.addView(body)
        bubbleBody = body
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
                        // Closed by the user: do not bring it back after a reboot.
                        BubbleState.set(this, false)
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

    // The link waiting for a confirming tap, and until when.
    private var confirmCode: String? = null
    private var confirmUntil = 0L

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    // The ring colour is the bubble's state: cyan ready, orange got the link,
    // yellow waiting for a confirming tap. pulse = a short bounce to draw the eye.
    private fun setBubble(color: String, pulse: Boolean = false) {
        if (!::bubbleBody.isInitialized) return
        bubbleRing.setStroke(dp(3), Color.parseColor(color))
        if (pulse) {
            bubbleBody.animate().cancel()
            bubbleBody.scaleX = 1f
            bubbleBody.scaleY = 1f
            val up = { bubbleBody.animate().scaleX(1.15f).scaleY(1.15f).setDuration(160) }
            up().withEndAction {
                bubbleBody.animate().scaleX(1f).scaleY(1f).setDuration(160).withEndAction {
                    up().withEndAction { bubbleBody.animate().scaleX(1f).scaleY(1f).setDuration(160).start() }.start()
                }.start()
            }.start()
        }
    }

    private fun readClipboard() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val hasClip = clipboard.hasPrimaryClip()
        Log.d("FloatingBubble", "Has clip? $hasClip")
        
        if (hasClip && clipboard.primaryClip?.itemCount!! > 0) {
            val text = clipboard.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
            Log.d("FloatingBubble", "Clipboard read: $text")
            
            if (text.contains("instagram.com")) {
                // An accidental tap while scrolling re-sent the last copied
                // link (Oct 9, friends' testing). A link already sent in the
                // last 24 h needs a second tap within 8 s; the first one only
                // shows a toast over Instagram and turns the ring yellow.
                // (Oct 13: 4 s was too short to read the toast and tap.)
                val code = Regex("(?:reels?|p)/([A-Za-z0-9_-]+)").find(text)?.groupValues?.get(1)
                val now = System.currentTimeMillis()
                if (code != null && SentLinks.recentlySent(this, code, now) && !(confirmCode == code && now < confirmUntil)) {
                    confirmCode = code
                    confirmUntil = now + CONFIRM_MS
                    setBubble(CONFIRM_COLOR, pulse = true)
                    android.widget.Toast.makeText(
                        this,
                        "You already checked this reel. Tap the bubble again to check it once more.",
                        android.widget.Toast.LENGTH_LONG
                    ).show()
                    FlowLog.init(this)
                    FlowLog.i("bubble: tapped on already-sent link $code - waiting for a confirming tap")
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        if (confirmCode == code && System.currentTimeMillis() >= confirmUntil) {
                            confirmCode = null
                            setBubble(READY_COLOR)
                        }
                    }, CONFIRM_MS + 100)
                    return
                }
                confirmCode = null
                if (code != null) SentLinks.mark(this, code, now)
                setBubble("#FF9800", pulse = true)
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
