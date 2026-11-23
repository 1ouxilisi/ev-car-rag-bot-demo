# 新能源汽车问答助手 · 静态交互 Demo

纯前端演示原型：分流与检索逻辑在浏览器内运行，答案取自归档评测结果，不调用在线大模型。

- 在线预览：https://1ouxilisi.github.io/ev-car-rag-bot-demo/
- 完整源码（LoRA 微调 + vLLM 部署 + 神经向量 RAG + 评测）：https://gitee.com/beyond-invincibility/ev-car-rag-bot
- 车型与参数均为虚构演示语料，不对应任何真实品牌。

## 文件

- index.html 对话页面
- qa_data.js 内置数据集（车型白名单 / 越界关键词 / 预置问答对）
- app.js 浏览器内四道防线与轻量检索