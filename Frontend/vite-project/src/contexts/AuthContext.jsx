import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import axios from "axios";

const AuthContext = createContext(null);

const TOKEN_KEY = "auth_token";
const TOKEN_EXPIRE_KEY = "token_expire_time";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

// 4 hours in milliseconds
const TOKEN_EXPIRE_MS = 4 * 60 * 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const fetchUserInfo = useCallback(async (authToken) => {
    try {
      const response = await axios.get(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      setUser(response.data);
      setLoading(false);
    } catch (error) {
      console.error("Failed to fetch user info:", error);
      logout();
      setLoading(false);
    }
  }, [logout]);

  // Check for existing token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const expireTime = localStorage.getItem(TOKEN_EXPIRE_KEY);
    
    if (storedToken && expireTime) {
      const now = Date.now();
      if (now < parseInt(expireTime)) {
        setToken(storedToken);
        fetchUserInfo(storedToken);
      } else {
        logout();
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, [logout, fetchUserInfo]);

  // Set up axios interceptor to include token in requests
  useEffect(() => {
    const interceptor = axios.interceptors.request.use(
      (config) => {
        const currentToken = token || localStorage.getItem(TOKEN_KEY);
        if (currentToken) {
          config.headers.Authorization = `Bearer ${currentToken}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor to handle 401 errors
    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          logout();
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(interceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, [token, logout]);

  const login = async (username, password) => {
    try {
      const response = await axios.post(`${API_BASE}/auth/login`, {
        username,
        password,
      });
      
      const { access_token, user: userData } = response.data;
      
      const expireTime = Date.now() + TOKEN_EXPIRE_MS;
      localStorage.setItem(TOKEN_KEY, access_token);
      localStorage.setItem(TOKEN_EXPIRE_KEY, expireTime.toString());
      
      setToken(access_token);
      setUser(userData);
      setLoading(false);
      
      return { success: true };
    } catch (error) {
      const message =
        error.response?.data?.detail || "Login failed. Please check your credentials.";
      return { success: false, error: message };
    }
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    isAuthenticated: !!token && !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
