import * as SecureStore from 'expo-secure-store';

const GROQ_API_KEY = 'groq_api_key';

export const getGroqApiKey = () => SecureStore.getItemAsync(GROQ_API_KEY);

export const saveGroqApiKey = (apiKey) =>
  SecureStore.setItemAsync(GROQ_API_KEY, apiKey.trim());

export const deleteGroqApiKey = () =>
  SecureStore.deleteItemAsync(GROQ_API_KEY);
