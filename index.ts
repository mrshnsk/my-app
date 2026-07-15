import 'dotenv/config'; 
import express from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import pg from 'pg';                          // 👈 追加
import { PrismaPg } from '@prisma/adapter-pg'; // 👈 追加

const app = express();

// PostgreSQLへの接続プールを作成し、Prisma用のアダプターに変換します 👈 追加
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// 新しいPrisma 7の仕様に合わせて初期化 👈 変更
const prisma = new PrismaClient({ adapter });
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

// 1. 入力：レシート画像入力をもとにデータ化（OCR/AI解析のモック処理）
app.post('/expenses/upload-receipt', upload.single('receiptImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('画像ファイルがアップロードされていません。');
    }

    // 【本来の実装】ここにGemini API等のマルチモーダルAIを用いた画像解析処理を組み込みます。
    // 例: AIにレシート画像を送信し、日付・店名・品目・金額をJSONで返却させる
    
    // 以下はOCR解析結果のシミュレート（モックデータ）です
    const mockParsedData = {
      date: new Date(),
      storeName: 'Bスーパーマーケット',
      category: '食品',
      details: 'レシート自動解析（牛乳, キャベツ, 豚肉）',
      amount: Math.floor(Math.random() * 3000) + 1500 // 1500〜4500円のランダム値
    };

    // 解析されたデータをDBに登録
    await prisma.expense.create({
      data: mockParsedData
    });

    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('レシートの自動解析に失敗しました。');
  }
});

app.listen(3000, () => {
  console.log('家計簿アプリがポート3000で起動しました。');
});
