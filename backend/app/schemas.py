from pydantic import BaseModel
from typing import List, Optional, Dict

class User(BaseModel):
    id: str
    name: str
    image: str

class Track(BaseModel):
    title: str
    artist: str
    thumbnail: str
    url: str
    added_by: Optional[User] = None  # ユーザー情報を追加
    played_at: Optional[str] = None  # 再生履歴用（ISO8601 UTC）
    pending: Optional[bool] = None  # 追加直後で情報取得中（キューのプレースホルダ）

class QueueItem(BaseModel):
    track: Track
    position: int
    isCurrent: bool = False

class SearchItem(BaseModel):
    type: str  # 'song', 'video', 'album', 'playlist', 'artist'
    title: str
    artist: str
    thumbnail: str
    url: str
    browseId: Optional[str] = None
    artistId: Optional[str] = None
    items: Optional[List[Track]] = None  # アルバムやプレイリストの場合

class SearchResult(BaseModel):
    results: List[SearchItem]

class Server(BaseModel):
    id: str
    name: str

class VoiceChannel(BaseModel):
    id: str
    name: str

class AddUrlRequest(BaseModel):
    url: str
    user: Optional[User] = None
    
class PlayTrackRequest(BaseModel):
    track: Track
    user: Optional[User] = None
    
class ReorderRequest(BaseModel):
    start_index: int
    end_index: int

# レスポンス用のモデル
class SongResponse(BaseModel):
    id: str
    guild_id: str
    title: str
    artist: str
    filename: str
    thumbnail_filename: str
    uploader_id: str
    uploader_name: str
    full_path: str  # 必須にする