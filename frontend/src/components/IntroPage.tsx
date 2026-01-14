'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { signIn } from 'next-auth/react';
import { Music2, Disc3, Headphones, Radio, Sparkles } from 'lucide-react';

// Floating decorative element component
const FloatingElement = ({
  children,
  className,
  delay = 0,
  duration = 6,
  y = 20,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  y?: number;
}) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{
      opacity: [0.4, 0.7, 0.4],
      y: [0, -y, 0],
      scale: [1, 1.05, 1],
    }}
    transition={{
      duration,
      delay,
      repeat: Infinity,
      ease: 'easeInOut',
    }}
  >
    {children}
  </motion.div>
);

// Animated background orb
const GradientOrb = ({
  className,
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) => (
  <motion.div
    className={`absolute rounded-full blur-3xl ${className}`}
    initial={{ opacity: 0 }}
    animate={{
      opacity: [0.3, 0.5, 0.3],
      scale: [1, 1.1, 1],
    }}
    transition={{
      duration: 8,
      delay,
      repeat: Infinity,
      ease: 'easeInOut',
    }}
  />
);

export const IntroPage = () => {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden relative">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Gradient Orbs */}
        <GradientOrb
          className="w-[500px] h-[500px] -top-48 -left-48 bg-gradient-to-br from-primary/20 via-rose-400/15 to-orange-300/10"
          delay={0}
        />
        <GradientOrb
          className="w-[400px] h-[400px] top-1/3 -right-32 bg-gradient-to-bl from-violet-400/15 via-primary/10 to-pink-300/10"
          delay={2}
        />
        <GradientOrb
          className="w-[300px] h-[300px] bottom-20 left-1/4 bg-gradient-to-tr from-cyan-400/10 via-blue-400/10 to-primary/5"
          delay={4}
        />

        {/* Floating Music Elements */}
        <FloatingElement
          className="absolute top-[15%] left-[10%]"
          delay={0.5}
          duration={7}
          y={25}
        >
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-rose-400/20 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg">
            <Music2 className="w-7 h-7 text-primary/70" />
          </div>
        </FloatingElement>

        <FloatingElement
          className="absolute top-[25%] right-[12%]"
          delay={1.2}
          duration={8}
          y={30}
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-400/20 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg">
            <Disc3 className="w-8 h-8 text-violet-500/70" />
          </div>
        </FloatingElement>

        <FloatingElement
          className="absolute bottom-[30%] left-[8%]"
          delay={2}
          duration={6}
          y={20}
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400/20 to-orange-400/20 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg">
            <Headphones className="w-6 h-6 text-amber-500/70" />
          </div>
        </FloatingElement>

        <FloatingElement
          className="absolute top-[45%] right-[8%]"
          delay={0.8}
          duration={9}
          y={35}
        >
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-emerald-400/20 to-teal-400/20 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg">
            <Radio className="w-5 h-5 text-emerald-500/70" />
          </div>
        </FloatingElement>

        <FloatingElement
          className="absolute bottom-[20%] right-[20%]"
          delay={1.5}
          duration={7}
          y={22}
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400/20 to-rose-400/20 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-lg">
            <Sparkles className="w-5 h-5 text-pink-500/70" />
          </div>
        </FloatingElement>

        {/* Decorative lines */}
        <motion.div
          className="absolute top-1/4 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 1.5, delay: 0.5 }}
        />
        <motion.div
          className="absolute bottom-1/3 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/5 to-transparent"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 1.5, delay: 0.8 }}
        />
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
        <div className="w-full max-w-sm mx-auto">
          {/* Glass Card Container */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative"
          >
            {/* Card glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-rose-400/20 to-violet-400/20 rounded-3xl blur-xl opacity-50" />

            <div className="relative bg-white/70 backdrop-blur-xl rounded-3xl border border-white/50 shadow-2xl shadow-black/5 p-8 sm:p-10">
              {/* Logo/Icon */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.2, type: 'spring', stiffness: 200 }}
                className="flex justify-center mb-8"
              >
                <div className="relative">
                  {/* Outer ring */}
                  <div className="absolute -inset-3 rounded-full bg-gradient-to-br from-primary/20 to-rose-400/20 animate-pulse" />
                  {/* Inner icon container */}
                  <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary via-rose-500 to-primary flex items-center justify-center shadow-lg shadow-primary/30">
                    <Music2 className="w-10 h-10 text-white" />
                  </div>
                </div>
              </motion.div>

              {/* Title */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="text-center mb-3"
              >
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Irina Music
                </h1>
              </motion.div>

              {/* Tagline */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className="text-center text-muted-foreground text-sm sm:text-base mb-8 leading-relaxed"
              >
                サーバーのみんなと一緒に
                <br />
                音楽を楽しもう
              </motion.p>

              {/* Feature highlights */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="flex justify-center gap-6 mb-8"
              >
                {[
                  { icon: Disc3, label: '共有' },
                  { icon: Headphones, label: '再生' },
                  { icon: Radio, label: '発見' },
                ].map((item, index) => (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.5 + index * 0.1 }}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <div className="w-10 h-10 rounded-xl bg-secondary/80 flex items-center justify-center">
                      <item.icon className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {item.label}
                    </span>
                  </motion.div>
                ))}
              </motion.div>

              {/* Login Button */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.6 }}
              >
                <Button
                  onClick={() => signIn('discord')}
                  className="w-full h-14 bg-[#5865F2] hover:bg-[#4752C4] active:bg-[#3C45A5] text-white font-semibold rounded-2xl text-[15px] transition-all duration-200 shadow-lg shadow-[#5865F2]/25 hover:shadow-xl hover:shadow-[#5865F2]/30 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <svg
                    className="w-5 h-5 mr-2.5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                  Discordでログイン
                </Button>
              </motion.div>

              {/* Subtitle */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.7 }}
                className="text-center text-muted-foreground/70 text-xs mt-5"
              >
                ログインするとサーバーの音楽を操作できます
              </motion.p>
            </div>
          </motion.div>

          {/* Footer branding */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1 }}
            className="text-center mt-8"
          >
            <p className="text-[11px] text-muted-foreground/50">
              Powered by Discord & YouTube Music
            </p>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default IntroPage;
