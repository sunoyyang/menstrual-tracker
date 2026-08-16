# 部署到 GitHub Pages

本目录已是一个 git 仓库，并已提交「小杜经期小记」PWA 的全部运行文件。
按下面三步即可发布到公网 HTTPS，手机「添加到主屏幕」当 App 用。

---

## 第一步：在 GitHub 新建仓库

1. 登录 github.com → 右上角 **New repository**
2. 仓库名二选一：
   - **想要根域名站点（地址最干净，推荐）**：仓库名必须填 `你的用户名.github.io`
     （例如你的账号是 `sunoyyang`，仓库就建 `sunoyyang.github.io`）
   - **想要项目页**：仓库名随意（如 `menstrual-tracker`），站点地址会是
     `用户名.github.io/menstrual-tracker`
3. 仓库**公开或私有都可以**（GitHub Pages 现已支持私有仓库；站点本身公网可访问，
   但你们的数据只存在各自手机本地，不会泄露，见文末说明）
4. 不要勾选 "Add a README / .gitignore"（本地已有），或勾了也无妨

---

## 第二步：本地推送到 GitHub

在本目录（`menstrual-tracker`）下，把下面命令里的「用户名」「仓库名」替换成你的实际值执行：

```bash
git remote add origin https://github.com/用户名/仓库名.git
git branch -M main
git push -u origin main
```

> **关于密码**：GitHub 已不支持用账户密码 push。若要求输入密码，请填
> **Personal Access Token**（GitHub → Settings → Developer settings →
> Personal access tokens → 生成，勾选 `repo` 权限）。用户名填你的 GitHub 账号。

---

## 第三步：开启 GitHub Pages

1. 进入该仓库 **Settings → Pages**（左侧边栏）
2. Source 选 **Deploy from a branch**
3. Branch 选 `main`，目录选 **/ (root)**
4. 点 **Save**，等待 1~2 分钟构建完成
5. 访问 `https://用户名.github.io/仓库名` 即可

---

## 第四步：手机打开（iOS）

1. Safari 打开上面的 https 链接
2. 点底部「分享」按钮 → 下滑找到 **「添加到主屏幕」**
3. 名称填「小杜经期小记」→ 添加
4. 桌面出现图标，点开即全屏 App，数据存在各自手机本地

安卓 Chrome 同理：菜单 →「安装应用」。

---

## 以后更新

改完代码后：

```bash
git add -A
git commit -m "更新说明"
git push
```

GitHub Pages 会自动重新构建（约 1 分钟生效）。

---

## 私密性说明

- 所有经期 / 亲密数据仅保存在使用者手机浏览器的 localStorage，**绝不上传任何服务器**。
- 站点公网可访问，但任何拿到链接的人只能看到一个空白、无数据的 App，**看不到你们任何记录**。
- 若以后想要「两人跨设备同步同一份数据」，需要额外接入后端（如 Supabase），那是另一套方案。
