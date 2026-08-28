package com.techfactchecker.app

import android.app.Application
import com.techfactchecker.app.data.db.AppDatabase

class TechFactCheckerApp : Application() {
    val database: AppDatabase by lazy { AppDatabase.getDatabase(this) }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: TechFactCheckerApp
            private set
    }
}
