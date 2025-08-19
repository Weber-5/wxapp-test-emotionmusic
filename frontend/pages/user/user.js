Page({
  data: {
    userInfo: {},
    historyChart: null
  },
  onShow() {
    // 读取用户信息
    const userInfo = getApp().globalData.userInfo || wx.getStorageSync('userInfo') || {};
    this.setData({ userInfo });
    // 读取历史情绪
    const history = wx.getStorageSync('emotionHistory') || [];
    this.initHistoryChart(history);
  },
  initHistoryChart(history) {
    // 只取最近30条
    const data = history.slice(-30);
    const dateList = data.map(item => item.date);
    const mainEmotionList = data.map(item => item.mainEmotionName || item.mainEmotion);
    const colorMap = {
      '快乐': '#27ae60', '悲伤': '#3498db', '愤怒': '#e74c3c', '中性': '#7f8c8d',
      '惊讶': '#f39c12', '恐惧': '#9b59b6', '厌恶': '#34495e', '焦虑': '#1abc9c',
      '兴奋': '#e67e22', '平静': '#2ecc71'
    };
    this.setData({
      historyChart: {
        onInit: function (canvas, width, height, dpr) {
          const ec = require('../../ec-canvas/echarts');
          const chart = ec.init(canvas, null, { width, height, devicePixelRatio: dpr });
          const option = {
            tooltip: { trigger: 'axis' },
            xAxis: {
              type: 'category',
              data: dateList,
              axisLabel: { rotate: 45, fontSize: 10 }
            },
            yAxis: {
              type: 'category',
              data: [...new Set(mainEmotionList)],
              axisLabel: { fontSize: 12 }
            },
            series: [{
              name: '主情绪',
              type: 'line',
              data: mainEmotionList.map(e => [...new Set(mainEmotionList)].indexOf(e)),
              showSymbol: true,
              symbolSize: 12,
              lineStyle: { width: 3, color: '#27ae60' },
              itemStyle: {
                color: function(params) {
                  return colorMap[mainEmotionList[params.dataIndex]] || '#27ae60';
                }
              },
              label: {
                show: true,
                formatter: function(params) {
                  return mainEmotionList[params.dataIndex];
                },
                fontSize: 10
              }
            }]
          };
          chart.setOption(option);
          return chart;
        }
      }
    });
  }
});
