// IntroPage.tsx
'use client';

import React from 'react';
import { Button } from './ui/button';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Music, Headphones, Users } from 'lucide-react';

export const IntroPage: React.FC = () => {
  const fadeIn = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-600 to-indigo-800 text-white flex flex-col items-center justify-center p-4">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeIn}
        transition={{ duration: 0.6 }}
        className="text-center"
      >
        <h1 className="text-5xl font-bold mb-6">Discord Music App</h1>
        <p className="text-xl mb-8 max-w-2xl mx-auto">
          あなたのDiscordサーバーに最高の音楽体験をもたらします。
          友達と一緒に音楽を楽しみ、プレイリストを共有し、パーティーを盛り上げましょう。
        </p>
      </motion.div>

      <motion.div
        className="flex justify-center space-x-12 mb-12"
        initial="hidden"
        animate="visible"
        variants={fadeIn}
        transition={{ delay: 0.3, duration: 0.6 }}
      >
        <FeatureCard icon={<Music size={40} />} title="豊富な音楽ソース" />
        <FeatureCard icon={<Headphones size={40} />} title="高音質再生" />
        <FeatureCard icon={<Users size={40} />} title="協力プレイリスト" />
      </motion.div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeIn}
        transition={{ delay: 0.6, duration: 0.6 }}
      >
        <Button
          onClick={() => signIn('discord')}
          className="bg-white text-purple-600 hover:bg-purple-100 font-bold py-3 px-6 rounded-full text-lg transition duration-300"
        >
          Discordでログイン
        </Button>
      </motion.div>
    </div>
  );
};

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <div className="flex flex-col items-center">
    <div className="bg-white text-purple-600 rounded-full p-4 mb-4">
      {icon}
    </div>
    <h3 className="text-lg font-semibold">{title}</h3>
  </div>
);