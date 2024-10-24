import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { X, Smartphone, QrCode } from 'lucide-react';
import Image from 'next/image';

export const MobileOptimizedMessage = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    // モバイル判定
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    if (!isMobile) {
      const shouldShow = localStorage.getItem('hideMobileMessage') !== 'true';
      setIsVisible(shouldShow);
    }
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    if (dontShowAgain) {
      localStorage.setItem('hideMobileMessage', 'true');
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.3 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-50"
        >
          <Card className="relative overflow-hidden border-2 border-primary/10 backdrop-blur-sm bg-card/95">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 hover:bg-primary/10"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </Button>

            <CardContent className="p-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center gap-3 mb-4"
              >
                <Smartphone className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-lg">モバイル最適化アプリ</h3>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="space-y-4"
              >
                <p className="text-sm text-muted-foreground leading-relaxed">
                  このアプリはスマートフォンでの利用に最適化されています。
                  以下のQRコードからアクセスし、「ホーム画面に追加」することで、
                  より快適にご利用いただけます。
                </p>

                <div className="flex justify-center py-2">
                  <div className="relative p-4 bg-white rounded-lg">
                    <QrCode className="absolute -top-2 -left-2 h-4 w-4 text-primary" />
                    <Image
                      src="/qr-code.png"
                      alt="QRコード"
                      width={120}
                      height={120}
                      className="rounded"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4">
                  <Checkbox
                    id="dontShowAgain"
                    checked={dontShowAgain}
                    onCheckedChange={(checked) => setDontShowAgain(checked === true)}
                  />
                  <label
                    htmlFor="dontShowAgain"
                    className="text-sm text-muted-foreground cursor-pointer"
                  >
                    次回から表示しない
                  </label>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="default"
                    onClick={handleClose}
                    className="w-full sm:w-auto"
                  >
                    閉じる
                  </Button>
                </div>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MobileOptimizedMessage;