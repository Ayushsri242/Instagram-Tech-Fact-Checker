package com.techfactchecker.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.techfactchecker.app.ui.theme.AccentCyan
import com.techfactchecker.app.ui.theme.CardBorder
import com.techfactchecker.app.ui.theme.SurfaceDark

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    initialUrl: String = "",
    onNavigateToResult: (String) -> Unit,
    onNavigateToHistory: () -> Unit,
    onAnalyzeUrl: (String) -> Unit,
    isProcessing: Boolean = false,
    processingStep: String = ""
) {
    var urlText by remember { mutableStateOf(initialUrl) }

    LaunchedEffect(initialUrl) {
        if (initialUrl.isNotBlank()) {
            urlText = initialUrl
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Tech Fact Checker",
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            color = Color.White
                        )
                        Text(
                            "100% Free • Local-First Micro-Agent",
                            fontSize = 12.sp,
                            color = AccentCyan
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onNavigateToHistory) {
                        Icon(
                            Icons.Default.History,
                            contentDescription = "Library",
                            tint = Color.White
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SurfaceDark
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Input Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark),
                border = CardDefaults.outlinedCardBorder().copy(brush = androidx.compose.ui.graphics.SolidColor(CardBorder))
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        "Paste Instagram Reel / Carousel Link",
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                        fontSize = 16.sp
                    )

                    OutlinedTextField(
                        value = urlText,
                        onValueChange = { urlText = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("https://www.instagram.com/reel/...", color = Color.Gray) },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedBorderColor = AccentCyan,
                            unfocusedBorderColor = CardBorder
                        )
                    )

                    Button(
                        onClick = {
                            if (urlText.isNotBlank()) {
                                onAnalyzeUrl(urlText.trim())
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        enabled = !isProcessing && urlText.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = AccentCyan)
                    ) {
                        if (isProcessing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = Color.Black,
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Analyzing Reel...", color = Color.Black, fontWeight = FontWeight.Bold)
                        } else {
                            Icon(Icons.Default.Search, contentDescription = null, tint = Color.Black)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Run Fact Check", color = Color.Black, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // Live Progress State
            if (isProcessing) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = SurfaceDark)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            "⚙️ Processing Pipeline",
                            fontWeight = FontWeight.Bold,
                            color = AccentCyan
                        )
                        Text(
                            processingStep.ifBlank { "Extracting visual frames and audio..." },
                            color = Color.LightGray,
                            fontSize = 14.sp
                        )
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            color = AccentCyan,
                            trackColor = CardBorder
                        )
                    }
                }
            }

            // Quick Samples
            Text(
                "💡 Quick Sample Reels",
                fontWeight = FontWeight.SemiBold,
                color = Color.LightGray,
                fontSize = 14.sp
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = {
                        urlText = "https://www.instagram.com/p/DcOJpsKDEht/"
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("5 LLM Libs", fontSize = 12.sp, maxLines = 1)
                }

                OutlinedButton(
                    onClick = {
                        urlText = "https://www.instagram.com/reel/DcXzQH5si-A/"
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("Hindi Reel", fontSize = 12.sp, maxLines = 1)
                }

                OutlinedButton(
                    onClick = {
                        urlText = "https://www.instagram.com/reel/DcYcqi5TePT/"
                    },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("/eli5 Prompt", fontSize = 12.sp, maxLines = 1)
                }
            }

            // Feature Highlights
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceDark)
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("📱 Share Directly From Instagram", fontWeight = FontWeight.Bold, color = Color.White)
                    Text(
                        "1. Watch any Reel on Instagram\n2. Tap Share ➔ Select Tech Fact Checker\n3. Instant on-device verification & code extraction",
                        color = Color.Gray,
                        fontSize = 13.sp,
                        lineHeight = 18.sp
                    )
                }
            }
        }
    }
}
