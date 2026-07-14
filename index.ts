import "dotenv/config";
import express from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// データベース接続の準備
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, log: ["query"] });

const app = express();
const PORT = process.env.PORT || 8888;

// EJS を使うための設定
app.set("view engine", "ejs");
app.set("views", "./views");
// フォームから送られてきたデータを受け取れるようにする設定
app.use(express.urlencoded({ extended: true }));

// ユーザー一覧を表示するページ
app.get("/", async (req, res) => {
  const users = await prisma.user.findMany();
  res.render("index", { users });
});

// 新しいユーザーを追加する処理
// ...省略（Part 5 で作った Express の設定）
app.post("/users", async (req, res) => {
  const name = req.body.name;
  const age = req.body.age ? Number(req.body.age) : null;
  if (name) {
    await prisma.user.create({ data: { name, age } });
  }
  res.redirect("/");
});
// ...省略




app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
