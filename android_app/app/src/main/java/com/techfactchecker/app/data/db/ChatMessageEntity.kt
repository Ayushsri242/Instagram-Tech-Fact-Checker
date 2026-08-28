package com.techfactchecker.app.data.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "chat_messages",
    foreignKeys = [
        ForeignKey(
            entity = ReelEntity::class,
            parentColumns = ["id"],
            childColumns = ["reelId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["reelId"])]
)
data class ChatMessageEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val reelId: String,
    val sender: String, // "user" or "assistant"
    val messageText: String,
    val timestamp: Long = System.currentTimeMillis()
)
