import axios from 'axios';

/**
 * API Configuration
 *
 * AI: Change API_BASE_URL to your backend endpoint
 * Example: 'https://api.example.com' or 'https://myapp.herokuapp.com/api'
 */
const API_BASE_URL = 'https://api.example.com';

/**
 * Axios instance with pre-configured settings
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000, // 10 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request Interceptor
 * AI: Add authentication token here if needed
 */
api.interceptors.request.use(
  (config) => {
    // Example: Add auth token from AsyncStorage
    // const token = await AsyncStorage.getItem('auth_token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response Interceptor
 * Handles errors globally and returns clean data
 */
api.interceptors.response.use(
  (response) => {
    // Return only the data part of response
    return response.data;
  },
  (error) => {
    // Network error (no response from server)
    if (!error.response) {
      throw new Error('Network error - Please check your internet connection');
    }

    // API error (server responded with error)
    const message = error.response.data?.message || error.response.statusText || 'An error occurred';
    throw new Error(message);
  }
);

/**
 * Usage Examples:
 *
 * // GET request
 * const users = await api.get('/users');
 *
 * // GET with params
 * const user = await api.get('/users/123');
 * const filtered = await api.get('/users', { params: { role: 'admin' } });
 *
 * // POST request
 * const newUser = await api.post('/users', { name: 'John', email: 'john@example.com' });
 *
 * // PUT request
 * const updated = await api.put('/users/123', { name: 'Jane' });
 *
 * // DELETE request
 * await api.delete('/users/123');
 *
 * // Custom URL (bypass base URL)
 * const data = await axios.get('https://another-api.com/data');
 *
 * // With error handling in component:
 * try {
 *   const users = await api.get('/users');
 *   setUsers(users);
 * } catch (error) {
 *   Alert.alert('Error', error.message);
 * }
 */

export default api;