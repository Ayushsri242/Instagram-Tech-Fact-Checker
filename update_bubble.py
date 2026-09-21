import re

with open('mobile_app/android/app/src/main/java/com/techfactchecker/app/domain/FloatingBubbleService.kt', 'r') as f:
    content = f.read()

# Add closeView variable
content = content.replace(
    'private lateinit var floatingView: View',
    'private lateinit var floatingView: View\n    private lateinit var closeView: View'
)

# Add createCloseView call
content = content.replace(
    'createFloatingBubble()',
    'createCloseView()\n        createFloatingBubble()'
)

# Add createCloseView method
create_close_method = """
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
"""

content = content.replace('private fun createFloatingBubble() {', create_close_method + '\n    private fun createFloatingBubble() {')

# Update ACTION_DOWN
content = content.replace(
    'isClick = true\n                    true',
    'isClick = true\n                    closeView.visibility = View.VISIBLE\n                    true'
)

# Update ACTION_MOVE
action_move_old = """                    params.x = initialX + dx
                    params.y = initialY + dy
                    windowManager.updateViewLayout(floatingView, params)
                    true"""
action_move_new = """                    params.x = initialX + dx
                    params.y = initialY + dy
                    windowManager.updateViewLayout(floatingView, params)
                    
                    val screenWidth = resources.displayMetrics.widthPixels
                    val screenHeight = resources.displayMetrics.heightPixels
                    val isNearClose = event.rawY > screenHeight - 400 && event.rawX > screenWidth / 2 - 200 && event.rawX < screenWidth / 2 + 200
                    closeView.alpha = if (isNearClose) 0.5f else 1.0f
                    
                    true"""
content = content.replace(action_move_old, action_move_new)

# Update ACTION_UP
action_up_old = """                MotionEvent.ACTION_UP -> {
                    Log.d("FloatingBubble", "Touch UP, isClick=$isClick")
                    if (isClick) {
                        v.performClick()
                        handleBubbleClick()
                    }
                    true
                }"""
action_up_new = """                MotionEvent.ACTION_UP -> {
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
                }"""
content = content.replace(action_up_old, action_up_new)

# Update onDestroy
content = content.replace(
    'if (::floatingView.isInitialized) {\n            windowManager.removeView(floatingView)\n        }',
    'if (::floatingView.isInitialized) {\n            windowManager.removeView(floatingView)\n        }\n        if (::closeView.isInitialized) {\n            windowManager.removeView(closeView)\n        }'
)

with open('mobile_app/android/app/src/main/java/com/techfactchecker/app/domain/FloatingBubbleService.kt', 'w') as f:
    f.write(content)
