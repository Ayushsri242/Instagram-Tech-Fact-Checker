package com.techfactchecker.app.ui.navigation

sealed class Screen(val route: String) {
    data object Home : Screen("home")
    data object Result : Screen("result/{reelId}") {
        fun createRoute(reelId: String) = "result/$reelId"
    }
    data object History : Screen("history")
    data object Chat : Screen("chat/{reelId}") {
        fun createRoute(reelId: String) = "chat/$reelId"
    }
}
