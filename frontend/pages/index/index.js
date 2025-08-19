// pages/index/index.js
const app = getApp()

Page({
  data: {
    // 页面状态
    currentPage: 'home', // home, camera, music, rating, report
    
    // 用户信息
    userInfo: null,
    
    // 情绪识别相关
    isDetecting: false,
    currentEmotion: null,
    emotionName: '',
    confidence: 0,
    confidenceText: '0.0',
    emotionDescription: '',
    
    // 检测进度相关
    detectionProgress: 0, // 0-100
    detectionTime: 0, // 当前检测时间（秒）
    totalDetectionTime: 5, // 总检测时间（秒）
    emotionResults: [], // 存储检测结果
    emotionStats: {}, // 情绪统计
    
    // 音乐推荐相关
    recommendations: [],
    currentSong: null,
    isPlaying: false,
    playMode: 'auto', // auto, manual
    
    // 评分相关
    showRating: false,
    currentRating: 0,
    
    // UI状态
    loading: false,
    errorMessage: '',
    
    // 动画状态
    animationClass: '',
    
    // 测试数据
    testEmotions: ['happy', 'sad', 'angry', 'neutral', 'surprise', 'fear', 'disgust', 'anxiety', 'excited', 'calm'],
    emotionChart: null, // ec-canvas配置
    topEmotionStats: [], // 前5种情绪
    showCountdown: false,
    countdownNum: 3,
    // 推荐加载骨架屏
    isRecoLoading: false,
    skeletonArray: [1,2,3,4,5],
  },

  onLoad() {
    // 设置当前页面引用
    app.globalData.currentPage = this;
    // 自动获取微信用户信息
    wx.getUserProfile({
      desc: '用于情绪波动记录',
      success: (res) => {
        app.globalData.userInfo = res.userInfo;
        wx.setStorageSync('userInfo', res.userInfo);
        this.setData({ userInfo: res.userInfo });
      },
      fail: () => {
        // 未授权时用匿名头像
        this.setData({ userInfo: null });
      }
    });
    // 添加页面加载动画
    this.addAnimation('fade-in');
    // 粒子系统改到 onReady 初始化，确保 canvas 已渲染
  },

  

  onShow() {
    // 页面显示时更新数据
    this.updatePageData();
  },

  updatePageData() {
    // 更新页面数据
    this.setData({
      currentEmotion: app.globalData.currentEmotion,
      recommendations: app.globalData.recommendations || []
    });
  },

  // 添加动画效果
  addAnimation(className) {
    this.setData({
      animationClass: className
    });
    
    setTimeout(() => {
      this.setData({
        animationClass: ''
      });
    }, 500);
  },

  // 页面切换动画
  switchPage(pageName) {
    this.addAnimation('slide-left');
    
    setTimeout(() => {
      this.setData({
        currentPage: pageName
      });
      this.addAnimation('slide-right');
    }, 300);
  },

  // 点击开始体验
  startExperience() {
    // 立即切换到摄像头页面
    this.switchPage('camera');
    // 显示倒计时弹窗
    this.setData({
      showCountdown: true,
      countdownNum: 3
    });
    this.startCountdown();
  },

  // 3秒倒计时
  startCountdown() {
    let num = 3;
    this.setData({ countdownNum: num });
    this.countdownTimer = setInterval(() => {
      num--;
      if (num > 0) {
        this.setData({ countdownNum: num });
      } else {
        clearInterval(this.countdownTimer);
        this.setData({ showCountdown: false });
        // 倒计时结束后再开始检测
        this.startEmotionDetection();
      }
    }, 1000);
  },

  // 开始情绪检测
  startEmotionDetection() {
    this.setData({
      isDetecting: true,
      loading: false,
      detectionProgress: 0,
      detectionTime: 0,
      emotionResults: [],
      emotionStats: {}
    });
    
    // 延迟启动检测，给相机一些时间初始化
    setTimeout(() => {
      this.startDetectionTimer();
    }, 1000);
    
    this.switchPage('camera');
  },

  // 开始检测计时器
  startDetectionTimer() {
    const timer = setInterval(() => {
      const currentTime = this.data.detectionTime + 1;
      const progress = (currentTime / this.data.totalDetectionTime) * 100;
      
      this.setData({
        detectionTime: currentTime,
        detectionProgress: progress
      });
      
      // 执行一次检测
      this.detectEmotionOnce();
      
      // 检测时间结束
      if (currentTime >= this.data.totalDetectionTime) {
        clearInterval(timer);
        this.finishDetection();
      }
    }, 1000);
  },

  // 单次情绪检测
  detectEmotionOnce() {
    if (!this.data.isDetecting) return;
    
    // 获取相机画面
    const ctx = wx.createCameraContext();
    ctx.takePhoto({
      quality: 'low',
      success: (res) => {
        this.processEmotionDetectionOnce(res.tempImagePath);
      },
      fail: (error) => {
        console.log('拍照失败:', error);
        // 使用测试数据
        this.addTestEmotionResult();
      }
    });
  },

  // 处理单次情绪检测
  async processEmotionDetectionOnce(imagePath) {
    // 先压缩，优先使用上传文件接口，失败再回退 base64
    wx.compressImage({
      src: imagePath,
      quality: 40,
      success: (cres) => {
        const compressedPath = cres.tempFilePath || imagePath;
        this.detectEmotionUploadFile(compressedPath);
      },
      fail: () => {
        this.detectEmotionUploadFile(imagePath);
      }
    });
  },

  // 使用上传文件接口调用后端API（multipart/form-data）
  detectEmotionUploadFile(filePath) {
    const userId = this.getOrCreateUserId();
    wx.uploadFile({
      url: app.globalData.serverUrl + '/api/detect-emotion',
      filePath,
      name: 'file',
      formData: { user_id: userId, mode: this.data.playMode || 'auto' },
      success: (res) => {
        try {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (data && data.success && data.emotion) {
            this.addEmotionResult(data.emotion, data.confidence);
            this.setData({
              currentEmotion: data.emotion,
              emotionName: this.getEmotionName(data.emotion),
              confidence: data.confidence,
              confidenceText: (data.confidence * 100).toFixed(1),
              recommendations: data.recommendations || [],
              isRecoLoading: false
            });
            return;
          }
        } catch (e) {}
        // 回退到 base64 方案
        this.readAsBase64AndDetect(filePath);
      },
      fail: () => {
        // 回退到 base64 方案
        this.readAsBase64AndDetect(filePath);
      }
    });
  },

  readAsBase64AndDetect(filePath) {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: res => {
        const base64Img = 'data:image/jpeg;base64,' + res.data;
        this.detectEmotionBase64(base64Img);
      },
      fail: err => {
        console.log('图片转base64失败:', err);
        this.addTestEmotionResult();
      }
    });
  },

  // 用base64图片调用后端API
  detectEmotionBase64(base64Img) {
    wx.request({
      url: app.globalData.serverUrl + '/api/detect-emotion',
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { image: base64Img },
      timeout: 60000,
      success: (res) => {
        if (res.statusCode === 200 && res.data && res.data.emotion) {
          this.addEmotionResult(res.data.emotion, res.data.confidence);
          this.setData({
            currentEmotion: res.data.emotion,
            emotionName: this.getEmotionName(res.data.emotion),
            confidence: res.data.confidence,
            confidenceText: (res.data.confidence * 100).toFixed(1),
            recommendations: res.data.recommendations || [],
            isRecoLoading: false
          });
        } else {
          this.addTestEmotionResult();
        }
      },
      fail: (err) => {
        console.log('情绪检测失败:', err);
        this.addTestEmotionResult();
      }
    });
  },

  // 添加情绪检测结果
  addEmotionResult(emotion, confidence) {
    const results = [...this.data.emotionResults];
    results.push({
      emotion: emotion,
      confidence: confidence,
      timestamp: Date.now()
    });
    
    this.setData({
      emotionResults: results
    });
  },

  // 添加测试情绪结果
  addTestEmotionResult() {
    const randomEmotion = this.data.testEmotions[Math.floor(Math.random() * this.data.testEmotions.length)];
    const confidence = 0.6 + Math.random() * 0.4;
    
    this.addEmotionResult(randomEmotion, confidence);
    
    this.setData({
      currentEmotion: randomEmotion,
      emotionName: this.getEmotionName(randomEmotion),
      confidence: confidence,
      confidenceText: (confidence * 100).toFixed(1)
    });
  },

  // 完成检测
  finishDetection() {
    this.setData({
      isDetecting: false
    });
    // 计算情绪统计
    this.calculateEmotionStats();
    // 处理前5种情绪
    this.processTopEmotions();
    // 记录历史
    this.saveEmotionHistory();
    // 跳转到报告页面
    this.switchPage('report');
    // 延迟初始化原生canvas图表，确保页面已渲染
    setTimeout(() => {
      this.drawEmotionPie();
    }, 300);
  },

  // 绘制原生canvas环形图
  drawEmotionPie() {
    const ctx = wx.createCanvasContext('emotionPie', this);
    const stats = this.data.topEmotionStats;
    const keys = Object.keys(stats);
    if (!keys.length) return;
    // 蓝绿色系清新配色
    const colors = ['#1abc9c', '#16a085', '#48c9b0', '#76d7c4', '#5dade2', '#85c1e9', '#2ecc71', '#27ae60'];
    // 计算总数
    const total = keys.reduce((sum, k) => sum + parseInt(stats[k].count), 0);
    // 绘制环形
    let start = -Math.PI/2;
    const outerR = 60; // 外圆半径
    const innerR = 30;  // 内圆半径
    const labelR = 70; // 名称半径
    const centerX = 100, centerY = 100;
    keys.forEach((k, i) => {
      const percent = stats[k].count / total;
      const end = start + percent * Math.PI * 2;
      ctx.setFillStyle(colors[i % colors.length]);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, outerR, start, end);
      ctx.closePath();
      ctx.fill();
      start = end;
    });
    // 绘制白色中空
    ctx.setFillStyle('#fff');
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    // 绘制情绪名称（在扇区外侧）
    start = -Math.PI/2;
    keys.forEach((k, i) => {
      const percent = stats[k].count / total;
      const end = start + percent * Math.PI * 2;
      const mid = start + (end - start) / 2;
      // 名称绘制在外圆弧延长线上
      const x = centerX + Math.cos(mid) * labelR;
      const y = centerY + Math.sin(mid) * labelR;
      ctx.setFontSize(15);
      ctx.setFillStyle(colors[i % colors.length]);
      ctx.setTextAlign('center');
      ctx.setTextBaseline('middle');
      // 增加白色描边提升可读性
      ctx.setStrokeStyle('#fff');
      ctx.setLineWidth(4);
      ctx.strokeText(this.getEmotionName(k), x, y);
      ctx.setLineWidth(1);
      ctx.fillText(this.getEmotionName(k), x, y);
      start = end;
    });
    ctx.draw();
  },

  // 记录历史情绪
  saveEmotionHistory() {
    const stats = this.data.topEmotionStats;
    const mainEmotion = Object.keys(stats)[0] || 'neutral';
    const mainEmotionName = this.getEmotionName(mainEmotion);
    const date = this.formatDate(new Date());
    const record = {
      date,
      mainEmotion,
      mainEmotionName,
      stats: stats
    };
    let history = wx.getStorageSync('emotionHistory') || [];
    history.push(record);
    wx.setStorageSync('emotionHistory', history);
  },

  // 日期格式化
  formatDate(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  // 计算情绪统计
  calculateEmotionStats() {
    const results = this.data.emotionResults;
    const stats = {};
    
    results.forEach(result => {
      if (!stats[result.emotion]) {
        stats[result.emotion] = {
          count: 0,
          totalConfidence: 0
        };
      }
      stats[result.emotion].count++;
      stats[result.emotion].totalConfidence += result.confidence;
    });
    
    // 计算平均置信度和百分比
    const totalCount = results.length;
    const emotionStats = {};
    
    Object.keys(stats).forEach(emotion => {
      const avgConfidence = stats[emotion].totalConfidence / stats[emotion].count;
      const percentage = (stats[emotion].count / totalCount) * 100;
      
      emotionStats[emotion] = {
        count: stats[emotion].count,
        percentage: percentage.toFixed(1),
        avgConfidence: (avgConfidence * 100).toFixed(1)
      };
    });
    
    this.setData({
      emotionStats: emotionStats
    });
  },

  // 处理前5种情绪
  processTopEmotions() {
    const stats = this.data.emotionStats;
    // 转为数组并排序
    let arr = Object.keys(stats).map(emotion => ({
      emotion,
      ...stats[emotion]
    }));
    arr.sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage));
    // 只取前5
    arr = arr.slice(0, 5);
    // 重新计算百分比
    const total = arr.reduce((sum, item) => sum + item.count, 0);
    arr = arr.map(item => ({
      ...item,
      percentage: ((item.count / total) * 100).toFixed(1)
    }));
    // 转为对象，便于wxml遍历
    const topStats = {};
    arr.forEach(item => {
      topStats[item.emotion] = item;
    });
    this.setData({
      topEmotionStats: topStats
    });
  },

  // 初始化ECharts环形图
  initEmotionChart() {
    const that = this;
    const stats = this.data.topEmotionStats;
    const legend = Object.keys(stats).map(e => that.getEmotionName(e));
    const data = Object.keys(stats).map(e => ({
      value: parseFloat(stats[e].percentage),
      name: that.getEmotionName(e)
    }));
    this.setData({
      emotionChart: {
        onInit: function (canvas, width, height, dpr) {
          const ec = require('../../ec-canvas/echarts');
          const chart = ec.init(canvas, null, { width, height, devicePixelRatio: dpr });
          const option = {
            tooltip: { trigger: 'item', formatter: '{b}: {d}% ({c}次)' },
            legend: { orient: 'vertical', left: 'right', data: legend },
            series: [{
              name: '情绪占比',
              type: 'pie',
              radius: ['60%', '80%'],
              avoidLabelOverlap: false,
              label: { show: true, position: 'center', formatter: '{b}\n{d}%', fontSize: 18 },
              emphasis: { label: { show: true, fontSize: 22, fontWeight: 'bold' } },
              labelLine: { show: false },
              data: data
            }]
          };
          chart.setOption(option);
          return chart;
        }
      }
    });
  },

  // 情绪检测循环
  detectEmotionLoop() {
    if (!this.data.isDetecting) return;
    
    // 获取相机画面
    const ctx = wx.createCameraContext();
    ctx.takePhoto({
      quality: 'low',
      success: (res) => {
        this.processEmotionDetection(res.tempImagePath);
      },
      fail: (error) => {
        console.log('拍照失败:', error);
        // 继续检测
        setTimeout(() => {
          this.detectEmotionLoop();
        }, 2000);
      }
    });
  },

  // 使用测试情绪
  useTestEmotion() {
    const randomEmotion = this.data.testEmotions[Math.floor(Math.random() * this.data.testEmotions.length)];
    const confidence = 0.7 + Math.random() * 0.3;
    
    this.setData({
      currentEmotion: randomEmotion,
      emotionName: this.getEmotionName(randomEmotion),
      confidence: confidence,
      confidenceText: (confidence * 100).toFixed(1),
      emotionDescription: this.getEmotionDescription(randomEmotion)
    });
    
    // 获取音乐推荐
    this.getMusicRecommendations(randomEmotion);
    
    // 显示提示
    wx.showToast({
      title: '测试模式已启用',
      icon: 'success',
      duration: 2000
    });
    
    // 延迟显示推荐数据
    setTimeout(() => {
      console.log('当前推荐数据:', this.data.recommendations);
    }, 1000);
  },

  // 获取情绪名称
  getEmotionName(emotion) {
    const emotionNames = {
      'happy': '快乐',
      'sad': '悲伤',
      'angry': '愤怒',
      'neutral': '中性',
      'surprise': '惊讶',
      'fear': '恐惧',
      'disgust': '厌恶',
      'anxiety': '焦虑',
      'excited': '兴奋',
      'calm': '平静'
    };
    return emotionNames[emotion] || emotion;
  },

  // 获取情绪描述
  getEmotionDescription(emotion) {
    const descriptions = {
      'happy': '您看起来很开心，为您推荐轻快愉悦的音乐',
      'sad': '您似乎有些低落，为您推荐温暖治愈的音乐',
      'angry': '您看起来有些生气，为您推荐舒缓放松的音乐',
      'neutral': '您看起来很平静，为您推荐平衡舒适的音乐',
      'surprise': '您看起来有些惊讶，为您推荐新奇有趣的音乐',
      'fear': '您似乎有些紧张，为您推荐安全温暖的音乐',
      'disgust': '您看起来有些不适，为您推荐清新纯净的音乐',
      'anxiety': '您似乎有些焦虑，为您推荐放松平静的音乐',
      'excited': '您看起来很兴奋，为您推荐活力激情的音乐',
      'calm': '您看起来很平静，为您推荐宁静和谐的音乐'
    };
    return descriptions[emotion] || '为您推荐适合的音乐';
  },

  // 处理情绪检测
  async processEmotionDetection(imageData) {
    try {
      // 调用后端API
      const result = await this.detectEmotion(imageData);
      
      this.setData({
        currentEmotion: result.emotion,
        emotionName: this.getEmotionName(result.emotion),
        confidence: result.confidence,
        confidenceText: (result.confidence * 100).toFixed(1),
        emotionDescription: this.getEmotionDescription(result.emotion)
      });
      
      // 优先使用检测接口返回的推荐，避免重复请求
      if (result && Array.isArray(result.recommendations) && result.recommendations.length > 0) {
        this.setData({ recommendations: result.recommendations, isRecoLoading: false });
      } else {
        this.getMusicRecommendations(result.emotion);
      }
      
      // 添加成功动画
      this.addAnimation('bounce');
      
    } catch (error) {
      console.log('情绪检测失败:', error);
      // 使用测试数据
      this.useTestEmotion();
    }
    
    // 继续检测
    setTimeout(() => {
      this.detectEmotionLoop();
    }, 3000);
  },

  // 情绪检测API调用
  detectEmotion(imageData) {
    const userId = this.getOrCreateUserId();
    return new Promise((resolve, reject) => {
      // 已是 base64 的场景：data:image/xxx;base64,...
      if (typeof imageData === 'string' && imageData.indexOf('data:image') === 0) {
        wx.request({
          url: app.globalData.serverUrl + '/api/detect-emotion',
          method: 'POST',
          header: { 'content-type': 'application/json' },
          data: { image: imageData, user_id: userId, mode: this.data.playMode || 'auto' },
          timeout: 60000,
          success: (res) => res.statusCode === 200 ? resolve(res.data) : reject(res),
          fail: reject
        });
        return;
      }
  
      // 否则当作文件路径上传（推荐）
      wx.uploadFile({
        url: app.globalData.serverUrl + '/api/detect-emotion',
        filePath: imageData,
        name: 'file',
        formData: { user_id: userId, mode: this.data.playMode || 'auto' },
        success: (res) => {
          try {
            const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            return data && data.success ? resolve(data) : reject(data || res);
          } catch (e) {
            reject(e);
          }
        },
        fail: reject
      });
    });
  },

  // 获取音乐推荐
  async getMusicRecommendations(emotion) {
    try {
      this.setData({ isRecoLoading: true });
      const resp = await this.getRecommendations(emotion, this.data.playMode);
      const list = (resp && (resp.recommendations || resp.songs)) || [];
      console.log('规范化后的推荐列表:', list);
      this.setData({
        recommendations: list,
        isRecoLoading: false
      });
      if (this.data.playMode === 'auto' && list.length > 0) {
        this.playMusic(list[0]);
      }
    } catch (error) {
      console.log('获取音乐推荐失败:', error);
      const testRecommendations = [
        { id: 1, title: '快乐时光', artist: '快乐乐队', emotion: emotion, file_path: 'happy1.mp3' },
        { id: 2, title: '阳光明媚', artist: '阳光组合', emotion: emotion, file_path: 'happy2.mp3' },
        { id: 3, title: '心情愉悦', artist: '愉悦乐团', emotion: emotion, file_path: 'happy3.mp3' },
        { id: 4, title: '轻松一刻', artist: '轻松音乐', emotion: emotion, file_path: 'happy4.mp3' },
        { id: 5, title: '美好时光', artist: '美好乐队', emotion: emotion, file_path: 'happy5.mp3' }
      ];
      console.log('设置测试推荐数据:', testRecommendations);
      this.setData({
        recommendations: testRecommendations,
        isRecoLoading: false
      });
      wx.showToast({
        title: '已加载测试音乐',
        icon: 'success',
        duration: 1500
      });
    }
  },

  // 获取推荐API调用
  getRecommendations(emotion, mode) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: app.globalData.serverUrl + '/api/recommendations',
        method: 'GET',
        header: { 'content-type': 'application/json' },
        data: {
          emotion: emotion,
          mode: mode,
          limit: 10,
          user_id: this.getOrCreateUserId()
        },
        timeout: 30000,
        success: (res) => {
          if (res.statusCode === 200) {
            resolve(res.data);
          } else {
            reject(res);
          }
        },
        fail: (err) => {
          console.log('API请求失败:', err);
          reject(err);
        }
      });
    });
  },

  // 跳转到音乐页面
  goToMusic() {
    // 如果没有推荐数据，尝试重新获取
    if (this.data.recommendations.length === 0 && this.data.currentEmotion) {
      console.log('重新获取推荐数据');
      this.setData({ isRecoLoading: true });
      this.getMusicRecommendations(this.data.currentEmotion);
    }
    
    this.switchPage('music');
  },

  // 跳转到推荐页面
  goToRecommendations() {
    // 获取主要情绪（占比最高的）
    const stats = this.data.emotionStats;
    let mainEmotion = 'neutral';
    let maxPercentage = 0;
    
    Object.keys(stats).forEach(emotion => {
      if (parseFloat(stats[emotion].percentage) > maxPercentage) {
        maxPercentage = parseFloat(stats[emotion].percentage);
        mainEmotion = emotion;
      }
    });
    
    this.setData({
      currentEmotion: mainEmotion,
      emotionName: this.getEmotionName(mainEmotion),
      emotionDescription: this.getEmotionDescription(mainEmotion)
    });
    
    // 获取音乐推荐
    this.getMusicRecommendations(mainEmotion);
    
    // 跳转到音乐页面
    this.switchPage('music');
  },

  // 播放音乐
  playMusic(song) {
    // 初始化音频上下文
    if (!this.innerAudioContext) {
      this.innerAudioContext = wx.createInnerAudioContext();
      this.innerAudioContext.obeyMuteSwitch = false;
      this.innerAudioContext.autoplay = true;
      this.innerAudioContext.onEnded(() => {
        this.playNextSong();
      });
      this.innerAudioContext.onError((e) => {
        console.log('音频播放错误，尝试下载后播放:', e);
        if (this.data.currentSong) {
          const fallbackUrl = `${app.globalData.serverUrl}/api/music/${this.data.currentSong.id}`;
          this.playFromDownloadedFile(fallbackUrl);
        }
      });
    }

    const audioUrl = `${app.globalData.serverUrl}/api/music/${song.id}`;
    // 直接网络播放
    this.innerAudioContext.src = audioUrl;
    this.innerAudioContext.play();

    this.setData({
      currentSong: song,
      isPlaying: true
    });

    // 记录播放行为
    this.recordInteraction(song.id, this.data.currentEmotion, 'play');

    console.log('播放音乐:', song.title, audioUrl);
    this.addAnimation('bounce');
  },

  // 下载到本地临时文件再播放（用于HTTP或域名限制场景）
  playFromDownloadedFile(url) {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.tempFilePath && this.innerAudioContext) {
          this.innerAudioContext.src = res.tempFilePath;
          this.innerAudioContext.play();
          console.log('已使用本地临时文件播放:', res.tempFilePath);
        }
      },
      fail: (e) => {
        console.log('下载音频失败:', e);
        wx.showToast({ title: '无法播放音频', icon: 'none' });
      }
    });
  },

  // 播放下一首
  playNextSong() {
    const currentIndex = this.data.recommendations.findIndex(song => song.id === this.data.currentSong?.id);
    const nextIndex = (currentIndex + 1) % this.data.recommendations.length;
    const nextSong = this.data.recommendations[nextIndex];

    if (nextSong) {
      this.playMusic(nextSong);
    }
  },

  // 切换播放状态
  togglePlay() {
    const audio = this.innerAudioContext;
    if (!audio) {
      if (this.data.currentSong) {
        this.playMusic(this.data.currentSong);
      }
      return;
    }

    if (this.data.isPlaying) {
      audio.pause();
      console.log('暂停播放');
    } else {
      audio.play();
      console.log('继续播放');
    }
    this.setData({
      isPlaying: !this.data.isPlaying
    });
  },

  // 切换播放模式
  switchPlayMode() {
    const newMode = this.data.playMode === 'auto' ? 'manual' : 'auto';
    this.setData({
      playMode: newMode
    });
    
    // 显示模式切换提示
    wx.showToast({
      title: newMode === 'auto' ? '已切换为自动播放' : '已切换为手动选择',
      icon: 'success',
      duration: 1500
    });
  },

  // 选择歌曲
  selectSong(e) {
    const song = e.currentTarget.dataset.song;
    this.playMusic(song);
  },

  // 结束体验
  endExperience() {
    if (this.data.currentSong) {
      this.setData({
        currentPage: 'rating',
        showRating: true
      });
    } else {
      this.goHome();
    }
  },

  // 评分变化
  onRatingChange(e) {
    const rating = parseInt(e.currentTarget.dataset.value);
    this.setData({
      currentRating: rating
    });
  },

  // 提交评分
  async submitRating() {
    if (this.data.currentRating <= 0) {
      wx.showToast({
        title: '请选择评分',
        icon: 'none'
      });
      return;
    }
    
    try {
      // 记录评分
      await this.recordInteraction(
        this.data.currentSong.id, 
        this.data.currentEmotion, 
        'rating', 
        this.data.currentRating
      );
      
      wx.showToast({
        title: '评分提交成功',
        icon: 'success'
      });
      
      // 延迟返回首页
      setTimeout(() => {
        this.goHome();
      }, 1500);
      
    } catch (error) {
      console.log('评分提交失败:', error);
      wx.showToast({
        title: '评分提交失败',
        icon: 'error'
      });
    }
  },

  // 记录交互API调用
  recordInteraction(songId, emotion, action, rating = null) {
    const userId = this.getOrCreateUserId();
    return new Promise((resolve, reject) => {
      wx.request({
        url: app.globalData.serverUrl + '/api/record-interaction',
        method: 'POST',
        header: { 'content-type': 'application/json' },
        data: {
          user_id: userId,
          song_id: songId,
          emotion: emotion,
          action: action,
          rating: rating
        },
        success: (res) => {
          if (res.statusCode === 200) {
            resolve(res.data);
          } else {
            reject(res);
          }
        },
        fail: (err) => {
          console.log('API请求失败:', err);
          reject(err);
        }
      });
    });
  },

  // 获取或创建用户ID，缓存到本地
  getOrCreateUserId() {
    let uid = wx.getStorageSync('userId');
    if (!uid) {
      uid = `u-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      wx.setStorageSync('userId', uid);
    }
    return uid;
  },

  // 取消评分
  cancelRating() {
    this.setData({
      currentPage: 'music',
      showRating: false,
      currentRating: 0
    });
  },

  // 返回首页
  goHome() {
    // 停止播放
    if (this.innerAudioContext) {
      try { this.innerAudioContext.stop(); } catch (e) {}
      this.setData({ isPlaying: false, currentSong: null });
    }
    this.setData({
      currentPage: 'home',
      isDetecting: false,
      currentEmotion: null,
      emotionName: '',
      confidence: 0,
      confidenceText: '0.0',
      emotionDescription: '',
      detectionProgress: 0,
      detectionTime: 0,
      emotionResults: [],
      emotionStats: {},
      recommendations: [],
      currentSong: null,
      isPlaying: false,
      showRating: false,
      currentRating: 0,
      loading: false,
      errorMessage: '',
      emotionChart: null, // 清除图表
      topEmotionStats: [] // 清除前5情绪
    });
    
    this.addAnimation('fade-in');
  },

  // 更新推荐列表
  updateRecommendations(data) {
    this.setData({
      currentEmotion: data.emotion,
      recommendations: data.recommendations || []
    });
  },

  onUnload() {
    // 页面卸载时停止检测
    this.setData({
      isDetecting: false
    });

    // 释放音频资源
    if (this.innerAudioContext) {
      try { this.innerAudioContext.stop(); } catch (e) {}
      this.innerAudioContext.destroy();
      this.innerAudioContext = null;
    }
  },

  goUserCenter() {
    wx.navigateTo({ url: '/pages/user/user' });
  }
}) 