## 情绪音乐后端 API 参考

可用于前端（微信小程序）快速对接。包含请求方式、参数、成功/失败响应示例，以及 curl / wx.request 示例。

- 生产环境 BASE_URL: `https://www.musicappwx.cn`
- 通用请求头: `Content-Type: application/json`

---

### 0) 服务信息与健康检查

- GET `/`
  - 说明: 服务信息
  - 200 示例:
    ```json
    {"message":"情绪识别音乐推荐系统API","version":"1.0.0","status":"running","server":"www.musicappwx.cn","environment":"production"}
    ```

- GET `/api/health`
  - 说明: 健康检查
  - 200 示例:
    ```json
    {"status":"ok"}
    ```

---

### 1) 获取支持的情绪

- GET `/api/emotions`
  - 说明: 返回所有支持的情绪字典（代码 -> 中文名）
  - 200 示例:
    ```json
    {
      "success": true,
      "emotions": {
        "happy": "快乐",
        "sad": "悲伤",
        "angry": "愤怒",
        "neutral": "中性",
        "surprise": "惊讶",
        "fear": "恐惧",
        "disgust": "厌恶",
        "anxiety": "焦虑",
        "excited": "兴奋",
        "calm": "平静"
      }
    }
    ```
  - curl:
    ```bash
    curl -s "$BASE_URL/api/emotions"
    ```
  - wx.request:
    ```js
    wx.request({ url: `${BASE_URL}/api/emotions`, method: 'GET', success: console.log })
    ```

---

### 2) 情绪识别（Base64 图片）

- POST `/api/detect-emotion`
  - 说明: 传入 Base64 图片进行情绪识别，并返回推荐歌曲
  - 请求体 JSON:
    - `image` string 必填: `data:image/jpeg;base64,xxxxx`
    - `user_id` string 可选
    - `mode` string 可选: `auto` | `manual` (默认 `auto`)
  - 200 示例:
    ```json
    {
      "success": true,
      "emotion": "happy",
      "emotion_name": "快乐",
      "confidence": 0.91,
      "all_emotions": {"happy":0.91,"sad":0.02,"angry":0.01,"neutral":0.03},
      "recommendations": [
        {"id":"happy_song1","title":"Song A","artist":"Unknown","emotion_category":"happy","file_path":"/abs/path/a.mp3","duration":0.0,"popularity_score":0.0}
      ],
      "description": "快乐情绪推荐轻快、节奏明快的音乐"
    }
    ```
  - 400 示例（缺少图像）:
    ```json
    {"success": false, "error": "缺少图像数据"}
    ```
  - 500 示例:
    ```json
    {"success": false, "error": "internal error message"}
    ```
  - curl:
    ```bash
    curl -s -X POST "$BASE_URL/api/detect-emotion" \
      -H 'Content-Type: application/json' \
      -d '{"image":"data:image/jpeg;base64,XXXX","user_id":"u-1","mode":"auto"}'
    ```
  - wx.request:
    ```js
    wx.request({
      url: `${BASE_URL}/api/detect-emotion`,
      method: 'POST',
      data: { image: base64Img, user_id, mode: 'auto' },
      success: console.log
    })
    ```

---

### 3) 获取音乐推荐

- GET `/api/recommendations`
  - 说明: 根据情绪获取推荐歌曲列表
  - 查询参数:
    - `emotion` string 必填
    - `user_id` string 可选
    - `mode` string 可选: `auto` | `manual`（默认 `auto`）
    - `limit` int 可选（默认 10）
  - 200 示例:
    ```json
    {
      "success": true,
      "recommendations": [
        {"id":"happy_song1","title":"Song A","artist":"Unknown","emotion_category":"happy","file_path":"/abs/path/a.mp3","duration":0.0,"popularity_score":0.0}
      ],
      "description": "快乐情绪推荐轻快、节奏明快的音乐"
    }
    ```
  - 400 示例（缺少情绪）:
    ```json
    {"success": false, "error": "缺少情绪参数"}
    ```
  - 500 示例:
    ```json
    {"success": false, "error": "internal error message"}
    ```
  - curl:
    ```bash
    curl -s "$BASE_URL/api/recommendations?emotion=happy&mode=auto&limit=5"
    ```
  - wx.request:
    ```js
    wx.request({
      url: `${BASE_URL}/api/recommendations`,
      method: 'GET',
      data: { emotion: 'happy', mode: 'auto', limit: 10 },
      success: console.log
    })
    ```

---

### 4) 获取音乐文件（支持 Range）

- GET `/api/music/{song_id}`
  - 说明: 返回音频流（`audio/mpeg`），支持 `Range` 分段
  - 响应:
    - 200: 完整文件
    - 206: 分段内容（携带 `Content-Range`）
    - 404: 歌曲或文件不存在
    - 500: 服务内部错误
  - Range 请求示例:
    ```bash
    curl -H "Range: bytes=0-1023" -v "$BASE_URL/api/music/happy_song1" -o part.mp3
    ```
  - 小程序播放示例（网络直播）:
    ```js
    const url = `${BASE_URL}/api/music/${song.id}`
    const audio = wx.createInnerAudioContext()
    audio.src = url
    audio.play()
    ```
  - 小程序下载后播放:
    ```js
    wx.downloadFile({ url: `${BASE_URL}/api/music/${song.id}`, success(res){
      const audio = wx.createInnerAudioContext();
      audio.src = res.tempFilePath; audio.play();
    }})
    ```

---

### 5) 记录用户交互（播放/评分等）

- POST `/api/record-interaction`
  - 说明: 记录播放、评分等行为
  - 请求体 JSON:
    - `user_id` string 必填
    - `song_id` string 必填
    - `emotion` string 必填（如 `happy`）
    - `action` string 必填（如 `play` | `rating`）
    - `rating` int 可选（当 action=rating 时传入 1~5）
  - 200 示例:
    ```json
    {"success": true, "message": "记录成功"}
    ```
  - 400 示例（缺少参数）:
    ```json
    {"success": false, "error": "缺少必要参数"}
    ```
  - 500 示例:
    ```json
    {"success": false, "error": "internal error message"}
    ```
  - curl:
    ```bash
    curl -s -X POST "$BASE_URL/api/record-interaction" \
      -H 'Content-Type: application/json' \
      -d '{"user_id":"u-1","song_id":"happy_song1","emotion":"happy","action":"play"}'
    ```
  - wx.request:
    ```js
    wx.request({
      url: `${BASE_URL}/api/record-interaction`,
      method: 'POST',
      data: { user_id, song_id, emotion, action: 'play', rating: null },
      success: console.log
    })
    ```

---

### 6) 获取热门歌曲

- GET `/api/popular-songs`
  - 说明: 获取某个情绪下的热门歌曲（依据历史交互的人气分）
  - 查询参数:
    - `emotion` string 必填
    - `limit` int 可选（默认 5）
  - 200 示例:
    ```json
    {
      "success": true,
      "popular_songs": [
        {"id":"happy_song1","title":"Song A","artist":"Unknown","emotion_category":"happy","file_path":"/abs/path/a.mp3","duration":0.0,"popularity_score":9.0}
      ]
    }
    ```
  - 400 示例:
    ```json
    {"success": false, "error": "缺少情绪参数"}
    ```
  - 500 示例:
    ```json
    {"success": false, "error": "internal error message"}
    ```
  - curl:
    ```bash
    curl -s "$BASE_URL/api/popular-songs?emotion=happy&limit=5"
    ```
  - wx.request:
    ```js
    wx.request({ url: `${BASE_URL}/api/popular-songs`, method: 'GET', data: { emotion: 'happy', limit: 5 }, success: console.log })
    ```

---

### 7) 获取用户统计信息

- GET `/api/user-stats`
  - 说明: 返回用户的情绪播放统计与偏好
  - 查询参数:
    - `user_id` string 必填
  - 200 示例:
    ```json
    {
      "success": true,
      "emotion_stats": [
        {"emotion":"happy","play_count":12,"avg_rating":4.5}
      ],
      "preferences": [
        {"emotion":"happy","song_id":"happy_song1","rating":5,"play_count":3}
      ]
    }
    ```
  - 400 示例:
    ```json
    {"success": false, "error": "缺少用户ID"}
    ```
  - 500 示例:
    ```json
    {"success": false, "error": "internal error message"}
    ```
  - curl:
    ```bash
    curl -s "$BASE_URL/api/user-stats?user_id=u-1"
    ```
  - wx.request:
    ```js
    wx.request({ url: `${BASE_URL}/api/user-stats`, method: 'GET', data: { user_id }, success: console.log })
    ```

---

### 备注
- 小程序调试阶段可在“详情-本地设置”勾选“不校验合法域名、TLS 版本以及 HTTPS 证书”对接本地接口。
- 线上发布前请将 BASE_URL 改为 `https://www.musicappwx.cn` 并通过小程序“合法域名”校验。


