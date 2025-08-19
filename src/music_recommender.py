import os
import json
import random
import sqlite3
from typing import List, Dict, Optional, Tuple
import logging
from datetime import datetime
import threading

class MusicRecommender:
    """音乐推荐系统"""
    
    def __init__(self, data_dir: str = "data"):
        self.logger = logging.getLogger(__name__)
        # 规范化项目根路径与数据目录，避免从 `src/` 目录运行导致相对路径错误
        self.project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        # 优先环境变量，其次入参，最后默认 `project_root/data`
        env_data_dir = os.environ.get("MUSIC_DATA_DIR")
        candidate_data_dir = env_data_dir or data_dir or "data"
        if not os.path.isabs(candidate_data_dir):
            candidate_data_dir = os.path.join(self.project_root, candidate_data_dir)
        # 回退：若目录不存在且是 `src/data` 误路径，强制回到根目录 `data`
        if not os.path.isdir(candidate_data_dir):
            fallback_dir = os.path.join(self.project_root, "data")
            if os.path.isdir(fallback_dir):
                candidate_data_dir = fallback_dir
        self.data_dir = os.path.normpath(candidate_data_dir)
        
        # 数据库路径
        self.db_path = os.path.join(self.project_root, 'music_recommendations.db')
        
        # 线程本地存储
        self._local = threading.local()
        
        # 情绪-音乐映射关系
        self.emotion_music_mapping = {
            'angry': {'description': '愤怒情绪推荐释放压力、节奏强烈的音乐', 'tags': ['intense', 'powerful', 'cathartic', 'energetic']},
            'disgust': {'description': '厌恶情绪推荐清新、纯净的音乐', 'tags': ['clean', 'pure', 'refreshing', 'clear']},
            'fear': {'description': '恐惧情绪推荐安全、温暖的音乐', 'tags': ['safe', 'warm', 'protective', 'gentle']},
            'happy': {'description': '快乐情绪推荐轻快、节奏明快的音乐', 'tags': ['upbeat', 'cheerful', 'energetic', 'positive']},
            'sad': {'description': '悲伤情绪推荐舒缓、温暖的音乐', 'tags': ['calm', 'soothing', 'melancholic', 'warm']},
            'surprise': {'description': '惊讶情绪推荐新奇、有趣的音乐', 'tags': ['novel', 'interesting', 'dynamic', 'unexpected']},
            'neutral': {'description': '中性情绪推荐平衡、舒适的音乐', 'tags': ['balanced', 'comfortable', 'smooth', 'pleasant']},
        }
        
        # 初始化数据库
        self.init_database()
        
        # 加载音乐库
        self.music_library = self.load_music_library()
    
    def get_db_connection(self):
        """获取数据库连接，支持多线程"""
        if not hasattr(self._local, 'connection') or self._local.connection is None:
            self._local.connection = sqlite3.connect(self.db_path)
            self._local.cursor = self._local.connection.cursor()
        return self._local.connection, self._local.cursor
    
    @property
    def cursor(self):
        """获取当前线程的数据库游标"""
        _, cursor = self.get_db_connection()
        return cursor
    
    @property
    def conn(self):
        """获取当前线程的数据库连接"""
        conn, _ = self.get_db_connection()
        return conn
    
    def init_database(self):
        """初始化数据库"""
        try:
            # 使用主线程连接初始化数据库结构
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            # 创建音乐元数据表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS music_metadata (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    song_id TEXT UNIQUE,
                    title TEXT,
                    artist TEXT,
                    emotion_category TEXT,
                    file_path TEXT,
                    duration REAL,
                    popularity_score REAL DEFAULT 0.0
                )
            ''')
            
            # 创建播放历史表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS play_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    song_id TEXT,
                    emotion TEXT,
                    action TEXT,
                    rating INTEGER,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (song_id) REFERENCES music_metadata (song_id)
                )
            ''')
            
            # 创建用户统计表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS user_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT UNIQUE,
                    total_plays INTEGER DEFAULT 0,
                    favorite_emotion TEXT,
                    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()
            conn.close()
            
            self.logger.info("数据库初始化成功")
            
        except Exception as e:
            self.logger.error(f"数据库初始化失败: {e}")
            raise
    
    def load_music_library(self) -> Dict:
        """加载音乐库，确保所有情绪标签都存在，即使没有mp3文件"""
        music_library = {}
        # 先确保所有情绪标签都初始化为空列表
        for emotion in self.emotion_music_mapping.keys():
            music_library[emotion] = []
        try:
            if not os.path.isdir(self.data_dir):
                raise FileNotFoundError(f"音乐数据目录不存在: {self.data_dir}")

            for emotion_folder in os.listdir(self.data_dir):
                emotion_path = os.path.join(self.data_dir, emotion_folder)
                if os.path.isdir(emotion_path):
                    # 只处理已知情绪标签
                    if emotion_folder not in music_library:
                        music_library[emotion_folder] = []
                    for music_file in os.listdir(emotion_path):
                        if music_file.lower().endswith('.mp3'):
                            # 存储绝对路径，避免后续工作目录变化导致找不到文件
                            file_path = os.path.abspath(os.path.join(emotion_path, music_file))
                            song_id = f"{emotion_folder}_{music_file[:-4]}"
                            song_info = {
                                'id': song_id,
                                'title': music_file[:-4],
                                'artist': 'Unknown',
                                'emotion_category': emotion_folder,
                                'file_path': file_path,
                                'duration': 0.0,
                                'popularity_score': 0.0
                            }
                            music_library[emotion_folder].append(song_info)
                            # 保存到数据库
                            self.save_song_metadata(song_info)
            self.logger.info(f"音乐库加载完成，共 {sum(len(songs) for songs in music_library.values())} 首歌曲")
            self.logger.info(f"music_library keys: {list(music_library.keys())}")
            for k, v in music_library.items():
                self.logger.info(f"{k}: {len(v)} 首")
        except Exception as e:
            self.logger.error(f"音乐库加载失败: {e}")
        return music_library
    
    def save_song_metadata(self, song_info: Dict):
        """保存歌曲元数据到数据库"""
        try:
            self.cursor.execute('''
                INSERT OR REPLACE INTO music_metadata 
                (song_id, title, artist, emotion_category, file_path, duration, popularity_score)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                song_info['id'],
                song_info['title'],
                song_info['artist'],
                song_info['emotion_category'],
                song_info['file_path'],
                song_info['duration'],
                song_info['popularity_score']
            ))
            self.conn.commit()
        except Exception as e:
            self.logger.error(f"保存歌曲元数据失败: {e}")
    
    def get_recommendations(self, emotion: str, user_id: str = None, 
                          limit: int = 10, mode: str = 'auto') -> List[Dict]:
        """获取音乐推荐"""
        if emotion not in self.music_library:
            return []
        
        available_songs = self.music_library[emotion].copy()
        
        if not available_songs:
            return []
        
        # 根据播放模式排序
        if mode == 'auto':
            # 自动模式：按流行度排序
            available_songs.sort(key=lambda x: x.get('popularity_score', 0), reverse=True)
        else:
            # 手动模式：随机排序
            random.shuffle(available_songs)
        
        return available_songs[:limit]
    
    def record_user_interaction(self, user_id: str, song_id: str, emotion: str, 
                              action: str = None, rating: int = None, play_mode: str = 'auto'):
        """记录用户交互"""
        try:
            # 记录播放历史（包含所有列）
            self.cursor.execute('''
                INSERT INTO play_history 
                (user_id, song_id, emotion, action, rating, play_mode)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (user_id, song_id, emotion, action, rating, play_mode))
            
            # 更新歌曲流行度
            if rating:
                self.cursor.execute('''
                    UPDATE music_metadata 
                    SET popularity_score = popularity_score + ?
                    WHERE song_id = ?
                ''', (rating, song_id))
            
            self.conn.commit()
            
        except Exception as e:
            self.logger.error(f"记录用户交互失败: {e}")
    
    def get_popular_songs(self, emotion: str, limit: int = 5) -> List[Dict]:
        """获取热门歌曲"""
        try:
            self.cursor.execute('''
                SELECT song_id, popularity_score
                FROM music_metadata 
                WHERE emotion_category = ?
                ORDER BY popularity_score DESC
                LIMIT ?
            ''', (emotion, limit))
            
            popular_songs = []
            for row in self.cursor.fetchall():
                song_id, popularity_score = row
                # 从音乐库中获取完整信息
                for songs in self.music_library.values():
                    for song in songs:
                        if song['id'] == song_id:
                            song_copy = song.copy()
                            song_copy['popularity_score'] = popularity_score
                            popular_songs.append(song_copy)
                            break
            
            return popular_songs
            
        except Exception as e:
            self.logger.error(f"获取热门歌曲失败: {e}")
            return []
    
    def get_emotion_description(self, emotion: str) -> str:
        """获取情绪描述"""
        return self.emotion_music_mapping.get(emotion, {}).get('description', '')
    
    def close(self):
        """关闭数据库连接"""
        try:
            # 关闭当前线程的连接
            if hasattr(self._local, 'connection') and self._local.connection:
                self._local.connection.close()
                self._local.connection = None
                self._local.cursor = None
        except Exception as e:
            self.logger.error(f"关闭数据库连接失败: {e}")
    
    def __del__(self):
        """析构函数，确保连接被关闭"""
        self.close() 