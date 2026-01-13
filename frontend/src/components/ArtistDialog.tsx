import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
	DialogTitle,
} from '@/components/ui/dialog';
import { api, Track, SearchItem } from '@/utils/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { VisuallyHidden } from '@/components/ui/visually-hidden';

interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface Song {
  title: string;
  artist?: string;
  videoId: string;
  thumbnails: Thumbnail[];
}

interface Album {
  browseId: string;
  title: string;
  year?: string;
  thumbnails: Thumbnail[];
}

interface RelatedArtist {
  browseId: string;
  title: string;
  thumbnails: Thumbnail[];
}

interface ArtistData {
  name: string;
  subscribers?: string;
  thumbnails: Thumbnail[];
  songs: Song[];
  albums: Album[];
  related: RelatedArtist[];
}

interface ArtistDialogProps {
  artistId: string;
  isOpen: boolean;
  onClose: () => void;
  onAddTrackToQueue: (track: Track) => Promise<void>;
  onAddItemToQueue: (item: SearchItem) => Promise<void>;
}

export const ArtistDialog: React.FC<ArtistDialogProps> = ({
  artistId,
  isOpen,
  onClose,
  onAddTrackToQueue,
}) => {
  const [artistData, setArtistData] = useState<ArtistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [albumTracks, setAlbumTracks] = useState<{ [key: string]: Track[] }>({});
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const fetchArtistData = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const response = await api.getArtistInfo(id)
      // キャストや整形が必要ならここで実施
      setArtistData(response as ArtistData)
    } catch (error) {
      console.error('アーティスト情報の取得に失敗しました:', error)
      toast({
        title: 'エラー',
        description: 'アーティスト情報の取得に失敗しました。',
        variant: 'destructive',
      })
      onClose()
    } finally {
      setLoading(false)
    }
  }, [toast, onClose])

  useEffect(() => {
    if (isOpen && artistId) {
      fetchArtistData(artistId)
    }
  }, [isOpen, artistId, fetchArtistData])

  const fetchAlbumTracks = async (albumId: string) => {
    if (albumTracks[albumId]) return;
    
    try {
      const tracks = await api.getAlbumItems(albumId);
      setAlbumTracks(prev => ({ ...prev, [albumId]: tracks }));
    } catch (error) {
      console.error('アルバムトラックの取得に失敗しました:', error);
      toast({
        title: 'エラー',
        description: 'アルバムトラックの取得に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  const handleAddTrack = async (track: Track) => {
    try {
      await onAddTrackToQueue(track);
      toast({
        title: '追加しました',
        description: `"${track.title}" をキューに追加しました。`,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'エラー',
        description: 'キューへの追加に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  const handleAddAllTracks = async (tracks: Track[]) => {
    try {
      for (const track of tracks) {
        await onAddTrackToQueue(track);
      }
      toast({
        title: '追加しました',
        description: `${tracks.length}曲をキューに追加しました。`,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'エラー',
        description: 'キューへの追加に失敗しました。',
        variant: 'destructive',
      });
    }
  };

  const toggleAlbumExpanded = (albumId: string) => {
    const newExpanded = new Set(expandedAlbums);
    if (newExpanded.has(albumId)) {
      newExpanded.delete(albumId);
    } else {
      newExpanded.add(albumId);
      fetchAlbumTracks(albumId);
    }
    setExpandedAlbums(newExpanded);
  };

  if (!isOpen || !artistData) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-4xl p-0 h-[85vh] sm:h-[90vh] flex flex-col">
        <VisuallyHidden>
          <DialogTitle>アーティスト詳細: {artistData.name}</DialogTitle>
        </VisuallyHidden>
        {loading ? (
          <div className="flex-grow flex items-center justify-center">
            <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* ヘッダー部分（固定） */}
            <div className="relative h-32 sm:h-48 w-full flex-shrink-0">
              <div className="absolute inset-0">
                <Image
                  src={artistData.thumbnails[0]?.url || '/placeholder.png'}
                  alt=""
                  fill
                  className="object-cover blur-sm brightness-50"
                  unoptimized
                />
              </div>
              <div className="absolute inset-0 flex items-center p-3 sm:p-6">
                <div className="flex items-center gap-3 sm:gap-6">
                  <div className="relative w-20 h-20 sm:w-32 sm:h-32 flex-shrink-0">
                    <Image
                      src={artistData.thumbnails[0]?.url || '/placeholder.png'}
                      alt={artistData.name}
                      fill
                      className="rounded-full object-cover ring-2 ring-background"
                      unoptimized
                    />
                  </div>
                  <div className="text-white min-w-0 flex-1">
                    <h2 className="text-lg sm:text-3xl font-bold mb-1 sm:mb-2 line-clamp-2">{artistData.name}</h2>
                    {artistData.subscribers && (
                      <Badge variant="secondary" className="bg-white/10 text-xs sm:text-sm">
                        {artistData.subscribers}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* スクロール可能なコンテンツ部分 */}
            <ScrollArea className="flex-grow">
              <div className="p-3 sm:p-6 space-y-6 sm:space-y-8">
                {/* トップソング */}
                {artistData.songs.length > 0 && (
                  <section>
                    <div className="flex justify-between items-center mb-3 sm:mb-4">
                      <h3 className="text-base sm:text-xl font-bold">トップソング</h3>
                      <Button
                        onClick={() => handleAddAllTracks(artistData.songs.map((song) => ({
                          title: song.title,
                          artist: song.artist || artistData.name,
                          thumbnail: song.thumbnails[0]?.url || '',
                          url: `https://music.youtube.com/watch?v=${song.videoId}`,
                        })))}
                        variant="secondary"
                        size="sm"
                        className="gap-1 sm:gap-2 text-xs sm:text-sm h-7 sm:h-9"
                      >
                        <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                        全曲追加
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {artistData.songs.map((song, index) => (
                        <div
                          key={index}
                          className="flex items-center p-2 sm:p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                        >
                          <div className="w-6 sm:w-10 text-muted-foreground font-medium text-xs sm:text-base">
                            {index + 1}
                          </div>
                          <div className="relative w-10 h-10 sm:w-12 sm:h-12 mr-2 sm:mr-4 flex-shrink-0">
                            <Image
                              src={song.thumbnails[0]?.url || '/placeholder.png'}
                              alt={song.title}
                              fill
                              className="rounded-md object-cover"
                              unoptimized
                            />
                          </div>
                          <div className="flex-grow min-w-0">
                            <p className="font-medium text-sm sm:text-base line-clamp-1">{song.title}</p>
                            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-1">
                              {song.artist || artistData.name}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 sm:h-9 sm:w-9 flex-shrink-0"
                            onClick={() =>
                              handleAddTrack({
                                title: song.title,
                                artist: song.artist || artistData.name,
                                thumbnail: song.thumbnails[0]?.url || '',
                                url: `https://music.youtube.com/watch?v=${song.videoId}`,
                              })
                            }
                          >
                            <Plus className="w-3 h-3 sm:w-4 sm:h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* アルバム */}
                {artistData.albums.length > 0 && (
                  <section>
                    <h3 className="text-base sm:text-xl font-bold mb-3 sm:mb-4">アルバム</h3>
                    <div className="space-y-4">
                      {artistData.albums.map((album, index) => (
                        <Collapsible
                          key={index}
                          open={expandedAlbums.has(album.browseId)}
                          onOpenChange={() => toggleAlbumExpanded(album.browseId)}
                        >
                          <div className="bg-card rounded-lg overflow-hidden">
                            <CollapsibleTrigger asChild>
                              <div className="p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                                <div className="flex gap-4">
                                  <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0">
                                    <Image
                                      src={album.thumbnails[0]?.url || '/placeholder.png'}
                                      alt={album.title}
                                      fill
                                      className="rounded-lg object-cover"
                                      unoptimized
                                    />
                                  </div>
                                  <div className="flex-grow min-w-0">
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="min-w-0 flex-grow">
                                        <div className="flex items-center gap-2 mb-1">
                                          <h4 className="font-bold text-base sm:text-lg line-clamp-1">
                                            {album.title}
                                          </h4>
                                          <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${
                                            expandedAlbums.has(album.browseId) ? 'rotate-180' : ''
                                          }`} />
                                        </div>
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                          <span className="text-sm">
                                            {album.year || ''}
                                          </span>
                                          {albumTracks[album.browseId] && (
                                            <span className="text-sm">
                                              • {albumTracks[album.browseId].length}曲
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="h-8 px-3 shrink-0 gap-1 font-medium"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          await fetchAlbumTracks(album.browseId);
                                          if (albumTracks[album.browseId]) {
                                            await handleAddAllTracks(albumTracks[album.browseId]);
                                          }
                                        }}
                                      >
                                        全曲追加
                                        <span className="text-lg leading-none">＋</span>
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="border-t">
                                {albumTracks[album.browseId] ? (
                                  <div className="divide-y">
                                    {albumTracks[album.browseId].map((track, trackIndex) => (
                                      <div
                                        key={trackIndex}
                                        className="flex items-center p-3 hover:bg-muted/50 transition-colors"
                                      >
                                        <div className="w-8 sm:w-10 text-muted-foreground text-sm font-medium">
                                          {trackIndex + 1}
                                        </div>
                                        <div className="flex-grow min-w-0 mr-2">
                                          <p className="font-medium text-sm sm:text-base line-clamp-1">
                                            {track.title}
                                          </p>
                                          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-1">
                                            {track.artist}
                                          </p>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-8 w-8 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleAddTrack(track);
                                          }}
                                        >
                                          <Plus className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="flex justify-center items-center p-4">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
																		</div>
                                )}
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      ))}
                    </div>
                  </section>
                )}

                {/* 似たアーティスト */}
                {artistData.related.length > 0 && (
                  <section>
                    <h3 className="text-base sm:text-xl font-bold mb-3 sm:mb-4">似たアーティスト</h3>
                    <div className="overflow-x-auto scrollbar-thin pb-2">
                      <div className="flex gap-2 sm:gap-4">
                        {artistData.related.map((artist, index) => (
                          <Button
                            key={index}
                            variant="ghost"
                            className="h-auto p-2 sm:p-4 hover:bg-muted/50 flex-shrink-0"
                            onClick={() => {
                              fetchArtistData(artist.browseId);
                            }}
                          >
                            <div className="space-y-2 sm:space-y-3">
                              <div className="relative w-20 h-20 sm:w-32 sm:h-32">
                                <Image
                                  src={artist.thumbnails[0]?.url || '/placeholder.png'}
                                  alt={artist.title}
                                  fill
                                  className="rounded-full object-cover"
                                  unoptimized
                                />
                              </div>
                              <p className="text-xs sm:text-sm font-medium whitespace-normal text-center max-w-[80px] sm:max-w-[128px] line-clamp-2">
                                {artist.title}
                              </p>
                            </div>
                          </Button>
                        ))}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ArtistDialog;