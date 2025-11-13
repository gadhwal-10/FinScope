"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { GoogleGenerativeAI } from "@google/generative-ai";
import aj from "@/lib/arcjet";
import { request } from "@arcjet/next";

// Convert Prisma Decimal to number
const serializeAmount = (obj) => ({
  ...obj,
  amount: obj.amount.toNumber(),
});

/* ------------------------------------------------
   CREATE TRANSACTION
------------------------------------------------ */
export async function createTransaction(data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const req = await request();
    await aj.protect(req, { userId, requested: 1 });

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const account = await db.account.findUnique({
      where: { id: data.accountId, userId: user.id },
    });
    if (!account) throw new Error("Account not found");

    const balanceChange =
      data.type === "EXPENSE" ? -data.amount : data.amount;

    const newBalance = account.balance.toNumber() + balanceChange;

    const tx = await db.$transaction(async (trx) => {
      const newTx = await trx.transaction.create({
        data: { ...data, userId: user.id },
      });

      await trx.account.update({
        where: { id: data.accountId },
        data: { balance: newBalance },
      });

      return newTx;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${tx.accountId}`);

    return { success: true, data: serializeAmount(tx) };
  } catch (err) {
    throw new Error(err.message);
  }
}

/* ------------------------------------------------
   GET TRANSACTION
------------------------------------------------ */
export async function getTransaction(id) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({ where: { clerkUserId: userId } });
  if (!user) throw new Error("User not found");

  const tx = await db.transaction.findUnique({
    where: { id, userId: user.id },
  });
  if (!tx) throw new Error("Transaction not found");

  return serializeAmount(tx);
}

/* ------------------------------------------------
   UPDATE TRANSACTION
------------------------------------------------ */
export async function updateTransaction(id, data) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const original = await db.transaction.findUnique({
      where: { id, userId: user.id },
      include: { account: true },
    });
    if (!original) throw new Error("Transaction not found");

    const oldChange =
      original.type === "EXPENSE"
        ? -original.amount.toNumber()
        : original.amount.toNumber();

    const newChange =
      data.type === "EXPENSE" ? -data.amount : data.amount;

    const net = newChange - oldChange;

    const tx = await db.$transaction(async (trx) => {
      const updated = await trx.transaction.update({
        where: { id, userId: user.id },
        data,
      });

      await trx.account.update({
        where: { id: data.accountId },
        data: { balance: { increment: net } },
      });

      return updated;
    });

    revalidatePath("/dashboard");
    revalidatePath(`/account/${data.accountId}`);

    return { success: true, data: serializeAmount(tx) };
  } catch (err) {
    throw new Error(err.message);
  }
}

/* ------------------------------------------------
   GET USER TRANSACTIONS
------------------------------------------------ */
export async function getUserTransactions(query = {}) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });
    if (!user) throw new Error("User not found");

    const txs = await db.transaction.findMany({
      where: { userId: user.id, ...query },
      include: { account: true },
      orderBy: { date: "desc" },
    });

    return { success: true, data: txs };
  } catch (err) {
    throw new Error(err.message);
  }
}

/* ------------------------------------------------
   SCAN RECEIPT (GEMINI AI) — UPDATED & WORKING
------------------------------------------------ */
export async function scanReceipt(formData) {
  console.log("📌 SCAN RECEIPT STARTED");

  try {
    const file = formData.get("file");
    console.log("📌 Extracted file:", file);

    if (!file) throw new Error("No file uploaded");

    // Convert file → buffer → base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    console.log("📌 Base64 size:", base64.length);

    // Check API key
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY");
    }

    console.log("📌 Initializing Gemini client...");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // FIXED MODEL NAME ❗
 const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
});

    const prompt = `
      Read this receipt image and return JSON:
      {
        "amount": number,
        "date": "ISO string",
        "description": "string",
        "merchantName": "string",
        "category": "string"
      }
    `;

    console.log("📌 Sending request to Gemini...");

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64,
          mimeType: file.type || "image/jpeg",
        },
      },
      prompt,
    ]);

    const text = result.response.text();
    console.log("📌 Raw output:", text);

    const clean = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (err) {
      console.error("❌ JSON parse error:", err);
      throw new Error("Invalid JSON from Gemini");
    }

    console.log("📌 Parsed data:", parsed);

    return {
      amount: Number(parsed.amount) || 0,
      date: parsed.date || new Date().toISOString(),
      description: parsed.description || "No Description",
      merchantName: parsed.merchantName || "Unknown",
      category: parsed.category || "Misc",
    };
  } catch (err) {
    console.error("🔥 FULL SCAN RECEIPT ERROR BELOW");
    console.error(err);
    console.error("🔥 END ERROR");
    throw new Error("Failed to scan receipt");
  }
}

/* ------------------------------------------------
   HELPER — NEXT RECURRING DATE
------------------------------------------------ */
function calculateNextRecurringDate(startDate, interval) {
  const d = new Date(startDate);

  if (interval === "DAILY") d.setDate(d.getDate() + 1);
  if (interval === "WEEKLY") d.setDate(d.getDate() + 7);
  if (interval === "MONTHLY") d.setMonth(d.getMonth() + 1);
  if (interval === "YEARLY") d.setFullYear(d.getFullYear() + 1);

  return d;
}
