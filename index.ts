import 'dotenv/config'; 
import express from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import pg from 'pg';                          // 👈 追加
import { PrismaPg } from '@prisma/adapter-pg'; // 👈 追加
import { GoogleGenAI } from '@google/genai';

const app = express();

// PostgreSQLへの接続プールを作成し、Prisma用のアダプターに変換します 👈 追加
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// 新しいPrisma 7の仕様に合わせて初期化 👈 変更
const prisma = new PrismaClient({ adapter });
// Gemini APIの初期化（環境変数 GEMINI_API_KEY を使用）
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const upload = multer();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// メイン画面：データの集計・分析および表示
app.get('/', async (req, res) => {
  try {
    // 履歴用データの全件取得
    const allExpenses = await prisma.expense.findMany({
      orderBy: { date: 'desc' }
    });

    // 2. 処理：店舗ごとの合計金額を計算して分析
    const storeAnalysisRaw = await prisma.expense.groupBy({
      by: ['storeName'],
      _sum: { amount: true },
    });
    const storeAnalysis = storeAnalysisRaw.map(item => ({
      storeName: item.storeName,
      totalAmount: item._sum.amount || 0
    })).sort((a, b) => b.totalAmount - a.totalAmount);

    // 3. 表示：類似項目（カテゴリ）ごとに集計し、支出が多い順にソート
    const categoryAnalysisRaw = await prisma.expense.groupBy({
      by: ['category'],
      _sum: { amount: true },
      orderBy: {
        _sum: { amount: 'desc' }
      }
    });
    const categoryAnalysis = categoryAnalysisRaw.map(item => ({
      category: item.category,
      totalAmount: item._sum.amount || 0
    }));

    // 3. 表示：支出額の変動（月別の標準偏差）が多い項目をまとめる
    const categoryMonthlySum: Record<string, Record<string, number>> = {};
    allExpenses.forEach(exp => {
      const month = exp.date.toISOString().substring(0, 7); // YYYY-MM 形式の文字列
      if (!categoryMonthlySum[exp.category]) {
        categoryMonthlySum[exp.category] = {};
      }
      categoryMonthlySum[exp.category][month] = (categoryMonthlySum[exp.category][month] || 0) + exp.amount;
    });

    const volatileAnalysis = Object.keys(categoryMonthlySum).map(category => {
      const monthlyAmounts = Object.values(categoryMonthlySum[category]);
      const n = monthlyAmounts.length;
      
      // データが1ヶ月分しかない場合は変動なし(0)とする
      if (n <= 1) return { category, volatility: 0 };

      // 平均値の算出
      const mean = monthlyAmounts.reduce((sum, val) => sum + val, 0) / n;
      // 分散の算出
      const variance = monthlyAmounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
      // 標準偏差（変動スコア）の算出
      const stdDev = Math.sqrt(variance);

      return { category, volatility: stdDev };
    }).sort((a, b) => b.volatility - a.volatility); // 変動が多い順にソート

    // EJSテンプレートへ分析結果を渡してレンダリング
    res.render('index', {
      expenses: allExpenses,
      storeAnalysis,
      categoryAnalysis,
      volatileAnalysis
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('サーバーエラーが発生しました。');
  }
});

// 1. 入力：手動入力による支出データの追加
app.post('/expenses', async (req, res) => {
  const { date, storeName, category, details, amount } = req.body;
  try {
    await prisma.expense.create({
      data: {
        date: new Date(date),
        storeName,
        category,
        details,
        amount: parseInt(amount, 10),
      }
    });
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('データの追加に失敗しました。');
  }
});

// 📷 1. 入力：本物のGemini AIを用いてレシート画像から構造化データを抽出
app.post('/expenses/upload-receipt', upload.single('receiptImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('画像ファイルがアップロードされていません。');
    }

    // 1. 画像ファイルをAIが読み込める形式（Base64）に変換
    const imageBase64 = req.file.buffer.toString('base64');
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: req.file.mimetype
      }
    };

    // 2. AIへ送る指示（プロンプト）の作成
    const prompt = `
      このレシート画像から「日付」「店舗名」「カテゴリ」「購入内容」「合計金額」を読み取り、
      必ず以下のJSONオブジェクトの形式のみで返答してください。余計な説明や挨拶は一切含めないでください。

      返答のJSONフォーマット:
      {
        "date": "YYYY-MM-DD 形式の日付（レシートに記載の日付、不明なら今日の年月日）",
        "storeName": "店舗名（例：Aスーパー）",
        "category": "食費、日用品、交際費、交通費、娯楽費、その他のいずれか適切なものを1つ選択",
        "details": "購入した主な商品の名前（例：牛乳、パン、卵）",
        "amount": 合計支払い金額（半角数字のみ、カンマなし。例: 1580）
      }
    `;

    // 3. Gemini-2.0-flash モデルで画像を解析
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [prompt, imagePart],
    });

    const aiText = response.text || '{}';
    // AIの出力からMarkdownブロック（```json ... ```）を綺麗に除去
    const jsonString = aiText.replace(/```json|```/g, '').trim();
    const parsedData = JSON.parse(jsonString);

    // 4. AIが抽出した本物のデータをデータベースに登録
    await prisma.expense.create({
      data: {
        date: new Date(parsedData.date || new Date()),
        storeName: parsedData.storeName || '不明な店舗',
        category: parsedData.category || 'その他',
        details: parsedData.details || 'レシート解析データ',
        amount: Number(parsedData.amount) || 0
      }
    });

    res.redirect('/');
  } catch (error) {
    console.error('AI解析エラー:', error);
    res.status(500).send('レシートのAI自動解析に失敗しました。');
  }
});


app.listen(3000, () => {
  console.log('家計簿アプリがポート3000で起動しました。');
});
