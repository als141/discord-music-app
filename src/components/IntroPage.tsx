import React from 'react';
import { Button } from '@/components/ui/button';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Music2, Headphones, Users, Wind } from 'lucide-react';

export const IntroPage = () => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.3
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
        ease: "easeOut"
      }
    }
  };

  const floatAnimation = {
    y: [-10, 10],
    transition: {
      duration: 3,
      repeat: Infinity,
      repeatType: "reverse" as const,
      ease: "easeInOut"
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 text-white relative">
      {/* 背景のデコレーション要素 - position: fixed に変更 */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        className="fixed top-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="fixed bottom-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl"
      />

      <div className="relative z-10 container mx-auto px-4 py-20 min-h-screen">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center"
        >
          {/* ヘッドライン */}
          <motion.div
            variants={itemVariants}
            className="text-center mb-16 pt-8 md:pt-16"
          >
            <motion.div animate={floatAnimation}>
              <h1 className="text-4xl md:text-6xl font-bold mb-6 tracking-tight">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-300">
                  音楽の調べが紡ぐ
                </span>
              </h1>
              <h2 className="text-3xl md:text-5xl font-bold mb-8">新しい交流の形</h2>
            </motion.div>
            <p className="text-lg md:text-xl text-gray-300 leading-relaxed max-w-2xl mx-auto px-4">
              空間を超えて響き合う音楽の世界へ。
              <br />
              仲間と共に奏でる新しい音楽体験が、
              <br className="hidden md:block" />
              あなたのDiscordサーバーで始まります。
            </p>
          </motion.div>

          {/* 機能カード */}
          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-16 w-full max-w-6xl px-4"
          >
            <FeatureCard
              icon={<Music2 />}
              title="無限の音楽空間"
              description="Youtube Musicから様々な音源に対応し、あなたの音楽体験を広げます"
            />
            <FeatureCard
              icon={<Headphones />}
              title="極上のインターフェース"
              description="シンプルで使いやすいUIで、音楽を楽しむことに集中できます"
            />
            <FeatureCard
              icon={<Users />}
              title="みんなで創る"
              description="プレイリストの共同編集で新しい発見を"
            />
          </motion.div>

          {/* CTAボタン */}
          <motion.div
            variants={itemVariants}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="mb-8"
          >
            <Button
              onClick={() => signIn('discord')}
              className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-medium py-6 px-12 rounded-full text-lg shadow-lg hover:shadow-xl transform transition-all duration-300"
            >
              <Wind className="w-5 h-5 mr-2" />
              Discord で始める
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) => (
  <motion.div
    whileHover={{ y: -5 }}
    className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 md:p-8 border border-white/10 hover:border-purple-500/50 transition-colors duration-300"
  >
    <motion.div
      whileHover={{ rotate: [0, -10, 10, 0] }}
      transition={{ duration: 0.5 }}
      className="bg-gradient-to-br from-purple-500 to-indigo-500 text-white rounded-xl p-4 w-14 h-14 md:w-16 md:h-16 flex items-center justify-center mb-6"
    >
      {icon}
    </motion.div>
    <h3 className="text-xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-300">
      {title}
    </h3>
    <p className="text-gray-400 leading-relaxed text-sm md:text-base">
      {description}
    </p>
  </motion.div>
);

export default IntroPage;