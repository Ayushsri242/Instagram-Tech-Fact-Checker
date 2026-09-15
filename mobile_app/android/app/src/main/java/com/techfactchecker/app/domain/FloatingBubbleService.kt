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

    private lateinit var windowManager: WindowManager
    private lateinit var floatingView: View

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundService()
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
                    true
                }
                MotionEvent.ACTION_UP -> {
                    Log.d("FloatingBubble", "Touch UP, isClick=$isClick")
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
                val intent = Intent("com.techfactchecker.REEL_COPIED")
                intent.putExtra("url", text)
                sendBroadcast(intent)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::floatingView.isInitialized) {
            windowManager.removeView(floatingView)
        }
    }
}
