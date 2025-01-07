// UploadDialog.tsx
"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";

interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  guildId: string | null;
  onUploaded: () => void;  // アップロード成功後のコールバック
}

export const UploadDialog: React.FC<UploadDialogProps> = ({
  isOpen,
  onClose,
  guildId,
  onUploaded,
}) => {
  const { toast } = useToast();
  const { data: session } = useSession();

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleUpload = async () => {
    if (!guildId) {
      toast({
        title: "エラー",
        description: "サーバーが選択されていません。",
        variant: "destructive",
      });
      return;
    }
    if (!session || !session.user) {
      toast({
        title: "エラー",
        description: "ユーザー情報の取得に失敗しました。",
        variant: "destructive",
      });
      return;
    }
    if (!audioFile) {
      toast({
        title: "エラー",
        description: "音声ファイルを指定してください。",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      const formData = new FormData();
      formData.append("user_id", session.user.id);
      formData.append("user_name", session.user.name || "Unknown");
      formData.append("title", title);
      formData.append("artist", artist);
      formData.append("audio_file", audioFile);
      if (thumbnailFile) {
        formData.append("thumbnail_file", thumbnailFile);
      }

      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload-audio/${guildId}`, {
        method: "POST",
        body: formData,
      }).then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "アップロードに失敗しました。");
        }
      });

      toast({
        title: "アップロード成功",
        description: "楽曲がアップロードされました。",
      });
      onClose();
      onUploaded(); // アップロード完了時に楽曲一覧を再取得するなど
    } catch (error: any) {
      toast({
        title: "エラー",
        description: error.message || "アップロードに失敗しました。",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setTitle("");
    setArtist("");
    setAudioFile(null);
    setThumbnailFile(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>音楽アップロード</DialogTitle>
          <DialogDescription>ギルド専用にカスタム楽曲をアップロードします。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>タイトル</Label>
            <Input
              type="text"
              placeholder="曲のタイトル"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label>アーティスト</Label>
            <Input
              type="text"
              placeholder="アーティスト名"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
            />
          </div>
          <div>
            <Label>音楽ファイル</Label>
            <Input
              type="file"
              accept=".mp3,.wav,.flac,.aac,.m4a"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setAudioFile(e.target.files[0]);
                }
              }}
            />
          </div>
          <div>
            <Label>ジャケット画像（任意）</Label>
            <Input
              type="file"
              accept=".png,.jpg,.jpeg,.gif"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setThumbnailFile(e.target.files[0]);
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">キャンセル</Button>
          </DialogClose>
          <Button onClick={handleUpload} disabled={isLoading}>
            {isLoading ? "アップロード中..." : "アップロード"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
