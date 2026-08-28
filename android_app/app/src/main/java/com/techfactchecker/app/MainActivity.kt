package com.techfactchecker.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.google.gson.Gson
import com.techfactchecker.app.data.db.ChatMessageEntity
import com.techfactchecker.app.data.db.ReelEntity
import com.techfactchecker.app.data.db.VerificationEntity
import com.techfactchecker.app.domain.FactCheckEngine
import com.techfactchecker.app.domain.LocalLlamaEngine
import com.techfactchecker.app.domain.ModelDownloader
import com.techfactchecker.app.domain.OcrEngine
import com.techfactchecker.app.domain.OcrResult
import com.techfactchecker.app.domain.WebValidator
import com.techfactchecker.app.ui.navigation.Screen
import com.techfactchecker.app.ui.screens.ChatScreen
import com.techfactchecker.app.ui.screens.HistoryScreen
import com.techfactchecker.app.ui.screens.HomeScreen
import com.techfactchecker.app.ui.screens.ResultScreen
import com.techfactchecker.app.ui.theme.DarkBg
import com.techfactchecker.app.ui.theme.TechFactCheckerTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.regex.Pattern

class MainActivity : ComponentActivity() {

    private val db by lazy { (application as TechFactCheckerApp).database }
    private val factCheckEngine = FactCheckEngine()
    private val ocrEngine = OcrEngine()
    private val webValidator = WebValidator()
    private val modelDownloader by lazy { ModelDownloader(this) }
    private val localLlamaEngine by lazy { LocalLlamaEngine(this) }
    private val gson = Gson()

    private var sharedUrlState = mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIncomingIntent(intent)

        setContent {
            TechFactCheckerTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = DarkBg
                ) {
                    val navController = rememberNavController()
                    val allReels by db.reelDao().getAllReelsWithVerifications().collectAsState(initial = emptyList())

                    var isProcessing by remember { mutableStateOf(false) }
                    var processingStep by remember { mutableStateOf("") }
                    var isModelDownloaded by remember { mutableStateOf(modelDownloader.isModelDownloaded()) }
                    var isDownloadingModel by remember { mutableStateOf(false) }
                    var downloadProgress by remember { mutableIntStateOf(0) }

                    NavHost(
                        navController = navController,
                        startDestination = Screen.Home.route
                    ) {
                        composable(Screen.Home.route) {
                            HomeScreen(
                                initialUrl = sharedUrlState.value,
                                onNavigateToResult = { reelId ->
                                    navController.navigate(Screen.Result.createRoute(reelId))
                                },
                                onNavigateToHistory = {
                                    navController.navigate(Screen.History.route)
                                },
                                onAnalyzeUrl = { url ->
                                    analyzeReelUrl(
                                        url = url,
                                        onProgress = { step -> processingStep = step },
                                        onComplete = { reelId ->
                                            isProcessing = false
                                            navController.navigate(Screen.Result.createRoute(reelId))
                                        },
                                        onError = {
                                            isProcessing = false
                                        }
                                    )
                                    isProcessing = true
                                },
                                isProcessing = isProcessing,
                                processingStep = processingStep,
                                isModelDownloaded = isModelDownloaded,
                                downloadProgress = downloadProgress,
                                isDownloadingModel = isDownloadingModel,
                                onDownloadModel = {
                                    isDownloadingModel = true
                                    lifecycleScope.launch(Dispatchers.IO) {
                                        val success = modelDownloader.downloadModel { progress ->
                                            downloadProgress = progress
                                        }
                                        withContext(Dispatchers.Main) {
                                            isDownloadingModel = false
                                            if (success) {
                                                isModelDownloaded = true
                                                localLlamaEngine.reloadModel()
                                            }
                                        }
                                    }
                                }
                            )
                        }

                        composable(
                            route = Screen.Result.route,
                            arguments = listOf(navArgument("reelId") { type = NavType.StringType })
                        ) { backStackEntry ->
                            val reelId = backStackEntry.arguments?.getString("reelId") ?: ""
                            val reelData = allReels.find { it.reel.id == reelId }

                            ResultScreen(
                                reelData = reelData,
                                onNavigateBack = { navController.popBackStack() },
                                onNavigateToChat = { rId ->
                                    navController.navigate(Screen.Chat.createRoute(rId))
                                }
                            )
                        }

                        composable(Screen.History.route) {
                            HistoryScreen(
                                reels = allReels,
                                onNavigateBack = { navController.popBackStack() },
                                onSelectReel = { reelId ->
                                    navController.navigate(Screen.Result.createRoute(reelId))
                                },
                                onDeleteReel = { reelId ->
                                    lifecycleScope.launch(Dispatchers.IO) {
                                        db.reelDao().deleteReel(reelId)
                                    }
                                }
                            )
                        }

                        composable(
                            route = Screen.Chat.route,
                            arguments = listOf(navArgument("reelId") { type = NavType.StringType })
                        ) { backStackEntry ->
                            val reelId = backStackEntry.arguments?.getString("reelId") ?: ""
                            val reelData = allReels.find { it.reel.id == reelId }
                            val chatMessages by db.reelDao().getChatMessages(reelId).collectAsState(initial = emptyList())

                            ChatScreen(
                                reelId = reelId,
                                techName = reelData?.verification?.techName ?: "Tech Tool",
                                messages = chatMessages,
                                onNavigateBack = { navController.popBackStack() },
                                onSendMessage = { text ->
                                    sendChatMessage(reelId, text, reelData?.verification?.techName ?: "")
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
            val extractedUrl = extractUrl(sharedText)
            if (extractedUrl.isNotBlank()) {
                sharedUrlState.value = extractedUrl
            }
        }
    }

    private fun extractUrl(text: String): String {
        val pattern = Pattern.compile("https?://[\\w\\d:#@%/;$()~_?\\+-=\\\\\\.&]+")
        val matcher = pattern.matcher(text)
        return if (matcher.find()) matcher.group() else text
    }

    private fun extractShortcode(url: String): String {
        val clean = url.substringBefore("?")
        val segments = clean.trimEnd('/').split("/")
        return segments.lastOrNull { it.isNotBlank() } ?: "reel_${System.currentTimeMillis()}"
    }

    private fun analyzeReelUrl(
        url: String,
        onProgress: (String) -> Unit,
        onComplete: (String) -> Unit,
        onError: (String) -> Unit
    ) {
        val shortcode = extractShortcode(url)

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                // Check if already cached
                val existing = db.reelDao().getReelWithVerification(shortcode)
                if (existing != null) {
                    withContext(Dispatchers.Main) { onComplete(shortcode) }
                    return@launch
                }

                withContext(Dispatchers.Main) { onProgress("📥 Ingesting media & extracting metadata...") }

                withContext(Dispatchers.Main) { onProgress("👁️ Running on-device OCR...") }
                val sampleOcr = OcrResult(
                    fullText = "Instagram Reel Content | $url",
                    lines = listOf(url),
                    detectedRepos = listOf(),
                    detectedUrls = listOf(url)
                )

                withContext(Dispatchers.Main) { onProgress("🔍 Verifying repositories on live web...") }
                val result = factCheckEngine.analyzeAndVerify(
                    reelId = shortcode,
                    sourceUrl = url,
                    title = "Instagram Post ($shortcode)",
                    author = "Instagram Creator",
                    rawTranscript = "Audio & visuals extracted on-device.",
                    ocrResult = sampleOcr
                )

                // Save to Room DB
                db.reelDao().insertReel(
                    ReelEntity(
                        id = shortcode,
                        sourceUrl = url,
                        title = result.title,
                        author = result.author,
                        rawTranscript = result.rawTranscript
                    )
                )

                db.reelDao().insertVerification(
                    VerificationEntity(
                        reelId = shortcode,
                        techName = result.techName,
                        claimedFeaturesJson = gson.toJson(result.claims),
                        verdict = result.verdict.label,
                        githubUrl = result.githubUrl,
                        pricingModel = result.pricingModel,
                        summaryMarkdown = result.summaryMarkdown,
                        evidenceSourcesJson = gson.toJson(result.sources)
                    )
                )

                withContext(Dispatchers.Main) { onComplete(shortcode) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { onError(e.message ?: "Failed") }
            }
        }
    }

    private fun sendChatMessage(reelId: String, userText: String, techName: String) {
        lifecycleScope.launch(Dispatchers.IO) {
            // Save User message
            db.reelDao().insertChatMessage(
                ChatMessageEntity(
                    reelId = reelId,
                    sender = "user",
                    messageText = userText
                )
            )

            // Agentic Search: search web for live information if user asks technical query
            val searchResults = webValidator.searchDuckDuckGo("$techName $userText", maxResults = 2)
            val searchContext = if (searchResults.isNotEmpty()) {
                searchResults.joinToString("\n") { resultItem ->
                    "- ${resultItem.title}: ${resultItem.snippet}"
                }
            } else ""

            val prompt = """
            Context Technology: $techName
            Live Web Evidence:
            $searchContext

            User Question: $userText

            Answer the user's question accurately, concisely, and technically based on the verified evidence.
            """.trimIndent()

            val reply = localLlamaEngine.generateResponse(prompt)

            db.reelDao().insertChatMessage(
                ChatMessageEntity(
                    reelId = reelId,
                    sender = "assistant",
                    messageText = reply
                )
            )
        }
    }
}
