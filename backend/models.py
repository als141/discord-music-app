# models.py
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class UploadedTrack(Base):
    __tablename__ = "uploaded_tracks"
    
    id = Column(Integer, primary_key=True)
    guild_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    artist = Column(String)
    file_path = Column(String, nullable=False)
    thumbnail_path = Column(String)
    uploader_id = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    is_deleted = Column(Boolean, default=False)