'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, googleProvider, signInWithPopup, signInAnonymously } from '@/app/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParams = searchParams?.get('redirect') || '/';
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auto redirect if already logged in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        // Logged in, send back to where they came from
        router.push(redirectParams);
      } else {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, redirectParams]);

  const loginWithGoogle = async () => {
    try {
      setLoading(true);
      setError(null);
      await signInWithPopup(auth, googleProvider);
      // Let the onAuthStateChanged handle the redirect
    } catch (err: any) {
      console.error(err);
      setError('Login failed: ' + err.message);
      setLoading(false);
    }
  };

  const loginAsGuest = async () => {
    try {
      setLoading(true);
      setError(null);
      await signInAnonymously(auth);
    } catch (err: any) {
      console.error(err);
      setError('Guest login failed: ' + err.message);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">
        Checking authentication...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white selection:bg-indigo-500">
      <div className="max-w-md w-full p-8 bg-gray-900 rounded-3xl shadow-2xl border border-gray-800 text-center space-y-8">
        <div>
          <img src="/logo.png" alt="Chess Forge Logo" className="w-24 h-24 mx-auto mb-4 object-contain drop-shadow-xl" />
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-br from-white to-gray-400 bg-clip-text text-transparent mb-2">
            Chess Forge
          </h1>
          <p className="text-gray-400">Please sign in with Google to play</p>
        </div>

        {error && (
          <div className="p-3 bg-red-900/50 border border-red-500 text-red-200 rounded-xl text-sm">
            {error}
          </div>
        )}

        <button
          onClick={loginWithGoogle}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white text-gray-900 font-semibold rounded-2xl hover:bg-gray-100 transition-all shadow-lg active:scale-[0.98]"
        >
          {/* Flat Google G Logo */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
        
        <button
          onClick={loginAsGuest}
          className="w-full mt-3 flex items-center justify-center gap-3 px-6 py-4 bg-gray-800 text-white font-semibold rounded-2xl hover:bg-gray-700 transition-all shadow-lg active:scale-[0.98] border border-gray-700 hover:border-gray-500"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          Play as Guest
        </button>

        <p className="text-xs text-gray-500 max-w-xs mx-auto">
          Your name and profile picture will only be used for display in the lobby and chat.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
