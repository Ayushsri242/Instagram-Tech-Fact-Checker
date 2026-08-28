package com.techfactchecker.app.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "reels")
data class ReelEntity(
    @PrimaryKey
    val id: String,
    val sourceUrl: String,
    val title: String,
    val author: String,
    val durationSeconds: Double = 0.0,
    val rawTranscript: String,
    val createdAt: Long = System.currentTimeMillis()
)
