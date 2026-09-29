import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env 已存在，未覆盖。");
  process.exit(0);
}
writeFileSync(
  ".env",
  "PORT=4318\nHOST=127.0.0.1\nAPP_SECRET=" +
    randomBytes(32).toString("hex") +
    "\nSETUP_TOKEN=" +
    randomBytes(24).toString("base64url") +
    "\nCOOKIE_SECURE=false\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "已生成 .env（权限 0600）。首次打开后台，使用其中 SETUP_TOKEN 创建管理员。不要提交或公开此文件。",
);
