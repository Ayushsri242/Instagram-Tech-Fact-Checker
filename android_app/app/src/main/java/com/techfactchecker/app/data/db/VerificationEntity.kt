package com.techfactchecker.app.data.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "verifications",
    foreignKeys = [
        ForeignKey(
            entity = ReelEntity::class,
            parentColumns = ["id"],
            childColumns = ["reelId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["reelId"], unique = true)]
)
data class VerificationEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val reelId: String,
    val techName: String,
    val claimedFeaturesJson: String,
    val verdict: String,
    val githubUrl: String?,
    val pricingModel: String,
    val summaryMarkdown: String,
    val evidenceSourcesJson: String
)
