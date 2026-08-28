package com.techfactchecker.app.data.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

data class ReelWithVerification(
    @Embedded val reel: ReelEntity,
    @Relation(
        parentColumn = "id",
        entityColumn = "reelId"
    )
    val verification: VerificationEntity?
)

@Dao
interface ReelDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReel(reel: ReelEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertVerification(verification: VerificationEntity)

    @Transaction
    @Query("SELECT * FROM reels ORDER BY createdAt DESC")
    fun getAllReelsWithVerifications(): Flow<List<ReelWithVerification>>

    @Transaction
    @Query("SELECT * FROM reels WHERE id = :reelId LIMIT 1")
    suspend fun getReelWithVerification(reelId: String): ReelWithVerification?

    @Insert
    suspend fun insertChatMessage(message: ChatMessageEntity)

    @Query("SELECT * FROM chat_messages WHERE reelId = :reelId ORDER BY timestamp ASC")
    fun getChatMessages(reelId: String): Flow<List<ChatMessageEntity>>

    @Query("DELETE FROM reels WHERE id = :reelId")
    suspend fun deleteReel(reelId: String)
}
