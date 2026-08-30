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
import { chatWithAiApi } from '../services/api';
import { getChatHistory, saveChatMessage } from '../services/storage';

export default function ChatScreen({ route, navigation }) {
  const { reel } = route.params;
  const reelId = reel?.reelId || 'unknown';
  const techName = reel?.techName || 'Unknown Tool';
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef(null);

  const loadHistory = async () => {
    const history = await getChatHistory(reelId);
    if (history.length === 0) {
      const initial = {
        id: '1',
        sender: 'assistant',
        text: `Hi! Ask me anything about ${techName || 'this technology'} — installation, code snippets, or gotchas!`,
      };
      setMessages([initial]);
      await saveChatMessage(reelId, initial);
    } else {
      setMessages(history);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [reelId]);

  const handleSend = async (customText = null) => {
    const textToSend = (customText || input).trim();
    if (!textToSend || loading) return;

    const userMsg = {
      id: Date.now().toString(),
      sender: 'user',
      text: textToSend,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    await saveChatMessage(reelId, userMsg);

    try {
      const replyText = await chatWithAiApi(reel, textToSend);
      const aiMsg = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: replyText,
      };
      setMessages((prev) => [...prev, aiMsg]);
      await saveChatMessage(reelId, aiMsg);
    } catch (e) {
      console.error("[ChatScreen] LLM Error:", e);
      const errorMsg = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: `⚠️ LLM Error: ${e.message}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{techName || 'Ask AI'}</Text>
          <Text style={styles.headerSubtitle}>On-Device Technical Q&A</Text>
        </View>

        {/* Suggestion chips */}
        <View style={styles.chipsRow}>
          <TouchableOpacity
            style={styles.chip}
            onPress={() => handleSend(`How do I install and run ${techName}?`)}
          >
            <Text style={styles.chipText}>📦 How to install?</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chip}
            onPress={() => handleSend(`Show a 5-line code snippet for ${techName}`)}
          >
            <Text style={styles.chipText}>💻 Code snippet</Text>
          </TouchableOpacity>
        </View>

        {/* Message list */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const isUser = item.sender === 'user';
            return (
              <View
                style={[
                  styles.messageBubble,
                  isUser ? styles.userBubble : styles.aiBubble,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    isUser ? styles.userText : styles.aiText,
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            );
          }}
        />

        {/* Input Bar */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Ask about installation, code, etc..."
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => handleSend()}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!input.trim() || loading) && styles.disabledSend]}
            onPress={() => handleSend()}
            disabled={!input.trim() || loading}
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
    borderBottomColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.accentCyan,
  },
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  messagesList: {
    padding: 16,
    gap: 12,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 14,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentCyan,
    borderBottomRightRadius: 2,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderBottomLeftRadius: 2,
  },
  messageText: {
    fontSize: 13,
    lineHeight: 18,
  },
  userText: {
    color: '#000',
    fontWeight: '500',
  },
  aiText: {
    color: colors.textPrimary,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 13,
  },
  sendButton: {
    backgroundColor: colors.accentCyan,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  disabledSend: {
    opacity: 0.5,
  },
  sendText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 13,
  },
});
