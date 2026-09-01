import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../services/api';
import Maintenance from '../pages/Maintenance';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isServerOffline, setIsServerOffline] = useState(false);
  const [serverErrorDetails, setServerErrorDetails] = useState(null);

  const checkServerAndUser = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authApi.getMe();
      setIsServerOffline(false);
      setServerErrorDetails(null);
      if (res.data?.success && res.data?.data) {
        setUser(res.data.data);
      } else {
        setUser(null);
      }
    } catch (err) {
      // Network errors (server down, ECONNREFUSED, 502 Bad Gateway, 503 Service Unavailable)
      if (
        !err.response || 
        err.code === 'ERR_NETWORK' || 
        err.code === 'ECONNABORTED' ||
        (err.response && [502, 503, 504].includes(err.response.status))
      ) {
        setIsServerOffline(true);
        setServerErrorDetails(err.message || 'Unable to connect to backend server');
        setUser(null);
      } else if (err.response && err.response.status === 401) {
        // Normal unauthenticated state
        setIsServerOffline(false);
        setUser(null);
      } else {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkServerAndUser();
  }, [checkServerAndUser]);

  // Periodic health check ping every 15 seconds if server is currently offline
  useEffect(() => {
    if (!isServerOffline) return;
    const interval = setInterval(() => {
      checkServerAndUser();
    }, 15000);
    return () => clearInterval(interval);
  }, [isServerOffline, checkServerAndUser]);

  const loginWithGoogle = () => {
    window.location.href = authApi.getGoogleLoginUrl();
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      window.location.href = '/login';
    }
  };

  if (isServerOffline) {
    return <Maintenance onRetry={checkServerAndUser} errorDetails={serverErrorDetails} />;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isServerOffline,
        loginWithGoogle,
        logout,
        refreshUser: checkServerAndUser,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

