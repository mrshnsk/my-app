import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// PostgreSQL に接続するためのコネクションプールとアダプターを用意するぞ
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });

async function main() {
  console.log("データベースにユーザーを登録してみるぞ...");
  
  // ユーザーを 1 件追加する
  const newUser = await prisma.user.create({
    data: { name: `旅人 ${new Date().toLocaleTimeString()}` },
  });
  console.log("登録完了:", newUser);

  // 登録されているユーザーを全員取得する
  const allUsers = await prisma.user.findMany();
  console.log("現在のユーザー一覧:", allUsers);
}

main()
  .catch((e) => {
    console.error("エラーが発生したぞ:", e);
    process.exit(1);
  })
  // prisma と pool の両方を閉じないとプログラムが終了しないので注意じゃ
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
