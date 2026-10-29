# 课时空档

一个可直接部署到 GitHub Pages 的本地优先个人排课周历。支持多时区、夏令时、两类占用、拖动标记、JSON 导入/导出、移动端布局和离线访问。

## 特点

- 数据仅保存在当前浏览器的 `localStorage`，不需要账号或服务器。
- 休息时间和手动添加的占用以北京时间记录，展示时自动换算到其他时区。
- 可导出课程、个人事务、休息时间、时区和视图设置。
- 可在其他浏览器或设备导入备份；导入前会校验文件并要求确认覆盖。
- 使用相对路径，既可部署在 `username.github.io`，也可部署在项目子路径。
- 安装为 PWA 后可离线使用。

## 本地运行

直接双击 `index.html` 即可。为了测试离线安装等完整功能，建议在本目录启动本地服务器：

```bash
python3 -m http.server 4173
```

然后访问 `http://localhost:4173`。

## 部署到 GitHub Pages

1. 新建一个 GitHub 仓库，把本目录中的全部文件（包括 `.github` 和 `.nojekyll`）放在仓库根目录并推送到 `main` 或 `master` 分支。
2. 在 GitHub 仓库进入 **Settings → Pages**。
3. 将 **Build and deployment → Source** 设为 **GitHub Actions**。
4. 打开 **Actions**，等待 `Deploy timetable to GitHub Pages` 工作流完成。
5. 部署地址会显示在工作流摘要和 **Settings → Pages** 中。

之后每次推送都会自动更新网站。部署过程不包含用户时间表数据；浏览器本地数据不会被提交到 GitHub。

## 导出与导入

在左侧设置面板的“数据备份”区域：

- 点击“导出备份”下载 `.json` 文件。
- 点击“导入恢复”选择之前导出的文件。
- 导入会覆盖当前浏览器中的时间表，但不会修改备份文件或远端仓库。
- 建议在清理浏览器数据、换设备或更换部署域名前先导出备份。

备份文件带有应用标识和版本号。导入器会拒绝格式错误、超大、日期异常或时段重叠的文件。

## 项目结构

```text
.
├── .github/workflows/deploy-pages.yml  # GitHub Pages 自动部署
├── assets/icon.svg                     # 网站 / PWA 图标
├── index.html                           # 页面结构
├── styles.css                          # 响应式样式
├── app.js                              # 时间表、时区和备份逻辑
├── manifest.webmanifest                # PWA 元数据
└── service-worker.js                   # 离线缓存
```

## 隐私说明

应用不发送任何时间表数据。若用户主动导出备份，文件只会下载到用户设备；若主动导入，文件只在浏览器内解析。
