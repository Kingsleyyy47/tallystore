import { useEffect, useState } from 'react';
import { useSupportSettings } from '@/hooks/useSupportSettings';

// Set the target time: 36 hours from when maintenance started
// Change this timestamp to when you want maintenance to end
const MAINTENANCE_END = new Date('2026-02-01T22:27:00+01:00').getTime(); // 36 hours from now

export default function MaintenancePage() {
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const support = useSupportSettings();
  const supportUrl = support.whatsappUrl || support.telegramUrl || '';

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const diff = MAINTENANCE_END - now;

      if (diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        clearInterval(timer);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft({ hours, minutes, seconds });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const pad = (n: number) => n.toString().padStart(2, '0');

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="text-center">
        {/* Logo */}
        <div className="mb-8">
          <img
            src="/TALLYAPPLOGO.png"
            alt="TallyStore"
            className="w-32 h-32 mx-auto mb-4 rounded-2xl shadow-2xl"
          />
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            TallyStore
          </h1>
        </div>

        {/* Maintenance Message */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 mb-8 border border-white/20">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse" />
            <h2 className="text-2xl font-semibold text-white">Under Maintenance</h2>
          </div>
          <p className="text-purple-200 max-w-md mx-auto">
            We're making some improvements to serve you better. We'll be back soon!
          </p>
        </div>

        {/* Countdown */}
        <div className="flex justify-center gap-4">
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-4 min-w-[80px] border border-white/20">
            <div className="text-4xl font-bold text-white">{pad(timeLeft.hours)}</div>
            <div className="text-purple-300 text-sm uppercase tracking-wide">Hours</div>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-4 min-w-[80px] border border-white/20">
            <div className="text-4xl font-bold text-white">{pad(timeLeft.minutes)}</div>
            <div className="text-purple-300 text-sm uppercase tracking-wide">Minutes</div>
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-4 min-w-[80px] border border-white/20">
            <div className="text-4xl font-bold text-white">{pad(timeLeft.seconds)}</div>
            <div className="text-purple-300 text-sm uppercase tracking-wide">Seconds</div>
          </div>
        </div>

        {/* Top-up Issues Notice */}
        <div className="mt-8 bg-yellow-500/20 backdrop-blur-lg rounded-xl p-4 border border-yellow-400/30 max-w-md mx-auto">
          <p className="text-yellow-100 text-sm">
            <span className="font-semibold">⚠️ Top-up Issues?</span> Please report your issue along with your email and payment receipt to our{' '}
            {supportUrl ? (
              <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="text-white font-semibold underline hover:text-yellow-200">
                support team
              </a>
            ) : (
              <span className="font-semibold">support team</span>
            )}
            . Thank you for your patience!
          </p>
        </div>

        {/* Contact */}
        {supportUrl && (
          <p className="mt-6 text-purple-300 text-sm">
            Questions?{' '}
            <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="text-white underline hover:text-purple-200">
              Message support
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
