import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = '';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('@auth_token').catch(() => null);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (!error.response) {
      throw new Error('Netzwerkfehler – bitte Verbindung prüfen');
    }
    const message =
      error.response.data?.message ||
      error.response.statusText ||
      'Ein Fehler ist aufgetreten';
    throw new Error(message);
  }
);

export default api;
