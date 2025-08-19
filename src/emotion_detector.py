import cv2
from fer import FER
import numpy as np

class EmotionDetector:
    """基于 OpenCV + FER 的智能情绪识别器"""
    def __init__(self, use_mtcnn=False):
        self.detector = FER(mtcnn=use_mtcnn)
        self.emotions = [
            'angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral'
        ]

    def detect_emotion(self, frame: np.ndarray):
        results = self.detector.detect_emotions(frame)
        if not results:
            return 'neutral', 0.0, {'neutral': 1.0}
        face = max(results, key=lambda x: x['box'][2] * x['box'][3])
        emotions = face['emotions']
        dominant_emotion = max(emotions, key=emotions.get)
        confidence = emotions[dominant_emotion]
        return dominant_emotion, confidence, emotions

    def get_emotion_name(self, emotion_code: str) -> str:
        mapping = {
            'angry': '愤怒', 'disgust': '厌恶', 'fear': '恐惧',
            'happy': '快乐', 'sad': '悲伤', 'surprise': '惊讶', 'neutral': '中性'
        }
        return mapping.get(emotion_code, emotion_code)

    def get_all_emotions(self):
        return self.emotions 