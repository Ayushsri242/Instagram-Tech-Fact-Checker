import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import ReportCard from '../components/ReportCard';
import { chatWithAiApi, analyzeReelApi } from '../services/api';
import { getChatHistory, saveChatMessage, saveReelResult } from '../services/storage';

// Date.now() collides when two messages are created in the same millisecond,
// which is how a report and its follow-up ended up sharing a key.
let idCounter = 0;
const newId = () => `${Date.now()}-${idCounter++}`;

// Old chat histories on device already contain duplicate ids (the welcome
// message was hardcoded to '0'), so de-duplicate on the way in rather than
// asking the user to clear app data.
const dedupeById = (list) => {
  const seen = new Set();
  return list.filter((m) => {
    const id = m && m.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

export default function ChatScreen({ route, navigation }) {
  const { reel, initialUrl } = route.params || {};
  const [currentReel, setCurrentReel] = useState(reel || null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isInitialAnalysis, setIsInitialAnalysis] = useState(false);
  const [progressMsg, setProgressMsg] = useState('Extracting information...');
  const [progressPct, setProgressPct] = useState(0);
  const flatListRef = useRef(null);
  // Analysis takes ~40s. If the user hits Back before it returns, the awaits
  // below still resolve and setState on a screen React has already torn down,
  // which surfaced as "View with tag N is not registered as a root view".
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);
  const analysisStartedRef = useRef(false);

  const reelId = currentReel?.reelId || 'unknown';
  const techName = currentReel?.techName || 'Unknown Tool';

  // Faux progress bar timer
  useEffect(() => {
    let interval;
    if (loading && isInitialAnalysis) {
      setProgressPct(10);
      setProgressMsg('Extracting audio & OCR...');
      const statuses = [
        "Extracting audio & OCR...",
        "Transcribing with local AI...",
        "Searching web for evidence...",
        "Cross-checking claims...",
        "Hang on, this is the last step!"
      ];
      let step = 0;
      interval = setInterval(() => {
        step++;
        if (step < statuses.length) {
          setProgressMsg(statuses[step]);
          setProgressPct(step * 20 + Math.floor(Math.random() * 10));
        } else {
          setProgressPct(99);
        }
      }, 4000);
    }
    return () => clearInterval(interval);
  }, [loading, isInitialAnalysis]);

  const [chatLoadingText, setChatLoadingText] = useState('Thinking...');

  const loadHistoryOrAnalyze = async () => {
    if (initialUrl && !currentReel) {
      // setCurrentReel below re-fires this effect, and a remount would re-fire
      // it again. Without this guard the analysis runs twice: duplicate messages
      // land in storage (the source of the duplicate-key warning) and the reel
      // is paid for twice.
      if (analysisStartedRef.current) return;
      analysisStartedRef.current = true;

      // New Session from URL
      setIsInitialAnalysis(true);

      const welcomeMsg = {
        id: newId(),
        sender: 'assistant',
        // No emoji in this file. A unicode emoji in the same module as a
        // catch block re-triggers a Hermes/Fast Refresh parse bug that
        // surfaces as "ReferenceError: Property 'err' doesn't exist".
        text: `Welcome to Ask AI!\n\nWhen analysis is done, you can ask me any questions about the information in this post.\n\nNote: To check a completely new link, you must go back to the Home page.`
      };
      const initialUserMsg = {
        id: newId(),
        sender: 'user',
        text: `Check this link: ${initialUrl}`,
      };
      
      setMessages([welcomeMsg, initialUserMsg]);
      setLoading(true);

      try {
        const result = await analyzeReelApi(initialUrl);
        await saveReelResult(result);
        if (!aliveRef.current) return;
        setCurrentReel(result);

        // The report arrives as structured fields and is drawn by ReportCard.
        // The ten regexes that used to live here were scrubbing markdown the
        // model should never have been asked to produce.
        const aiMsg = {
          id: newId(),
          sender: 'assistant',
          kind: 'report',
          report: result.report || null,
          techName: result.techName || '',
          // Plain-text fallback for old saved reels and for the chat context.
          text: result.factualReality || result.summaryMarkdown || 'Analyzed successfully.',
        };
        setMessages([welcomeMsg, initialUserMsg, aiMsg]);
        await saveChatMessage(result.reelId, welcomeMsg);
        await saveChatMessage(result.reelId, initialUserMsg);
        await saveChatMessage(result.reelId, aiMsg);
        console.log("[DEBUG_CHAT] AI report:", result.verdict, "| tools:", (result.report && result.report.tools ? result.report.tools.length : 0));
      } catch (err) {
        if (!aliveRef.current) return;
        // Read err OUTSIDE the updater. Hermes fails to capture a catch
        // parameter inside a closure and throws
        // "ReferenceError: Property 'err' doesn't exist" at the point the
        // updater runs - which reads like a scope bug but is a codegen one.
        const failureMsg = {
          id: newId(),
          sender: 'assistant',
          text: `Analysis failed: ${err && err.message ? err.message : String(err)}`,
        };
        setMessages((prev) => [...prev, failureMsg]);
      } finally {
        if (aliveRef.current) {
          setLoading(false);
          setIsInitialAnalysis(false);
        }
      }
    } else if (currentReel) {
      // If this screen just ran the analysis, the messages already on screen are
      // the truth. Re-reading storage here races the saveChatMessage calls above
      // and can come back empty, which would replace the finished report with
      // the generic welcome message.
      if (analysisStartedRef.current) return;

      // If returning to a reel that already has history, just load it
      const history = await getChatHistory(currentReel.reelId);
      if (!aliveRef.current) return;
      if (history.length > 0) {
        setMessages(dedupeById(history));
      } else {
        // Fallback if somehow history is empty but we have a reel
        setMessages([
          {
            id: newId(),
            sender: 'assistant',
            text: `Welcome to Ask AI!\n\nWhen analysis is done, you can ask me any questions about the information in this post.\n\nNote: To check a completely new link, you must go back to the Home page.`,
          }
        ]);
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistoryOrAnalyze();
  }, [currentReel]);

  const handleSend = async () => {
    if (!input.trim() || loading || !currentReel) return;

    const textToSend = input.trim();
    setInput('');
    const userMsg = { id: newId(), sender: 'user', text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setChatLoadingText('Thinking...');
    setLoading(true);

    try {
      const reelId = currentReel.reelId;
      await saveChatMessage(reelId, userMsg);
      
      console.log("[DEBUG_CHAT] User:", textToSend);
      let replyText = await chatWithAiApi(currentReel, textToSend, messages, () => {
        setChatLoadingText('Web search in progress...');
      });
      if (!aliveRef.current) return;
      // Fallback cleaner: strip any rogue stars if Groq disobeys the prompt
      replyText = replyText.replace(/\*\*/g, '').replace(/###?/g, '').trim();

      const aiMsg = {
        id: newId(),
        sender: 'assistant',
        text: replyText,
      };
      setMessages((prev) => [...prev, aiMsg]);
      await saveChatMessage(reelId, aiMsg);
      console.log("[DEBUG_CHAT] AI:", replyText);
    } catch (err) {
      console.error("[ChatScreen] LLM Error:", err);
      if (!aliveRef.current) return;
      const errorMsg = {
        id: newId(),
        sender: 'assistant',
        text: `LLM Error: ${err.message}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{techName !== 'Unknown Tool' ? techName : 'New Session'}</Text>
          <Text style={styles.headerSubtitle}>On-Device Technical Q&A</Text>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item, index) => (item && item.id ? String(item.id) : `row-${index}`)}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            if (item.kind === 'report' && item.report) {
              return <ReportCard report={item.report} techName={item.techName} />;
            }
            const isUser = item.sender === 'user';
            return (
              <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
                <Text style={[styles.messageText, isUser ? styles.userText : styles.aiText]}>{item.text}</Text>
              </View>
            );
          }}
          ListFooterComponent={() => {
            if (!loading) return null;
            if (isInitialAnalysis) {
              return (
                <View style={[styles.messageBubble, styles.aiBubble, { marginTop: 12, paddingVertical: 16 }]}>
                  <Text style={[styles.messageText, styles.aiText, { fontWeight: 'bold' }]}>
                    {progressPct}% - {progressMsg}
                  </Text>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
                  </View>
                </View>
              );
            }
            return (
              <View style={{ padding: 12, alignItems: 'center' }}>
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4 }}>{chatLoadingText}</Text>
              </View>
            );
          }}
        />

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Ask question... (Go to Home for new link)"
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => handleSend()}
            editable={!!currentReel}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || loading || !currentReel) && styles.disabledSend]}
            onPress={() => handleSend()}
            disabled={!input.trim() || loading || !currentReel}
          >
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: colors.background,
  },
  header: { 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    borderBottomWidth: 1, 
    borderBottomColor: colors.cardBorder 
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary },
  headerSubtitle: { fontSize: 11, color: colors.accentCyan },
  messagesList: { padding: 16, gap: 12 },
  messageBubble: { maxWidth: '85%', padding: 12, borderRadius: 14 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accentCyan, borderBottomRightRadius: 2 },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderColor: colors.cardBorder, borderWidth: 1, borderBottomLeftRadius: 2 },
  messageText: { fontSize: 13, lineHeight: 18 },
  userText: { color: '#000', fontWeight: '500' },
  aiText: { color: colors.textPrimary },
  progressBarBg: { height: 6, backgroundColor: colors.background, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: colors.accentCyan },
  inputContainer: { flexDirection: 'row', padding: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.cardBorder, alignItems: 'center', gap: 8 },
  input: { flex: 1, backgroundColor: colors.background, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: colors.textPrimary, fontSize: 13 },
  sendButton: { backgroundColor: colors.accentCyan, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  disabledSend: { opacity: 0.5 },
  sendText: { color: '#000', fontWeight: 'bold', fontSize: 13 },
});
