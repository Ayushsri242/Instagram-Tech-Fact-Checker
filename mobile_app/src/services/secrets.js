import * as SecureStore from 'expo-secure-store';

const GROQ_API_KEY = 'groq_api_key';
const PROVIDER_KEY = 'api_provider_name';
const MODEL_KEY = 'api_model_name';

export const getGroqApiKey = () => SecureStore.getItemAsync(GROQ_API_KEY);
export const saveGroqApiKey = (apiKey) => SecureStore.setItemAsync(GROQ_API_KEY, apiKey.trim());
export const deleteGroqApiKey = () => SecureStore.deleteItemAsync(GROQ_API_KEY);

export const getApiProvider = () => SecureStore.getItemAsync(PROVIDER_KEY);
export const saveApiProvider = (provider) => SecureStore.setItemAsync(PROVIDER_KEY, provider.trim());

export const getApiModel = () => SecureStore.getItemAsync(MODEL_KEY);
export const saveApiModel = (model) => SecureStore.setItemAsync(MODEL_KEY, model.trim());
