/**
 * 站点内容 · 与原静态模板 scripts/site-data.js 一一对应
 * 字段名、占位文案保持不变，只把图片路径换成 public/ 下的 webp。
 */
export const site = {
  siteName: "服务器名称",
  siteSub: "生存服官网",
  siteTagline: "中文 Minecraft 服务器",
  heroTitle: "服务器名称",
  heroLead: "服务器介绍",
  serverAddress: "play.yourserver.com",
  serverState: "服务器状态",
  onlineCount: 0,
  maxCount: 300,
  serverVersion: "1.21.x",
  notice: "资源世界周六刷新，主世界建筑不受影响",
  ticketTags: ["半公益", "小镇建筑", "周末活动"],

  /** 首页四个概览卡片：写玩家进服前最关心的信息 */
  overview: [
    {
      label: "服务器类型",
      value: "玩法类型",
      text: "服务器玩法介绍，例如原版生存、建筑养老、RPG、空岛或小游戏",
    },
    {
      label: "开放状态",
      value: "开放时间",
      text: "开服时间、白名单状态或开放计划",
    },
    {
      label: "玩家规则",
      value: "规则摘要",
      text: "写玩家最需要提前知道的规则边界，例如领地、交易、红石和公共设施",
    },
    {
      label: "资源安排",
      value: "刷新周期",
      text: "写资源世界、主世界、地狱和末地的刷新或保护规则",
    },
  ],

  /** 玩法卡片：写具体体验，避免系统名和空泛形容词 */
  features: [
    { icon: "01", title: "玩法亮点", text: "服务器主要玩法" },
    {
      icon: "02",
      title: "建筑与地标",
      text: "写主城、玩家聚落、公共设施、地标建筑或可申请区域",
    },
    {
      icon: "03",
      title: "活动安排",
      text: "写活动频率、活动类型、奖励原则和参与方式",
    },
    {
      icon: "04",
      title: "管理方式",
      text: "写管理团队如何处理破坏、外挂、争议、机器限制和玩家反馈",
    },
  ],

  stats: [
    { value: "在线时间", label: "在线时间" },
    { value: "活动频率", label: "活动频率" },
    { value: "存档计划", label: "存档计划" },
  ],

  /** 风景图：建议放主城、玩家聚落、活动场和地标建筑 */
  scenery: [
    {
      image: "/images/scenery-town.webp",
      title: "主城或出生点",
      text: "替换成服务器主城、出生点或玩家第一眼会看到的场景说明",
    },
    {
      image: "/images/scenery-lake.webp",
      title: "玩家聚落或地标",
      text: "玩家聚落、交通枢纽、地标建筑或建设成果",
    },
    {
      image: "/images/scenery-night.webp",
      title: "活动区域",
      text: "替换成活动场、小游戏区域、节日场景或特色玩法截图",
    },
  ],

  /** 公告：写最近发生的具体事，不要写口号 */
  news: [
    {
      date: "YYYY-MM-DD",
      title: "公告标题",
      text: "版本更新、活动、规则调整或资源刷新",
    },
    {
      date: "YYYY-MM-DD",
      title: "公告标题",
      text: "写玩家最近需要知道的第二条信息",
    },
    {
      date: "YYYY-MM-DD",
      title: "公告标题",
      text: "写玩家最近需要知道的第三条信息",
    },
  ],

  joinSteps: [
    {
      title: "确认游戏版本",
      text: "写服务器支持的 Minecraft 版本、客户端类型和必要资源包",
    },
    {
      title: "复制服务器地址",
      text: "把 play.yourserver.com 添加到多人游戏服务器列表",
    },
    {
      title: "阅读规则后进入",
      text: "写第一次进服需要完成的步骤，例如白名单、QQ群、Discord 或主城引导",
    },
  ],

  community: {
    title: "社群标题",
    note: "写群聊、Discord、论坛或玩家社区的说明",
    qrLabel: "二维码图片",
    qrNote: "社群二维码、群号或邀请链接",
    qrImage: "",
    links: [
      { label: "服务器规则", href: "/rules/" },
      { label: "世界地图", href: "/world/" },
      { label: "支持服务器", href: "/support/" },
    ],
  },

  faq: [
    {
      question: "常见问题标题",
      answer: "写玩家进服前最常问的问题，例如版本、白名单、资源包或账号验证",
    },
    { question: "常见问题标题", answer: "写第二个常见问题的回答" },
    { question: "常见问题标题", answer: "写第三个常见问题的回答" },
  ],
};

export type Site = typeof site;
