// 你是怎么找到这里来的！
// probability 为百分比；null 表示均分未分配的概率。每组内部的链接等概率。
// 当前：个人 UP 主 35%，其余四组各 16.25%。
const targetGroups = [
  {
    name: '二游官网',
    probability: 30,
    urls: [
      // 'https://www.mihoyo.com/', // 米哈游官网
      'https://mc.kurogames.com/download/', // 鸣潮官方下载网页
      'https://endfield.hypergryph.com/', // 明日方舟终末地
      'https://career.hypergryph.com/', // 鹰角网络招聘
      'https://yh.wanmei.com/index.html', // 异环官网
      'https://gf2.sunborngame.com/', // 少前二追放
      'https://klbq.idreamsky.com/', // 卡拉彼丘官网
      'https://bdon.biligames.com/', // our notes官网
      'https://se.feimogames.com/home', // 吉星派对官网
    ],
  },
  {
    name: 'B站主页 各大官方',
    probability: null,
    urls: [
      'https://space.bilibili.com/75806856/', // 中国反邪教B站主页
      'https://space.bilibili.com/3546861952567358/', // 米哈游法务部
      'https://space.bilibili.com/3546379781671377/', // 库洛游戏法务部
      'https://space.bilibili.com/3546893747489397/', // 鹰角网络法务部（高仿）
    ],
  },
  {
    name: 'B站主页 个人UP主',
    probability: 35,
    urls: [
      // 'https://space.bilibili.com/2074304720/', // 无尽夏可拉的个人空间
      // 'https://space.bilibili.com/3546724249373318/', // 满足你
      // 'https://space.bilibili.com/402574397/', // 孙笑川258
      // 'https://space.bilibili.com/1437582453/', // 東雪蓮Official
      // 'https://space.bilibili.com/1265680561/', // 永雏塔菲
      'https://space.bilibili.com/730732', // 瓶子君152
    ],
  },
  {
    name: '视频',
    probability: null,
    urls: [
      'https://www.bilibili.com/video/BV1GJ411x7h7/', // Never Gonna Give You Up - Rick Astley
    ],
  },
  {
    name: '其他',
    probability: 5,
    urls: [
      'https://www.qq.com/', // 腾讯网
      './search.html', // 纯静态搜索页
    ],
  },
  {
    name: '网友投稿',
    probability: 5,
    urls: [
      'https://www.bilibili.com/video/BV1fy4y1L7Rq/', // 《明日方舟》夏日嘉年华限时活动宣传PV
      'https://www.bilibili.com/video/BV18E4m1d7b7/', // 《原神》纳塔交响音乐现场
      'https://www.bilibili.com/video/BV1HfKiz3Ezf/', // 《崩坏：星穹铁道》白厄角色PV——「日冕」
      'https://www.bilibili.com/video/BV1L4421S7Kr/', // 千恋＊万花OP动画
      'https://www.bilibili.com/video/BV1x5411o7Kn/', // 烂苹果
    ],
  },
]

const fixedProbability = targetGroups.reduce((sum, group) => sum + (group.probability ?? 0), 0)
const sharedGroups = targetGroups.filter(group => group.probability === null)
const sharedProbability = sharedGroups.length ? (100 - fixedProbability) / sharedGroups.length : 0

if (
  targetGroups.some(
    group =>
      group.urls.length === 0 ||
      (group.probability !== null &&
        (!Number.isFinite(group.probability) || group.probability < 0)),
  ) ||
  fixedProbability > 100 ||
  (sharedGroups.length === 0 && Math.abs(fixedProbability - 100) > 1e-9)
) {
  throw new Error('跳转配置错误：每组需要链接，概率应为非负数，合计应为 100%。')
}

const roll = Math.random() * 100
let cumulativeProbability = 0
// 浮点数舍入时，回退到最后一个有概率的组。
let selectedGroup = targetGroups
  .filter(group => (group.probability ?? sharedProbability) > 0)
  .at(-1)
for (const group of targetGroups) {
  cumulativeProbability += group.probability ?? sharedProbability
  if (roll < cumulativeProbability) {
    selectedGroup = group
    break
  }
}
const urls = selectedGroup.urls
window.location.replace(urls[Math.floor(Math.random() * urls.length)])
