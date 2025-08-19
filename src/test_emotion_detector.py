#!/usr/bin/env python3
"""
测试 OpenCV 情绪检测器
"""

import cv2
import numpy as np
import os
from emotion_detector import EmotionDetector

def test_emotion_detector():
    detector = EmotionDetector()
    img = np.ones((480, 640, 3), dtype=np.uint8) * 128
    emotion, confidence, all_emotions = detector.detect_emotion(img)
    print('主要情绪:', emotion, '置信度:', confidence)
    print('所有情绪概率:', all_emotions)

if __name__ == '__main__':
    test_emotion_detector()
