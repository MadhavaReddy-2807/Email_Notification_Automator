import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { FiZap } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';

const Login = () => {
  const { isAuthenticated, loading, loginWithGoogle } = useAuth();

  if (loading) {
    return (
      <div className="fullscreen-loader">
        <div className="spinner"></div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <FiZap />
        </div>
        <h1 className="login-title">AutoCal AI</h1>
        <p className="login-subtitle">
          Effortless email-to-calendar automation powered by Gemini AI
        </p>

        <button 
          className="btn btn-google-login"
          onClick={loginWithGoogle}
        >
          <FcGoogle className="google-icon" />
          <span>Continue with Google</span>
        </button>

        <p className="login-footer-text">
          Syncs meetings & invitations directly to your Google Calendar
        </p>
      </div>
    </div>
  );
};

export default Login;
