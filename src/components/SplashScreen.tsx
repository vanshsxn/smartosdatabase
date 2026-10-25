
import { useEffect } from "react";

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 2500);

    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <div className="splash-screen">
      <div className="splash-content">
        <h1 className="splash-logo" aria-label="ODeX">
          <span className="logo-o">O</span>
          <span className="logo-d">D</span>
          <span className="logo-e">e</span>
          <span className="logo-x">X</span>
        </h1>

        <p className="splash-tagline">Your workspace. Simplified.</p>

        <div className="loading-dots" aria-label="Loading">
          <span />
          <span />
          <span />
        </div>
      </div>

      <style>{`
        .splash-screen {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b1020;
          color: white;
          font-family: Inter, system-ui, sans-serif;
          animation: splashFadeIn 0.5s ease both;
        }

        .splash-content {
          text-align: center;
          animation: logoAppear 0.8s ease both;
        }

        .splash-logo {
          margin: 0;
          font-size: clamp(64px, 12vw, 100px);
          font-weight: 800;
          letter-spacing: -6px;
          line-height: 1.1;
        }

        .logo-o { color: #3b82f6; }
        .logo-d { color: #ef4444; }
        .logo-e { color: #facc15; }
        .logo-x { color: #22c55e; }

        .splash-tagline {
          margin-top: 16px;
          color: #aab4cc;
          font-size: 14px;
          letter-spacing: 2px;
          animation: taglineAppear 1s ease both;
        }

        .loading-dots {
          display: flex;
          justify-content: center;
          gap: 7px;
          margin-top: 32px;
        }

        .loading-dots span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #8ba9ff;
          animation: dotPulse 1s infinite ease-in-out;
        }

        .loading-dots span:nth-child(2) {
          animation-delay: 0.15s;
        }

        .loading-dots span:nth-child(3) {
          animation-delay: 0.3s;
        }

        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.7); }
          40% { opacity: 1; transform: scale(1.2); }
        }

        @keyframes logoAppear {
          from { opacity: 0; transform: translateY(18px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes taglineAppear {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes splashFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .splash-screen, .splash-content, .splash-tagline,
          .loading-dots span {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
