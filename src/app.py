from flask import Flask, request, jsonify, send_file
from flask import Response
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import cv2
import numpy as np
import base64
import os
import json
import logging
from datetime import datetime
import uuid
from typing import Dict, List

from emotion_detector import EmotionDetector
from music_recommender import MusicRecommender
from werkzeug.middleware.proxy_fix import ProxyFix

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 限制最大请求体 10MB
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

# 配置CORS，生产环境允许的来源（微信小程序与您的域名）
CORS(app, resources={
    r"/api/*": {
        "origins": [
            "https://www.musicappwx.cn",       # 生产域名（HTTPS）
            "https://musicappwx.cn",           # 不带www的域名
            "https://8.148.78.190",            # 直连IP HTTPS（如配证书）
            "*"                                # 允许所有来源（生产环境建议移除）
        ],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization", "Range"],
        "supports_credentials": True
    }
})

socketio = SocketIO(
    app,
    cors_allowed_origins=[
        "https://www.musicappwx.cn",
        "https://musicappwx.cn",
        "https://8.148.78.190",
        "*"
    ],
    async_mode="threading"
)

# 初始化
emotion_detector = EmotionDetector()
music_recommender = MusicRecommender()

# 全局变量
active_sessions = {}
current_emotion = None
current_song = None

@app.route('/')
def index():
    """主页"""
    return jsonify({
        'message': '情绪识别音乐推荐系统API',
        'version': '1.0.0',
        'status': 'running',
        'server': 'www.musicappwx.cn',
        'environment': 'production'
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查端点，用于运维与负载均衡存活探测"""
    return jsonify({'status': 'ok'})

@app.route('/api/emotions', methods=['GET'])
def get_emotions():
    """获取所有支持的情绪"""
    emotions = emotion_detector.get_all_emotions()
    return jsonify({
        'success': True,
        'emotions': emotions
    })

@app.route('/api/detect-emotion', methods=['POST'])
def detect_emotion():
    """情绪识别接口（支持 JSON base64 与 multipart 文件上传）"""
    try:
        frame = None
        user_id = None
        mode = 'auto'

        content_type = request.headers.get('Content-Type', '')
        if 'multipart/form-data' in content_type and 'file' in request.files:
            file_storage = request.files['file']
            image_bytes = file_storage.read()
            nparr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            user_id = request.form.get('user_id')
            mode = request.form.get('mode', 'auto')
        else:
            data = request.get_json(silent=True) or {}
            image_data = data.get('image')
            user_id = data.get('user_id')
            mode = data.get('mode', 'auto')
            if image_data and isinstance(image_data, str):
                b64_payload = image_data.split(',')[1] if ',' in image_data else image_data
                approx_bytes = int(len(b64_payload) * 3 / 4)
                if approx_bytes > 2 * 1024 * 1024:
                    return jsonify({'success': False, 'error': '图像过大，请降低清晰度后重试'}), 413
                image_bytes = base64.b64decode(b64_payload)
                nparr = np.frombuffer(image_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({'success': False, 'error': '缺少图像数据'}), 400

        emotion, confidence, all_emotions = emotion_detector.detect_emotion(frame)

        recommendations = music_recommender.get_recommendations(
            emotion,
            user_id=user_id,
            limit=5,
            mode=mode
        )

        logger.info(f"情绪: {emotion}, 推荐数量: {len(recommendations)}")

        return jsonify({
            'success': True,
            'emotion': emotion,
            'emotion_name': emotion_detector.get_emotion_name(emotion),
            'confidence': confidence,
            'all_emotions': all_emotions,
            'recommendations': recommendations,
            'description': music_recommender.get_emotion_description(emotion)
        })

    except Exception as e:
        logger.error(f"情绪识别失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/recommendations', methods=['GET'])
def get_recommendations():
    """获取音乐推荐"""
    try:
        emotion = request.args.get('emotion')
        user_id = request.args.get('user_id')
        mode = request.args.get('mode', 'auto')
        limit = int(request.args.get('limit', 10))
        
        if not emotion:
            return jsonify({'success': False, 'error': '缺少情绪参数'}), 400
        
        recommendations = music_recommender.get_recommendations(
            emotion, user_id, limit, mode
        )
        
        return jsonify({
            'success': True,
            'recommendations': recommendations,
            'description': music_recommender.get_emotion_description(emotion)
        })
        
    except Exception as e:
        logger.error(f"获取推荐失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/music/<song_id>', methods=['GET'])
def get_music_file(song_id):
    """获取音乐文件"""
    try:
        # 从数据库获取歌曲信息
        conn, cursor = music_recommender.get_db_connection()
        cursor.execute('SELECT file_path FROM music_metadata WHERE song_id = ?', (song_id,))
        result = cursor.fetchone()
 
        if not result:
            return jsonify({'success': False, 'error': '歌曲不存在'}), 404
 
        file_path = result[0]
        abs_path = os.path.abspath(file_path)
 
        if not os.path.exists(abs_path):
            return jsonify({'success': False, 'error': '文件不存在'}), 404

        # 处理Range请求，支持分段传输
        range_header = request.headers.get('Range', None)
        file_size = os.path.getsize(abs_path)
        if range_header:
            # 例: Range: bytes=0-1023
            try:
                bytes_range = range_header.strip().split('=')[1]
                start_str, end_str = bytes_range.split('-')
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else file_size - 1
                start = max(0, start)
                end = min(file_size - 1, end)
                length = end - start + 1
                with open(abs_path, 'rb') as f:
                    f.seek(start)
                    data = f.read(length)
                rv = Response(data, 206, mimetype='audio/mpeg', direct_passthrough=True)
                rv.headers.add('Content-Range', f'bytes {start}-{end}/{file_size}')
                rv.headers.add('Accept-Ranges', 'bytes')
                rv.headers.add('Content-Length', str(length))
                rv.headers.add('Cache-Control', 'no-cache')
                return rv
            except Exception as e:
                logger.warning(f'Range解析失败，回退到完整文件: {e}')
                # 回退到完整文件
                return send_file(abs_path, mimetype='audio/mpeg')
        # 无Range头，直接完整返回
        return send_file(abs_path, mimetype='audio/mpeg')
 
    except Exception as e:
        logger.error(f"获取音乐文件失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/record-interaction', methods=['POST'])
def record_interaction():
    """记录用户交互"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        song_id = data.get('song_id')
        emotion = data.get('emotion')
        action = data.get('action')
        rating = data.get('rating')
        
        if not all([user_id, song_id, emotion, action]):
            return jsonify({'success': False, 'error': '缺少必要参数'}), 400
        
        music_recommender.record_user_interaction(user_id, song_id, emotion, action, rating)
        
        return jsonify({'success': True, 'message': '记录成功'})
        
    except Exception as e:
        logger.error(f"记录交互失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/popular-songs', methods=['GET'])
def get_popular_songs():
    """获取热门歌曲"""
    try:
        emotion = request.args.get('emotion')
        limit = int(request.args.get('limit', 5))
        
        if not emotion:
            return jsonify({'success': False, 'error': '缺少情绪参数'}), 400
        
        popular_songs = music_recommender.get_popular_songs(emotion, limit)
        
        return jsonify({
            'success': True,
            'popular_songs': popular_songs
        })
        
    except Exception as e:
        logger.error(f"获取热门歌曲失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/user-stats', methods=['GET'])
def get_user_stats():
    """获取用户统计信息"""
    try:
        user_id = request.args.get('user_id')
        
        if not user_id:
            return jsonify({'success': False, 'error': '缺少用户ID'}), 400
        
        conn, cursor = music_recommender.get_db_connection()
        
        # 获取用户播放历史
        cursor.execute('''
            SELECT emotion, COUNT(*) as play_count, AVG(rating) as avg_rating
            FROM play_history 
            WHERE user_id = ?
            GROUP BY emotion
        ''', (user_id,))
        
        emotion_stats = []
        for row in cursor.fetchall():
            emotion_stats.append({
                'emotion': row[0],
                'play_count': row[1],
                'avg_rating': row[2] if row[2] else 0
            })
        
        # 获取用户偏好（注意：这里需要先创建user_preferences表，或者使用现有的play_history表）
        cursor.execute('''
            SELECT emotion, song_id, rating, COUNT(*) as play_count
            FROM play_history 
            WHERE user_id = ? AND rating IS NOT NULL
            GROUP BY emotion, song_id, rating
            ORDER BY rating DESC, play_count DESC
            LIMIT 10
        ''', (user_id,))
        
        preferences = []
        for row in cursor.fetchall():
            preferences.append({
                'emotion': row[0],
                'song_id': row[1],
                'rating': row[2],
                'play_count': row[3]
            })
        
        return jsonify({
            'success': True,
            'emotion_stats': emotion_stats,
            'preferences': preferences
        })
        
    except Exception as e:
        logger.error(f"获取用户统计失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# WebSocket事件处理
@socketio.on('connect')
def handle_connect():
    """客户端连接"""
    session_id = str(uuid.uuid4())
    active_sessions[session_id] = {
        'user_id': None,
        'current_emotion': None,
        'current_song': None,
        'connected_at': datetime.now()
    }
    emit('session_created', {'session_id': session_id})

@socketio.on('disconnect')
def handle_disconnect():
    """客户端断开连接"""
    session_id = request.sid
    if session_id in active_sessions:
        del active_sessions[session_id]

@socketio.on('start_session')
def handle_start_session(data):
    """开始会话"""
    session_id = request.sid
    user_id = data.get('user_id')
    
    if session_id in active_sessions:
        active_sessions[session_id]['user_id'] = user_id
        emit('session_started', {'user_id': user_id})

@socketio.on('emotion_detected')
def handle_emotion_detected(data):
    """处理情绪检测结果"""
    session_id = request.sid
    emotion = data.get('emotion')
    confidence = data.get('confidence')
    
    if session_id in active_sessions:
        active_sessions[session_id]['current_emotion'] = emotion
        
        # 获取推荐
        recommendations = music_recommender.get_recommendations(
            emotion, 
            user_id=active_sessions[session_id]['user_id'],
            limit=3
        )
        
        emit('recommendations_updated', {
            'emotion': emotion,
            'confidence': confidence,
            'recommendations': recommendations
        })

@socketio.on('song_selected')
def handle_song_selected(data):
    """处理歌曲选择"""
    session_id = request.sid
    song_id = data.get('song_id')
    
    if session_id in active_sessions:
        active_sessions[session_id]['current_song'] = song_id
        
        # 记录用户交互
        user_id = active_sessions[session_id]['user_id']
        emotion = active_sessions[session_id]['current_emotion']
        
        if user_id and emotion:
            music_recommender.record_user_interaction(
                user_id, song_id, emotion, 'play'
            )

@socketio.on('rating_submitted')
def handle_rating_submitted(data):
    """处理评分提交"""
    session_id = request.sid
    song_id = data.get('song_id')
    rating = data.get('rating')
    
    if session_id in active_sessions:
        user_id = active_sessions[session_id]['user_id']
        emotion = active_sessions[session_id]['current_emotion']
        
        if user_id and emotion:
            music_recommender.record_user_interaction(
                user_id, song_id, emotion, 'rating', rating
            )
            
            emit('rating_recorded', {'success': True})

if __name__ == '__main__':
    try:
        logger.info("启动情绪识别音乐推荐系统（生产/面板可用运行方式）...")
        # 生产单机直跑（如不使用uWSGI），建议由Nginx反向代理到该端口
        # 若在宝塔使用Python项目管理（uWSGI/Wsgi方式），请配置运行文件与callable=app，
        # 此处不会被执行。
        socketio.run(app, host='0.0.0.0', port=8000, debug=False)
    except KeyboardInterrupt:
        logger.info("系统关闭中...")
        music_recommender.close()
    except Exception as e:
        logger.error(f"系统启动失败: {e}")
        music_recommender.close()